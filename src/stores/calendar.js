import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { GCAL_CLIENT_ID } from '../config.js'
import { useBoardStore } from './board.js'

const SYNC_QUEUE_KEY = 'rb_cal_sync_queue'
function _getSyncQueue() {
  try { return new Set(JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]')) } catch { return new Set() }
}
function _saveSyncQueue(q) { localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify([...q])) }
function _queueTaskSync(taskId) { const q = _getSyncQueue(); q.add(String(taskId)); _saveSyncQueue(q) }
function _dequeueTaskSync(taskId) { const q = _getSyncQueue(); q.delete(String(taskId)); _saveSyncQueue(q) }

const BAKED_CLIENT_ID = import.meta.env.VITE_GCAL_CLIENT_ID || GCAL_CLIENT_ID
const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly'

export const useCalendarStore = defineStore('calendar', () => {
  const clientId = ref(BAKED_CLIENT_ID || localStorage.getItem('rb_gcal_client_id') || '')
  const accessToken = ref(localStorage.getItem('rb_gcal_token') || '')
  const tokenExpiry = ref(parseInt(localStorage.getItem('rb_gcal_token_expiry') || '0'))
  const selectedCalendarId = ref(localStorage.getItem('rb_gcal_calendar_id') || 'primary')
  const calendarList = ref([])
  const events = ref([])
  const loading = ref(false)
  const connectError = ref('')
  let _refreshTimer = null

  const isConnected = computed(() => !!accessToken.value && Date.now() < tokenExpiry.value)

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

  function saveClientId(id) {
    clientId.value = id.trim()
    localStorage.setItem('rb_gcal_client_id', clientId.value)
  }

  function _storeToken(token, expiresIn) {
    accessToken.value = token
    const expiry = Date.now() + (Number(expiresIn) - 60) * 1000
    tokenExpiry.value = expiry
    localStorage.setItem('rb_gcal_token', token)
    localStorage.setItem('rb_gcal_token_expiry', String(expiry))
    _scheduleRefresh()
  }

  function _scheduleRefresh() {
    if (_refreshTimer) clearTimeout(_refreshTimer)
    const msUntilRefresh = tokenExpiry.value - Date.now() - 5 * 60 * 1000
    if (msUntilRefresh > 0) {
      _refreshTimer = setTimeout(() => _silentRefresh(), msUntilRefresh)
    }
  }

  function _initClient(callback) {
    return window.google.accounts.oauth2.initTokenClient({
      client_id: clientId.value,
      scope: SCOPES,
      callback,
      error_callback: (err) => callback({ error: err.type }),
    })
  }

  function connect() {
    connectError.value = ''
    if (!clientId.value) { connectError.value = 'Enter a Client ID first.'; return }
    if (!window.google?.accounts?.oauth2) { connectError.value = 'Google Identity Services not loaded — refresh and try again.'; return }
    _initClient((resp) => {
      if (resp.error) { connectError.value = resp.error_description || resp.error; return }
      _storeToken(resp.access_token, resp.expires_in)
      connectError.value = ''
    }).requestAccessToken()
  }

  function _silentRefresh() {
    if (!clientId.value || !window.google?.accounts?.oauth2) return Promise.resolve(false)
    return new Promise((resolve) => {
      _initClient((resp) => {
        if (resp.error) { resolve(false); return }
        _storeToken(resp.access_token, resp.expires_in)
        resolve(true)
      }).requestAccessToken({ prompt: '' })
    })
  }

  async function _ensureToken() {
    if (isConnected.value) return true
    return _silentRefresh()
  }

  function saveCalendarId(id) {
    selectedCalendarId.value = id
    localStorage.setItem('rb_gcal_calendar_id', id)
  }

  async function fetchCalendarList() {
    if (!await _ensureToken()) return
    try {
      const res = await fetch(
        'https://www.googleapis.com/calendar/v3/users/me/calendarList',
        { headers: { Authorization: `Bearer ${accessToken.value}` } }
      )
      if (!res.ok) return
      const data = await res.json()
      calendarList.value = data.items || []
      // Reset stored calendar ID if it no longer exists in this account
      if (selectedCalendarId.value !== 'primary') {
        const ids = new Set(calendarList.value.map(c => c.id))
        if (!ids.has(selectedCalendarId.value)) saveCalendarId('primary')
      }
    } catch {}
  }

  function disconnect() {
    if (accessToken.value) {
      try { window.google?.accounts?.oauth2?.revoke(accessToken.value) } catch {}
    }
    accessToken.value = ''
    tokenExpiry.value = 0
    events.value = []
    calendarList.value = []
    localStorage.removeItem('rb_gcal_token')
    localStorage.removeItem('rb_gcal_token_expiry')
  }

  async function loadWeekEvents(weekStart) {
    if (!await _ensureToken()) return
    // Fetch calendar list first if we don't have it yet (needed for colors)
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
            { headers: { Authorization: `Bearer ${accessToken.value}` } }
          )
          if (res.status === 401) { disconnect(); return [] }
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
    if (!await _ensureToken()) throw new Error('Not authenticated')
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
        headers: {
          Authorization: `Bearer ${accessToken.value}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    )
    if (!res.ok) throw new Error(`Failed to create event: ${res.status}`)
    const event = await res.json()
    const calColor = calendarList.value.find(c => c.id === selectedCalendarId.value)?.backgroundColor ?? null
    events.value.push({ ...event, _calColor: calColor, _calId: selectedCalendarId.value })
    // Store event ID in Todoist so future syncs can PATCH directly without a Calendar search
    const boardStore = useBoardStore()
    boardStore.saveGCalEvent(task.id, event.id, selectedCalendarId.value).catch(() => {})
    return event
  }

  async function _patchEvents(evs, task, projectName) {
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
          headers: { Authorization: `Bearer ${accessToken.value}`, 'Content-Type': 'application/json' },
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
    if (!await _ensureToken()) {
      _queueTaskSync(task.id)
      return
    }
    const stored = _parseGCalLine(task)
    if (stored) {
      const memEv = events.value.find(e => e.id === stored.eventId)
      await _patchEvents([memEv || { id: stored.eventId, _calId: stored.calId }], task, projectName)
      _dequeueTaskSync(task.id)
      return
    }
    // Fallback: use in-memory map (tasks scheduled before this feature)
    const evs = scheduledByTaskId.value.get(String(task.id)) || []
    if (!evs.length) { _dequeueTaskSync(task.id); return }
    await _patchEvents(evs, task, projectName)
    _dequeueTaskSync(task.id)
  }

  async function drainSyncQueue() {
    const q = _getSyncQueue()
    if (!q.size) return
    if (!await _ensureToken()) return
    const boardStore = useBoardStore()
    await Promise.allSettled([...q].map(async taskId => {
      const task = boardStore.tasks.find(t => t.id === taskId)
      if (!task) { _dequeueTaskSync(taskId); return }
      const stored = _parseGCalLine(task)
      const projectName = boardStore.projects.find(p => p.id === task.project_id)?.name ?? ''
      if (stored) {
        // GET the event before patching so we can compare timestamps and avoid
        // overwriting a newer calendar title with a stale Todoist title.
        const getRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(stored.calId)}/events/${encodeURIComponent(stored.eventId)}`,
          { headers: { Authorization: `Bearer ${accessToken.value}` } }
        )
        if (getRes.ok) {
          const ev = await getRes.json()
          const calUpdated = ev.updated ? new Date(ev.updated).getTime() : 0
          const taskUpdated = task.updated_at ? new Date(task.updated_at).getTime() : 0
          // Always push description (Todoist-only field, no reverse sync).
          // Only push title if Todoist is at least as new as the calendar event.
          const patch = { description: buildEventDescription(task, projectName) }
          if (taskUpdated >= calUpdated) patch.summary = task.content
          const patchRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(stored.calId)}/events/${encodeURIComponent(stored.eventId)}`,
            {
              method: 'PATCH',
              headers: { Authorization: `Bearer ${accessToken.value}`, 'Content-Type': 'application/json' },
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
      // Fallback: Calendar API search (tasks scheduled before GCal ID was stored)
      const cals = calendarList.value.length
        ? calendarList.value.filter(c => c.accessRole === 'writer' || c.accessRole === 'owner')
        : [{ id: selectedCalendarId.value }]
      const evs = []
      await Promise.allSettled(cals.map(async cal => {
        const params = new URLSearchParams({ privateExtendedProperty: `todoist_task_id=${taskId}`, singleEvents: 'true', maxResults: '10' })
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
          { headers: { Authorization: `Bearer ${accessToken.value}` } }
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
    if (!await _ensureToken()) throw new Error('Not authenticated')
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${eventId}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken.value}` } }
    )
    if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`Failed to delete event: ${res.status}`)
    events.value = events.value.filter(ev => ev.id !== eventId)
  }

  async function updateEvent(eventId, calId, newStart, newEnd) {
    if (!await _ensureToken()) throw new Error('Not authenticated')
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const body = {
      start: { dateTime: newStart.toISOString(), timeZone: tz },
      end: { dateTime: newEnd.toISOString(), timeZone: tz },
    }
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${eventId}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken.value}`, 'Content-Type': 'application/json' },
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
    if (!await _ensureToken()) return
    const cals = calendarList.value.length
      ? calendarList.value.filter(c => c.accessRole === 'writer' || c.accessRole === 'owner')
      : [{ id: selectedCalendarId.value }]
    await Promise.allSettled(cals.map(async cal => {
      const params = new URLSearchParams({
        privateExtendedProperty: `todoist_task_id=${taskId}`,
        singleEvents: 'true',
        maxResults: '50',
      })
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
        { headers: { Authorization: `Bearer ${accessToken.value}` } }
      )
      if (!res.ok) return
      const data = await res.json()
      await Promise.allSettled((data.items || []).map(ev => deleteEvent(ev.id, cal.id)))
    }))
  }

  async function updateEventTitle(taskId, title) {
    if (!await _ensureToken()) return
    const evs = scheduledByTaskId.value.get(String(taskId))
    if (!evs?.length) return
    const ev = evs[0]
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(ev._calId)}/events/${ev.id}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken.value}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: title }),
      }
    )
    if (!res.ok) return
    const updated = await res.json()
    const idx = events.value.findIndex(e => e.id === ev.id)
    if (idx !== -1) events.value[idx] = { ...events.value[idx], ...updated }
  }

  // Proactive refresh: schedule on startup if we already have a stored token
  _scheduleRefresh()

  // Refresh on app focus in case the token expired while the app was in the background
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && accessToken.value && !isConnected.value) {
        _silentRefresh()
      }
    })
  }

  watch(isConnected, (connected) => { if (connected) drainSyncQueue().catch(() => {}) })

  async function linkEventToTask(eventId, calId, taskId) {
    if (!await _ensureToken()) throw new Error('Not authenticated')
    await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${eventId}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken.value}`, 'Content-Type': 'application/json' },
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
    if (!await _ensureToken()) return
    await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken.value}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ extendedProperties: { private: { todoist_task_id: null } } }),
      }
    )
  }

  async function reconcileScheduledTasks() {
    if (!await _ensureToken()) return
    const boardStore = useBoardStore()
    const scheduledTasks = boardStore.tasks.filter(t =>
      !t.is_completed && (t.description || '').includes('📅 GCal:')
    )
    await Promise.allSettled(scheduledTasks.map(async task => {
      const stored = _parseGCalLine(task)
      if (!stored) return
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(stored.calId)}/events/${encodeURIComponent(stored.eventId)}`,
        { headers: { Authorization: `Bearer ${accessToken.value}` } }
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
      if (calIso !== savedIso) {
        await boardStore.saveScheduledTime(task.id, calIso)
      }
    }))
  }

  return {
    clientId, events, loading, connectError, selectedCalendarId, calendarList, writableCalendars,
    isConnected, scheduledByTaskId,
    saveClientId, saveCalendarId, connect, disconnect,
    loadWeekEvents, createEvent, deleteEvent, deleteAllByTaskId, updateEvent, updateEventTitle, syncEventForTask, fetchCalendarList,
    linkEventToTask, reconcileScheduledTasks, unlinkTaskFromEvent,
  }
})
