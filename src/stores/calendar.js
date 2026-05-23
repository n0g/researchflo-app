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
const GCAL_REDIRECT_URI = 'https://oqqevpkeqcbkqrgabpkc.supabase.co/functions/v1/google-calendar-auth'
const EDGE_TOKEN_URL = 'https://oqqevpkeqcbkqrgabpkc.supabase.co/functions/v1/google-calendar-token'
const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly'

export const useCalendarStore = defineStore('calendar', () => {
  // clientId kept for API compatibility with SettingsPage
  const clientId = ref(GOOGLE_CLIENT_ID)
  // accessToken cached in memory — fetched from Edge Function, never stored in localStorage
  const accessToken = ref('')
  const tokenExpiry = ref(0)
  const selectedCalendarId = ref(localStorage.getItem('rb_gcal_calendar_id') || 'primary')
  const calendarList = ref([])
  const events = ref([])
  const loading = ref(false)
  const connectError = ref('')
  const isConnected = ref(false)

  const writableCalendars = computed(() =>
    calendarList.value.filter(c => c.accessRole === 'writer' || c.accessRole === 'owner')
  )

  const scheduledByTaskId = computed(() => {
    const map = new Map()
    for (const ev of events.value) {
      const taskId = ev.extendedProperties?.private?.todoist_task_id
      if (taskId) {
        if (!map.has(taskId)) map.set(taskId, [])
        map.get(taskId).push(ev)
      }
    }
    return map
  })

  // Get a valid access token from the Edge Function (cached in memory)
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

  // Check OAuth callback params and verify connection on startup
  async function init() {
    const params = new URLSearchParams(window.location.search)
    if (params.has('gcal_connected')) {
      window.history.replaceState({}, '', window.location.pathname)
      const token = await _ensureToken()
      if (token) await fetchCalendarList()
    } else if (params.has('gcal_error')) {
      connectError.value = params.get('gcal_error')
      window.history.replaceState({}, '', window.location.pathname)
    } else {
      // Silently check if connected
      await _ensureToken()
    }
  }

  // Redirect to Google OAuth — Edge Function handles the callback
  async function connect() {
    connectError.value = ''
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { connectError.value = 'Not signed in'; return }
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GCAL_REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state: session.access_token,
    })
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
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
        await supabase.from('user_settings').update({
          gcal_access_token: null,
          gcal_refresh_token: null,
          gcal_token_expires_at: null,
        }).eq('user_id', user.id)
      }
    } catch {}
  }

  // saveClientId kept for API compatibility
  function saveClientId(id) { clientId.value = id }

  function saveCalendarId(id) {
    selectedCalendarId.value = id
    localStorage.setItem('rb_gcal_calendar_id', id)
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
    const token = await _ensureToken()
    if (!token) return
    if (!calendarList.value.length) await fetchCalendarList()
    loading.value = true
    try {
      const timeMin = new Date(weekStart)
      timeMin.setHours(0, 0, 0, 0)
      const timeMax = new Date(weekStart)
      timeMax.setDate(timeMax.getDate() + 7)
      timeMax.setHours(23, 59, 59, 999)
      const params = new URLSearchParams({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
      })
      const cals = calendarList.value.length
        ? calendarList.value
        : [{ id: 'primary', backgroundColor: null }]
      const results = await Promise.allSettled(
        cals.map(async (cal) => {
          const res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
            { headers: { Authorization: `Bearer ${token}` } }
          )
          if (res.status === 401) { await disconnect(); return [] }
          if (!res.ok) return []
          const data = await res.json()
          return (data.items || []).map(ev => ({ ...ev, _calColor: cal.backgroundColor, _calId: cal.id }))
        })
      )
      events.value = results
        .filter(r => r.status === 'fulfilled')
        .flatMap(r => r.value)
        .sort((a, b) => new Date(a.start?.dateTime || a.start?.date) - new Date(b.start?.dateTime || b.start?.date))
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
    const token = await _ensureToken()
    if (!token) throw new Error('Not authenticated')
    const start = new Date(dateObj)
    start.setHours(startHour, startMinute, 0, 0)
    const end = new Date(start.getTime() + durationMinutes * 60_000)
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const body = {
      summary: task.content,
      description: buildEventDescription(task, projectName),
      start: { dateTime: start.toISOString(), timeZone: tz },
      end: { dateTime: end.toISOString(), timeZone: tz },
      extendedProperties: { private: { todoist_task_id: String(task.id) } },
    }
    const calId = encodeURIComponent(selectedCalendarId.value)
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calId}/events`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )
    if (!res.ok) throw new Error(`Failed to create event: ${res.status}`)
    const event = await res.json()
    const calColor = calendarList.value.find(c => c.id === selectedCalendarId.value)?.backgroundColor ?? null
    events.value.push({ ...event, _calColor: calColor, _calId: selectedCalendarId.value })
    const boardStore = useBoardStore()
    boardStore.saveGCalEvent(task.id, event.id, selectedCalendarId.value).catch(() => {})
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
      const patch = { summary: task.content, description: desc }
      if (duration && ev.start?.dateTime) {
        const start = new Date(ev.start.dateTime)
        patch.start = { dateTime: start.toISOString(), timeZone: tz }
        patch.end = { dateTime: new Date(start.getTime() + duration * 60_000).toISOString(), timeZone: tz }
      }
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(ev._calId)}/events/${ev.id}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }
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
            {
              method: 'PATCH',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(patch),
            }
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
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )
    if (!res.ok) throw new Error(`Failed to update event: ${res.status}`)
    const updated = await res.json()
    const idx = events.value.findIndex(ev => ev.id === eventId)
    if (idx !== -1) events.value[idx] = { ...events.value[idx], ...updated }
    return updated
  }

  async function deleteAllByTaskId(taskId) {
    const token = await _ensureToken()
    if (!token) return
    const cals = calendarList.value.length
      ? calendarList.value.filter(c => c.accessRole === 'writer' || c.accessRole === 'owner')
      : [{ id: selectedCalendarId.value }]
    await Promise.allSettled(cals.map(async cal => {
      const params = new URLSearchParams({ privateExtendedProperty: `todoist_task_id=${taskId}`, singleEvents: 'true', maxResults: '50' })
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) return
      const data = await res.json()
      await Promise.allSettled((data.items || []).map(ev => deleteEvent(ev.id, cal.id)))
    }))
  }

  async function updateEventTitle(taskId, title) {
    const token = await _ensureToken()
    if (!token) return
    const evs = scheduledByTaskId.value.get(String(taskId))
    if (!evs?.length) return
    const ev = evs[0]
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(ev._calId)}/events/${ev.id}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: title }),
      }
    )
    if (!res.ok) return
    const updated = await res.json()
    const idx = events.value.findIndex(e => e.id === ev.id)
    if (idx !== -1) events.value[idx] = { ...events.value[idx], ...updated }
  }

  async function linkEventToTask(eventId, calId, taskId) {
    const token = await _ensureToken()
    if (!token) throw new Error('Not authenticated')
    await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${eventId}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ extendedProperties: { private: { todoist_task_id: String(taskId) } } }),
      }
    )
    const ev = events.value.find(e => e.id === eventId)
    if (ev) {
      if (!ev.extendedProperties) ev.extendedProperties = {}
      if (!ev.extendedProperties.private) ev.extendedProperties.private = {}
      ev.extendedProperties.private.todoist_task_id = String(taskId)
    }
  }

  async function unlinkTaskFromEvent(eventId, calId) {
    const token = await _ensureToken()
    if (!token) return
    await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ extendedProperties: { private: { todoist_task_id: null } } }),
      }
    )
  }

  async function reconcileScheduledTasks() {
    const token = await _ensureToken()
    if (!token) return
    const boardStore = useBoardStore()
    const scheduledTasks = boardStore.tasks.filter(t =>
      !t.is_completed && (t.description || '').includes('📅 GCal:')
    )
    await Promise.allSettled(scheduledTasks.map(async task => {
      const stored = _parseGCalLine(task)
      if (!stored) return
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(stored.calId)}/events/${encodeURIComponent(stored.eventId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (res.status === 404 || res.status === 410) {
        await boardStore.clearScheduledTime(task.id)
        return
      }
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

  return {
    clientId, events, loading, connectError, selectedCalendarId, calendarList, writableCalendars,
    isConnected, scheduledByTaskId,
    saveClientId, saveCalendarId, connect, disconnect, init,
    loadWeekEvents, createEvent, deleteEvent, deleteAllByTaskId, updateEvent, updateEventTitle,
    syncEventForTask, fetchCalendarList, linkEventToTask, reconcileScheduledTasks, unlinkTaskFromEvent,
  }
})
