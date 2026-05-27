import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { supabase } from '../lib/supabase.js'
import { useBoardStore } from './board.js'

const SYNC_QUEUE_KEY = 'rb_cal_sync_queue'
function _getSyncQueue() {
  try { return new Set(JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]')) } catch { return new Set() }
}
function _saveSyncQueue(q) { localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify([...q])) }
function _queueTaskSync(taskId) { const q = _getSyncQueue(); q.add(String(taskId)); _saveSyncQueue(q) }
function _dequeueTaskSync(taskId) { const q = _getSyncQueue(); q.delete(String(taskId)); _saveSyncQueue(q) }

const GOOGLE_CLIENT_ID = '809750411186-1315ibr7ag630sbdkd42kt2cojlflqr6.apps.googleusercontent.com'
const GCAL_REDIRECT_URI = 'https://researchflo.app'
const EDGE_AUTH_URL = 'https://oqqevpkeqcbkqrgabpkc.supabase.co/functions/v1/google-calendar-auth'
const EDGE_TOKEN_URL = 'https://oqqevpkeqcbkqrgabpkc.supabase.co/functions/v1/google-calendar-token'
const CALDAV_PROXY_URL = 'https://oqqevpkeqcbkqrgabpkc.supabase.co/functions/v1/caldav-proxy'
const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly'

// Composite target ID separators: "google:::calId" or "caldav:::sourceId:::calHref"
const SEP = ':::'

export const useCalendarStore = defineStore('calendar', () => {
  const clientId = ref(GOOGLE_CLIENT_ID)
  const accessToken = ref('')
  const tokenExpiry = ref(0)
  const selectedCalendarId = ref(localStorage.getItem('rb_gcal_calendar_id') || 'primary')
  const selectedTargetId = ref(localStorage.getItem('rb_cal_target_id') || '')
  const calendarList = ref([])
  const events = ref([])
  const loading = ref(false)
  const connectError = ref('')
  const isConnected = ref(false)

  // CalDAV sources
  const caldavSources = ref([]) // { id, type, name, url, is_write_target, enabled }
  const caldavCalendars = ref({}) // { [sourceId]: CalDAVCalendar[] }
  const caldavConnecting = ref(false)
  const caldavError = ref('')

  const writableCalendars = computed(() =>
    calendarList.value.filter(c => c.accessRole === 'writer' || c.accessRole === 'owner')
  )

  // All calendars across all connected sources for the target dropdown
  const allCalendars = computed(() => {
    const gcal = writableCalendars.value.map(c => ({
      key: `google${SEP}${c.id}`,
      label: c.summary,
      sourceLabel: 'Google Calendar',
      color: c.backgroundColor,
    }))
    const caldav = caldavSources.value.flatMap(src => {
      const cals = caldavCalendars.value[src.id] || []
      const srcLabel = src.type === 'icloud' ? 'iCloud' : src.name
      return cals.map(cal => ({
        key: `caldav${SEP}${src.id}${SEP}${cal.href}`,
        label: cal.name,
        sourceLabel: srcLabel,
        color: cal.color,
      }))
    })
    return [...gcal, ...caldav]
  })

  // Task → event: keyed by task ID, value is the matching loaded event (if visible this week)
  const scheduledByTaskId = computed(() => {
    const boardStore = useBoardStore()
    const map = new Map()
    for (const task of boardStore.tasks) {
      if (!task.caldav_event_uid) continue
      const ev = events.value.find(e => e.id === task.caldav_event_uid)
      if (ev) {
        const taskId = String(task.id)
        if (!map.has(taskId)) map.set(taskId, [])
        map.get(taskId).push(ev)
      }
    }
    return map
  })

  // Event → task: keyed by event UID, value is task ID string
  const taskIdByEventUid = computed(() => {
    const boardStore = useBoardStore()
    const map = new Map()
    for (const task of boardStore.tasks) {
      if (task.caldav_event_uid) map.set(task.caldav_event_uid, String(task.id))
    }
    return map
  })

  async function _ensureToken() {
    if (accessToken.value && tokenExpiry.value > Date.now() + 5 * 60 * 1000) {
      return accessToken.value
    }
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return null
      const res = await fetch(EDGE_TOKEN_URL, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (!res.ok) {
        if (res.status === 404) isConnected.value = false
        return null
      }
      const data = await res.json()
      accessToken.value = data.access_token
      tokenExpiry.value = Date.now() + 55 * 60 * 1000
      isConnected.value = true
      return data.access_token
    } catch (e) {
      console.error('Failed to get GCal token:', e)
      return null
    }
  }

  async function _caldavProxy(action, params) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')
    const res = await fetch(CALDAV_PROXY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...params }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `CalDAV proxy error: ${res.status}`)
    }
    return res.json()
  }

  // ── CalDAV source management ──────────────────────────────────────────────

  async function loadCalDAVSources() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from('calendar_sources')
      .select('id, type, name, url, is_write_target, enabled')
      .eq('user_id', user.id)
      .in('type', ['caldav', 'icloud'])
      .order('sort_order')
    caldavSources.value = data || []

    // Load calendars for each source in parallel
    const results = await Promise.allSettled(
      (data || []).map(async src => {
        try {
          const result = await _caldavProxy('list_calendars', { source_id: src.id })
          return { id: src.id, cals: result.calendars || [] }
        } catch { return { id: src.id, cals: [] } }
      })
    )
    const next = {}
    for (const r of results) {
      if (r.status === 'fulfilled') next[r.value.id] = r.value.cals
    }
    caldavCalendars.value = next
  }

  async function connectCalDAV(type, serverUrl, username, password, name) {
    caldavConnecting.value = true
    caldavError.value = ''
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')

      const icloudUrl = 'https://caldav.icloud.com/.well-known/caldav'
      const connectUrl = type === 'icloud' ? icloudUrl : serverUrl

      const { calendars, homeSetUrl } = await _caldavProxy('discover', {
        url: connectUrl, username, password,
      })

      const { data: src, error } = await supabase.from('calendar_sources').insert({
        user_id: user.id,
        type,
        name: name || (type === 'icloud' ? 'iCloud Calendar' : 'CalDAV Calendar'),
        url: homeSetUrl || connectUrl,
        username,
        password,
        is_write_target: false,
        enabled: true,
      }).select().single()

      if (error) throw new Error(error.message)

      caldavSources.value = [...caldavSources.value, src]
      caldavCalendars.value = { ...caldavCalendars.value, [src.id]: calendars || [] }
      return { source: src, calendars: calendars || [] }
    } catch (err) {
      caldavError.value = err.message
      throw err
    } finally {
      caldavConnecting.value = false
    }
  }

  async function disconnectCalDAV(sourceId) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('calendar_sources').delete().eq('id', sourceId).eq('user_id', user.id)
    caldavSources.value = caldavSources.value.filter(s => s.id !== sourceId)
    const next = { ...caldavCalendars.value }
    delete next[sourceId]
    caldavCalendars.value = next
    if (selectedTargetId.value.includes(`${SEP}${sourceId}${SEP}`) || selectedTargetId.value.endsWith(`${SEP}${sourceId}`)) {
      saveTargetId('')
    }
  }

  function saveTargetId(composite) {
    selectedTargetId.value = composite
    localStorage.setItem('rb_cal_target_id', composite)
    if (composite.startsWith(`google${SEP}`)) {
      const calId = composite.slice(`google${SEP}`.length)
      selectedCalendarId.value = calId
      localStorage.setItem('rb_gcal_calendar_id', calId)
    }
  }

  // ── OAuth (Google) ────────────────────────────────────────────────────────

  async function init() {
    const params = new URLSearchParams(window.location.search)
    const isGCalCallback = params.has('code') && !!sessionStorage.getItem('gcal_csrf')
    if (isGCalCallback) {
      const code = params.get('code')
      const returnedState = params.get('state')
      const expectedCsrf = sessionStorage.getItem('gcal_csrf')
      sessionStorage.removeItem('gcal_csrf')
      window.history.replaceState({}, '', window.location.pathname)
      if (expectedCsrf && returnedState !== expectedCsrf) {
        connectError.value = 'csrf_mismatch'
        return
      }
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { connectError.value = 'not_signed_in'; return }
        const res = await fetch(EDGE_AUTH_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        })
        if (res.ok) {
          await _ensureToken()
          await fetchCalendarList()
        } else {
          connectError.value = 'token_exchange_failed'
        }
      } catch {
        connectError.value = 'connection_failed'
      }
    } else if (params.has('gcal_error')) {
      connectError.value = params.get('gcal_error')
      window.history.replaceState({}, '', window.location.pathname)
    } else {
      await _ensureToken()
    }
    // Always load CalDAV sources on init
    await loadCalDAVSources()
  }

  async function connect() {
    connectError.value = ''
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { connectError.value = 'Not signed in'; return }
    const csrf = crypto.randomUUID()
    sessionStorage.setItem('gcal_csrf', csrf)
    const p = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GCAL_REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state: csrf,
    })
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${p}`
  }

  async function disconnect() {
    isConnected.value = false
    accessToken.value = ''
    tokenExpiry.value = 0
    events.value = []
    calendarList.value = []
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('calendar_sources').delete().eq('user_id', user.id).eq('type', 'google')
      }
    } catch {}
  }

  function saveClientId(id) { clientId.value = id }

  function saveCalendarId(id) {
    selectedCalendarId.value = id
    localStorage.setItem('rb_gcal_calendar_id', id)
    saveTargetId(`google${SEP}${id}`)
  }

  async function fetchCalendarList() {
    const token = await _ensureToken()
    if (!token) return
    try {
      const res = await fetch(
        'https://www.googleapis.com/calendar/v3/users/me/calendarList',
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) return
      const data = await res.json()
      calendarList.value = data.items || []
      if (selectedCalendarId.value !== 'primary') {
        const ids = new Set(calendarList.value.map(c => c.id))
        if (!ids.has(selectedCalendarId.value)) saveCalendarId('primary')
      }
    } catch {}
  }

  async function loadWeekEvents(weekStart) {
    if (!calendarList.value.length && isConnected.value) await fetchCalendarList()
    loading.value = true
    try {
      const timeMin = new Date(weekStart)
      timeMin.setHours(0, 0, 0, 0)
      const timeMax = new Date(weekStart)
      timeMax.setDate(timeMax.getDate() + 7)
      timeMax.setHours(23, 59, 59, 999)

      const allEvents = []

      // 1. Google Calendar
      const token = await _ensureToken()
      if (token) {
        const qp = new URLSearchParams({
          timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(),
          singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
        })
        const cals = calendarList.value.length ? calendarList.value : [{ id: 'primary', backgroundColor: null }]
        const gcalResults = await Promise.allSettled(
          cals.map(async cal => {
            const res = await fetch(
              `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${qp}`,
              { headers: { Authorization: `Bearer ${token}` } }
            )
            if (res.status === 401) { await disconnect(); return [] }
            if (!res.ok) return []
            const data = await res.json()
            return (data.items || []).map(ev => ({
              ...ev, _calColor: cal.backgroundColor, _calId: cal.id, _sourceType: 'google',
            }))
          })
        )
        for (const r of gcalResults) {
          if (r.status === 'fulfilled') allEvents.push(...r.value)
        }
      }

      // 2. CalDAV / iCloud sources
      const enabledSources = caldavSources.value.filter(s => s.enabled)
      if (enabledSources.length) {
        const caldavResults = await Promise.allSettled(
          enabledSources.flatMap(src => {
            const cals = caldavCalendars.value[src.id] || []
            return cals.map(async cal => {
              try {
                const result = await _caldavProxy('get_events', {
                  source_id: src.id,
                  cal_href: cal.href,
                  time_min: timeMin.toISOString(),
                  time_max: timeMax.toISOString(),
                })
                return (result.events || []).map(ev => ({
                  id: ev.uid,
                  summary: ev.summary || '(No title)',
                  description: ev.description || '',
                  start: ev.isAllDay ? { date: ev.start } : { dateTime: ev.start },
                  end: ev.isAllDay ? { date: ev.end } : { dateTime: ev.end },
                  _calColor: cal.color || null,
                  _calId: cal.href,
                  _sourceType: src.type,
                  _sourceId: src.id,
                }))
              } catch { return [] }
            })
          })
        )
        for (const r of caldavResults) {
          if (r.status === 'fulfilled') allEvents.push(...r.value)
        }
      }

      events.value = allEvents.sort(
        (a, b) => new Date(a.start?.dateTime || a.start?.date) - new Date(b.start?.dateTime || b.start?.date)
      )
    } finally {
      loading.value = false
    }
  }

  function buildEventDescription(task, projectName) {
    const parts = []
    if (projectName) parts.push(`Project: ${projectName}`)
    const notes = (task.description ?? '').split('\n')
      .filter(l => !l.startsWith('📅 Scheduled:') && !l.startsWith('📅 GCal:'))
      .join('\n').trim()
    if (notes) parts.push(notes)
    if (task.project_id) {
      const base = `${window.location.origin}${import.meta.env.BASE_URL}`
      parts.push(`Open in Research Board: ${base}?project=${task.project_id}`)
    }
    return parts.join('\n\n')
  }

  async function createEvent(task, projectName, dateObj, startHour, startMinute, durationMinutes) {
    const start = new Date(dateObj)
    start.setHours(startHour, startMinute, 0, 0)
    const end = new Date(start.getTime() + durationMinutes * 60_000)
    const desc = buildEventDescription(task, projectName)

    const targetId = selectedTargetId.value
    const isCaldav = targetId.startsWith(`caldav${SEP}`)

    if (isCaldav) {
      // Parse: "caldav:::sourceId:::calHref"
      const withoutPrefix = targetId.slice(`caldav${SEP}`.length)
      const sepIdx = withoutPrefix.indexOf(SEP)
      const sourceId = withoutPrefix.slice(0, sepIdx)
      const calHref = withoutPrefix.slice(sepIdx + SEP.length)

      const uid = `${crypto.randomUUID()}@researchflo.app`
      await _caldavProxy('create_event', {
        source_id: sourceId, cal_href: calHref, uid,
        summary: task.content, description: desc,
        start_iso: start.toISOString(), end_iso: end.toISOString(),
      })

      const calColor = (caldavCalendars.value[sourceId] || []).find(c => c.href === calHref)?.color || null
      const ev = {
        id: uid, summary: task.content, description: desc,
        start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() },
        _calColor: calColor, _calId: calHref, _sourceType: 'caldav', _sourceId: sourceId,
      }
      events.value.push(ev)
      useBoardStore().saveGCalEvent(task.id, uid, calHref).catch(() => {})
      return ev
    }

    // Google Calendar
    const token = await _ensureToken()
    if (!token) throw new Error('Not authenticated')
    const googleCalId = targetId.startsWith(`google${SEP}`) ? targetId.slice(`google${SEP}`.length) : selectedCalendarId.value
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const body = {
      summary: task.content, description: desc,
      start: { dateTime: start.toISOString(), timeZone: tz },
      end: { dateTime: end.toISOString(), timeZone: tz },
    }
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(googleCalId)}/events`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    )
    if (!res.ok) throw new Error(`Failed to create event: ${res.status}`)
    const event = await res.json()
    const calColor = calendarList.value.find(c => c.id === googleCalId)?.backgroundColor ?? null
    events.value.push({ ...event, _calColor: calColor, _calId: googleCalId, _sourceType: 'google' })
    useBoardStore().saveGCalEvent(task.id, event.id, googleCalId).catch(() => {})
    return event
  }

  async function _patchEvents(evs, task, projectName) {
    const token = await _ensureToken()
    if (!token) return
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const desc = buildEventDescription(task, projectName)
    const durationMap = { '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240 }
    const timeLabel = (task.labels || []).find(l => l.startsWith('time::'))
    const duration = timeLabel ? durationMap[timeLabel.slice(6)] : null
    await Promise.allSettled(evs.map(async ev => {
      if (ev._sourceType !== 'google' && ev._sourceType !== undefined) return
      const patch = { summary: task.content, description: desc }
      if (duration && ev.start?.dateTime) {
        const start = new Date(ev.start.dateTime)
        patch.start = { dateTime: start.toISOString(), timeZone: tz }
        patch.end = { dateTime: new Date(start.getTime() + duration * 60_000).toISOString(), timeZone: tz }
      }
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(ev._calId)}/events/${ev.id}`,
        { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }
      )
      if (!res.ok) return
      const updated = await res.json()
      const idx = events.value.findIndex(e => e.id === ev.id)
      if (idx !== -1) events.value[idx] = { ...events.value[idx], ...updated }
    }))
  }

  function _parseGCalLine(task) {
    const line = (task.description || '').split('\n').find(l => l.startsWith('📅 GCal:'))
    if (!line) return null
    const parts = line.slice('📅 GCal: '.length).split('|')
    return parts.length === 2 ? { eventId: parts[0], calId: parts[1] } : null
  }

  async function syncEventForTask(task, projectName) {
    const token = await _ensureToken()
    if (!token) { _queueTaskSync(task.id); return }
    const stored = _parseGCalLine(task)
    if (stored) {
      const memEv = events.value.find(e => e.id === stored.eventId)
      await _patchEvents([memEv || { id: stored.eventId, _calId: stored.calId }], task, projectName)
      _dequeueTaskSync(task.id)
      return
    }
    const evs = scheduledByTaskId.value.get(String(task.id)) || []
    if (!evs.length) { _dequeueTaskSync(task.id); return }
    await _patchEvents(evs, task, projectName)
    _dequeueTaskSync(task.id)
  }

  async function drainSyncQueue() {
    const q = _getSyncQueue()
    if (!q.size) return
    const token = await _ensureToken()
    if (!token) return
    const boardStore = useBoardStore()
    await Promise.allSettled([...q].map(async taskId => {
      const task = boardStore.tasks.find(t => t.id === taskId)
      if (!task) { _dequeueTaskSync(taskId); return }
      const stored = _parseGCalLine(task)
      const projectName = boardStore.projects.find(p => p.id === task.project_id)?.name ?? ''
      if (stored) {
        const getRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(stored.calId)}/events/${encodeURIComponent(stored.eventId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (getRes.ok) {
          const ev = await getRes.json()
          const calUpdated = ev.updated ? new Date(ev.updated).getTime() : 0
          const taskUpdated = task.updated_at ? new Date(task.updated_at).getTime() : 0
          const patch = { description: buildEventDescription(task, projectName) }
          if (taskUpdated >= calUpdated) patch.summary = task.content
          const patchRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(stored.calId)}/events/${encodeURIComponent(stored.eventId)}`,
            { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }
          )
          if (patchRes.ok) {
            const updated = await patchRes.json()
            const idx = events.value.findIndex(e => e.id === stored.eventId)
            if (idx !== -1) events.value[idx] = { ...events.value[idx], ...updated }
          }
        }
        _dequeueTaskSync(taskId)
        return
      }
      const cals = calendarList.value.length
        ? calendarList.value.filter(c => c.accessRole === 'writer' || c.accessRole === 'owner')
        : [{ id: selectedCalendarId.value }]
      const evs = []
      await Promise.allSettled(cals.map(async cal => {
        const params = new URLSearchParams({ privateExtendedProperty: `todoist_task_id=${taskId}`, singleEvents: 'true', maxResults: '10' })
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!res.ok) return
        const data = await res.json()
        for (const ev of (data.items || [])) evs.push({ ...ev, _calId: cal.id })
      }))
      if (evs.length) await _patchEvents(evs, task, projectName)
      _dequeueTaskSync(taskId)
    }))
  }

  async function deleteEvent(eventId, calId) {
    const token = await _ensureToken()
    if (!token) throw new Error('Not authenticated')
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${eventId}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`Failed to delete event: ${res.status}`)
    events.value = events.value.filter(ev => ev.id !== eventId)
  }

  async function updateEvent(eventId, calId, newStart, newEnd) {
    const token = await _ensureToken()
    if (!token) throw new Error('Not authenticated')
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const body = {
      start: { dateTime: newStart.toISOString(), timeZone: tz },
      end: { dateTime: newEnd.toISOString(), timeZone: tz },
    }
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${eventId}`,
      { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    )
    if (!res.ok) throw new Error(`Failed to update event: ${res.status}`)
    const updated = await res.json()
    const idx = events.value.findIndex(ev => ev.id === eventId)
    if (idx !== -1) events.value[idx] = { ...events.value[idx], ...updated }
    return updated
  }

  async function deleteAllByTaskId(taskId) {
    const evs = scheduledByTaskId.value.get(String(taskId)) || []
    await Promise.allSettled(evs.map(async ev => {
      if (!ev._sourceType || ev._sourceType === 'google') {
        await deleteEvent(ev.id, ev._calId)
      } else {
        try {
          const eventHref = ev._calId.endsWith('/') ? `${ev._calId}${ev.id}.ics` : `${ev._calId}/${ev.id}.ics`
          await _caldavProxy('delete_event', { source_id: ev._sourceId, event_href: eventHref })
          events.value = events.value.filter(e => e.id !== ev.id)
        } catch {}
      }
    }))
  }

  async function updateEventTitle(taskId, title) {
    const token = await _ensureToken()
    if (!token) return
    const evs = scheduledByTaskId.value.get(String(taskId))
    if (!evs?.length) return
    const ev = evs[0]
    if (ev._sourceType && ev._sourceType !== 'google') return
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(ev._calId)}/events/${ev.id}`,
      { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ summary: title }) }
    )
    if (!res.ok) return
    const updated = await res.json()
    const idx = events.value.findIndex(e => e.id === ev.id)
    if (idx !== -1) events.value[idx] = { ...events.value[idx], ...updated }
  }

  async function linkEventToTask(eventId, calId, taskId) {
    await useBoardStore().saveGCalEvent(taskId, eventId, calId)
  }

  async function unlinkTaskFromEvent(_eventId, _calId) {
    // task_schedule row is cleaned up automatically:
    // - on task delete: cascade from tasks FK
    // - on unschedule: explicit clearScheduledTime call
  }

  async function reconcileScheduledTasks() {
    const token = await _ensureToken()
    if (!token) return
    const boardStore = useBoardStore()
    const scheduledTasks = boardStore.tasks.filter(t => !t.is_completed && (t.description || '').includes('📅 GCal:'))
    await Promise.allSettled(scheduledTasks.map(async task => {
      const stored = _parseGCalLine(task)
      if (!stored) return
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(stored.calId)}/events/${encodeURIComponent(stored.eventId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (res.status === 404 || res.status === 410) { await boardStore.clearScheduledTime(task.id); return }
      if (!res.ok) return
      const ev = await res.json()
      if (!ev.start?.dateTime) return
      const calIso = new Date(ev.start.dateTime).toISOString()
      const descLine = (task.description || '').split('\n').find(l => l.startsWith('📅 Scheduled:'))
      const m = descLine?.match(/\(([^)]+)\)$/)
      const savedIso = m ? m[1] : null
      if (calIso !== savedIso) await boardStore.saveScheduledTime(task.id, calIso)
    }))
  }

  watch(isConnected, (connected) => { if (connected) drainSyncQueue().catch(() => {}) })

  async function checkConnection() { await _ensureToken() }

  return {
    clientId, events, loading, connectError, selectedCalendarId, selectedTargetId,
    calendarList, writableCalendars, allCalendars, isConnected, scheduledByTaskId, taskIdByEventUid,
    caldavSources, caldavCalendars, caldavConnecting, caldavError,
    saveClientId, saveCalendarId, saveTargetId, connect, disconnect, init, checkConnection,
    loadWeekEvents, createEvent, deleteEvent, deleteAllByTaskId, updateEvent, updateEventTitle,
    syncEventForTask, fetchCalendarList, linkEventToTask, reconcileScheduledTasks, unlinkTaskFromEvent,
    loadCalDAVSources, connectCalDAV, disconnectCalDAV,
  }
})
