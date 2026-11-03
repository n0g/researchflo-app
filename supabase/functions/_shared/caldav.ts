// Shared CalDAV protocol utilities used by caldav-proxy and mcp Edge Functions.

import { parseIcs } from './ical.ts'

export function basicAuth(username: string, password: string): string {
  return 'Basic ' + btoa(`${username}:${password}`)
}

export interface CaldavResponse {
  status: number
  ok: boolean
  url: string
  headers: Headers
  text(): Promise<string>
}

// Manual redirect-following fetch so PROPFIND/REPORT are not silently changed to GET.
export async function caldavRequest(
  url: string,
  method: string,
  username: string,
  password: string,
  body?: string,
  extraHeaders: Record<string, string> = {},
  maxRedirects = 6,
): Promise<CaldavResponse> {
  let currentUrl = url

  for (let i = 0; i <= maxRedirects; i++) {
    const headers: Record<string, string> = {
      Authorization: basicAuth(username, password),
      Accept: 'text/xml, application/xml, */*',
      ...extraHeaders,
    }
    if (body) headers['Content-Type'] ||= 'application/xml; charset=utf-8'

    const res = await fetch(currentUrl, { method, headers, body, redirect: 'manual' })

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('Location')
      if (loc && i < maxRedirects) {
        currentUrl = loc.startsWith('http') ? loc : new URL(loc, currentUrl).toString()
        continue
      }
    }

    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      url: currentUrl,
      headers: res.headers,
      text: () => res.text(),
    }
  }

  throw new Error('Too many redirects')
}

// ── DateTime helpers ────────────────────────────────────────────────────────

function timezoneOffsetMs(tzid: string, date: Date): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(date)
    const p: Record<string, string> = {}
    for (const part of parts) p[part.type] = part.value
    const h = p.hour === '24' ? '00' : p.hour
    const localMs = new Date(`${p.year}-${p.month}-${p.day}T${h}:${p.minute}:${p.second}Z`).getTime()
    return localMs - date.getTime()
  } catch {
    return 0
  }
}

export function parseCalDAVDatetime(value: string, tzid?: string): { iso: string; isAllDay: boolean } {
  if (!value) return { iso: new Date().toISOString(), isAllDay: false }

  // All-day: YYYYMMDD
  if (/^\d{8}$/.test(value)) {
    return { iso: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`, isAllDay: true }
  }

  // UTC: YYYYMMDDTHHmmssZ
  if (value.endsWith('Z')) {
    const s = value.slice(0, -1)
    return {
      iso: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`,
      isAllDay: false,
    }
  }

  // Local time: YYYYMMDDTHHmmss
  const s = value.replace('T', '')
  const naiveIso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}`
  if (tzid) {
    try {
      const naiveDate = new Date(naiveIso + 'Z')
      const offset = timezoneOffsetMs(tzid, naiveDate)
      return { iso: new Date(naiveDate.getTime() - offset).toISOString(), isAllDay: false }
    } catch { /* fall through */ }
  }
  return { iso: new Date(naiveIso + 'Z').toISOString(), isAllDay: false }
}

// ── ICS Parser ──────────────────────────────────────────────────────────────

export interface CalDAVEvent {
  uid: string
  summary: string
  description: string
  start: string    // ISO 8601
  end: string      // ISO 8601
  isAllDay: boolean
  href?: string    // absolute URL of the resource the event lives in (needed to edit it)
}

function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '')
}

function unescape(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\N/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')
}

export function parseVEvents(icsText: string): CalDAVEvent[] {
  const events: CalDAVEvent[] = []
  const blocks = unfold(icsText).split('BEGIN:VEVENT')

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split('END:VEVENT')[0]
    const lines = block.split(/\r?\n/).filter(l => l.trim())
    const props: Record<string, { value: string; params: Record<string, string> }> = {}

    for (const line of lines) {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue
      const keyPart = line.slice(0, colonIdx)
      const value = line.slice(colonIdx + 1)
      const parts = keyPart.split(';')
      const name = parts[0].toUpperCase()
      const params: Record<string, string> = {}
      for (let j = 1; j < parts.length; j++) {
        const eq = parts[j].indexOf('=')
        if (eq !== -1) params[parts[j].slice(0, eq).toUpperCase()] = parts[j].slice(eq + 1)
      }
      if (!props[name]) props[name] = { value, params }
    }

    if (!props['UID']) continue

    const dtstart = parseCalDAVDatetime(props['DTSTART']?.value ?? '', props['DTSTART']?.params?.TZID)
    const dtend = parseCalDAVDatetime(props['DTEND']?.value ?? props['DTSTART']?.value ?? '', props['DTEND']?.params?.TZID ?? props['DTSTART']?.params?.TZID)

    events.push({
      uid: props['UID'].value,
      summary: unescape(props['SUMMARY']?.value ?? ''),
      description: unescape(props['DESCRIPTION']?.value ?? ''),
      start: dtstart.iso,
      end: dtend.iso,
      isAllDay: dtstart.isAllDay,
    })
  }

  return events
}

// ── XML Helpers ─────────────────────────────────────────────────────────────

export interface CalDAVCalendar {
  href: string
  name: string
  color: string | null
  ctag: string | null
}

export function parseCalendarListXML(xml: string, baseUrl: string): CalDAVCalendar[] {
  const calendars: CalDAVCalendar[] = []
  // Split on response elements regardless of namespace prefix
  const responseBlocks = xml.match(/<[A-Za-z0-9]*:?response[^>]*>[\s\S]*?<\/[A-Za-z0-9]*:?response>/gi) ?? []

  const basePath = new URL(baseUrl).pathname.replace(/\/?$/, '/')

  for (const block of responseBlocks) {
    const hrefMatch = block.match(/<[A-Za-z0-9]*:?href[^>]*>([^<]+)<\/[A-Za-z0-9]*:?href>/)
    if (!hrefMatch) continue
    const href = hrefMatch[1].trim()

    // Must be a calendar collection
    if (!block.includes('calendar') || !block.includes('collection')) continue

    // Skip root path (home set itself)
    const hrefPath = href.startsWith('http') ? new URL(href).pathname : href
    if (hrefPath.replace(/\/?$/, '/') === basePath) continue

    // Must support VEVENT
    if (!block.includes('VEVENT')) continue

    const nameMatch = block.match(/<[A-Za-z0-9]*:?displayname[^>]*>([^<]*)<\//)
    const name = nameMatch ? nameMatch[1].trim() : hrefPath.split('/').filter(Boolean).pop() || href

    const colorMatch = block.match(/<[A-Za-z0-9]*:?calendar-color[^>]*>#?([0-9A-Fa-f]{6,8})/)
    const color = colorMatch ? `#${colorMatch[1].slice(0, 6)}` : null

    const ctagMatch = block.match(/<[A-Za-z0-9]*:?getctag[^>]*>([^<]+)/)
    const ctag = ctagMatch ? ctagMatch[1].trim() : null

    const fullHref = href.startsWith('http') ? href : new URL(href, baseUrl).toString()
    calendars.push({ href: fullHref, name: name || 'Calendar', color, ctag })
  }

  return calendars
}

// Pulls each <calendar-data> payload (one ICS object per resource) out of a multistatus body.
function extractCalendarData(xml: string): string[] {
  const out: string[] = []
  // Alternation handles self-closing <calendar-data/> so it can't swallow the next response.
  const calDataRe = /<[A-Za-z0-9]*:?calendar-data\b[^>]*?(?:\/>|>([\s\S]*?)<\/[A-Za-z0-9]*:?calendar-data>)/gi
  let match
  while ((match = calDataRe.exec(xml)) !== null) {
    if (match[1] === undefined) continue // self-closing: no payload
    out.push(
      match[1]
        .replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '') // some servers wrap the ICS in CDATA
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&#10;/g, '\n').replace(/&#13;/g, '\r')
        .replace(/&amp;/g, '&'),
    )
  }
  return out
}

export function parseEventsXML(xml: string): CalDAVEvent[] {
  return extractCalendarData(xml).flatMap(parseVEvents)
}

/** One ICS object → events inside [timeMin, timeMax], with recurrence expanded. */
function icsToEvents(ics: string, timeMin: Date, timeMax: Date): CalDAVEvent[] {
  if (!ics.trim()) return []
  try {
    const { events } = parseIcs(ics, timeMin, timeMax)
    return events.map(e => ({
      // Keep the real UID for single events: tasks link to calendar events by it.
      uid: e.recurring ? e.uid : e.baseUid,
      summary: e.summary,
      description: e.description,
      start: e.start,
      end: e.end,
      isAllDay: e.isAllDay,
    }))
  } catch (err) {
    // Log structure only (message + first characters), never event content.
    console.error('ICS parse failed, using basic parser:', err instanceof Error ? err.message : err, JSON.stringify(ics.slice(0, 24)))
    return parseVEvents(ics)
  }
}

interface DavResource { url: string; etag: string | null; payload: string }

/** Splits a multistatus body into resources (event objects), skipping collections. */
function parseResources(xml: string, baseUrl: string): DavResource[] {
  const out: DavResource[] = []
  for (const block of xml.match(/<[A-Za-z0-9]*:?response[\s>][\s\S]*?<\/[A-Za-z0-9]*:?response>/gi) ?? []) {
    const h = block.match(/<[A-Za-z0-9]*:?href[^>]*>([^<]+)<\/[A-Za-z0-9]*:?href>/i)
    if (!h) continue
    const href = h[1].trim().replace(/&amp;/g, '&')
    if (href.endsWith('/')) continue // a collection, not an event
    let url: string
    try { url = new URL(href, baseUrl).toString() } catch { continue }
    const etag = block.match(/<[A-Za-z0-9]*:?getetag[^>]*>([^<]*)<\/[A-Za-z0-9]*:?getetag>/i)?.[1].trim() || null
    out.push({ url, etag, payload: extractCalendarData(block)[0] ?? '' })
  }
  return out
}

// Fetched ICS bodies by user + resource URL + etag. An etag changes whenever the event does,
// so a hit is always current. Keyed by username so one account's permissions never leak
// to another through the shared isolate.
const icsCache = new Map<string, string>()
const ICS_CACHE_MAX = 500
function icsCacheSet(key: string, ics: string) {
  if (icsCache.size >= ICS_CACHE_MAX) icsCache.delete(icsCache.keys().next().value!)
  icsCache.set(key, ics)
}

// ── CalDAV Protocol Operations ───────────────────────────────────────────────

export async function discoverCalDAV(
  url: string,
  username: string,
  password: string,
): Promise<{ homeSetUrl: string; serverUrl: string }> {
  const principalBody = `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>`

  const res = await caldavRequest(url, 'PROPFIND', username, password, principalBody, { Depth: '0' })
  if (res.status !== 207 && !res.ok) {
    const body = await res.text()
    throw new Error(`CalDAV PROPFIND failed (${res.status}): ${body.slice(0, 200)}`)
  }

  const xml = await res.text()
  const serverUrl = res.url

  const principalMatch = xml.match(/<[A-Za-z0-9]*:?current-user-principal[^>]*>[\s\S]*?<[A-Za-z0-9]*:?href[^>]*>([^<]+)/)
  if (!principalMatch) throw new Error('Server did not return current-user-principal. Check credentials.')

  const principalPath = principalMatch[1].trim()
  const principalUrl = principalPath.startsWith('http') ? principalPath : new URL(principalPath, serverUrl).toString()

  const homeBody = `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-home-set/></D:prop></D:propfind>`

  const homeRes = await caldavRequest(principalUrl, 'PROPFIND', username, password, homeBody, { Depth: '0' })
  const homeXml = await homeRes.text()

  const homeMatch = homeXml.match(/<[A-Za-z0-9]*:?calendar-home-set[^>]*>[\s\S]*?<[A-Za-z0-9]*:?href[^>]*>([^<]+)/)
  if (!homeMatch) throw new Error('Server did not return calendar-home-set.')

  const homePath = homeMatch[1].trim()
  const homeSetUrl = homePath.startsWith('http') ? homePath : new URL(homePath, principalUrl).toString()

  return { homeSetUrl, serverUrl }
}

export async function listCalendarsFromHomeSet(
  homeSetUrl: string,
  username: string,
  password: string,
): Promise<CalDAVCalendar[]> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/" xmlns:A="http://apple.com/ns/ical/">
  <D:prop>
    <D:displayname/>
    <D:resourcetype/>
    <CS:getctag/>
    <A:calendar-color/>
    <C:supported-calendar-component-set/>
  </D:prop>
</D:propfind>`

  const res = await caldavRequest(homeSetUrl, 'PROPFIND', username, password, body, { Depth: '1' })
  if (res.status !== 207 && !res.ok) throw new Error(`List calendars failed: ${res.status}`)
  const xml = await res.text()
  return parseCalendarListXML(xml, homeSetUrl)
}

export async function getCalendarEvents(
  calHref: string,
  username: string,
  password: string,
  timeMin: Date,
  timeMax: Date,
): Promise<CalDAVEvent[]> {
  const fmt = (d: Date) => d.toISOString().replace(/[-:.]/g, '').replace(/\d{3}Z$/, 'Z')

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop><D:getetag/><C:calendar-data/></D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${fmt(timeMin)}" end="${fmt(timeMax)}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`

  const res = await caldavRequest(calHref, 'REPORT', username, password, body, { Depth: '1' })
  if (res.status !== 207 && !res.ok) {
    console.error('REPORT failed:', res.status)
    return []
  }
  const xml = await res.text()
  const resources = parseResources(xml, calHref)
  const events: CalDAVEvent[] = []
  const toFetch: DavResource[] = []

  for (const r of resources) {
    if (r.payload.trim()) {
      events.push(...icsToEvents(r.payload, timeMin, timeMax).map(e => ({ ...e, href: r.url })))
    } else {
      toFetch.push(r)
    }
  }

  // Some servers (Stalwart, for events created via JMAP) list an event with 200 OK but an empty
  // <calendar-data>. Fetch those one by one (cached by etag).
  const fallback = { empties: toFetch.length, cached: 0, nonEmpty: 0, statuses: {} as Record<string, number> }
  if (toFetch.length) {
    const fetched = await Promise.all(toFetch.slice(0, 40).map(async ({ url, etag }) => {
      const key = etag ? `${username}|${url}|${etag}` : null
      const hit = key ? icsCache.get(key) : undefined
      if (hit !== undefined) return { url, status: 200, text: hit, cached: true }
      try {
        const r = await caldavRequest(url, 'GET', username, password, undefined, { Accept: 'text/calendar, */*' })
        const text = r.ok ? await r.text() : ''
        if (key && text.trim()) icsCacheSet(key, text)
        return { url, status: r.status, text, cached: false }
      } catch {
        return { url, status: 0, text: '', cached: false }
      }
    }))
    for (const f of fetched) {
      if (f.cached) fallback.cached++
      fallback.statuses[f.status] = (fallback.statuses[f.status] ?? 0) + 1
      if (f.text.trim()) {
        fallback.nonEmpty++
        events.push(...icsToEvents(f.text, timeMin, timeMax).map(e => ({ ...e, href: f.url })))
      }
    }
  }

  // Diagnostics: counts and app-generated UIDs only, never event content.
  console.log('caldav get_events', JSON.stringify({
    status: res.status,
    xmlLen: xml.length,
    resources: resources.length,
    fallback,
    parsed: events.length,
    ours: (xml.match(/UID:[^\r\n<&]*@researchflo\.app/g) ?? []).slice(0, 5),
  }))
  return events
}

// ── Moving an existing event ────────────────────────────────────────────────

function foldLine(line: string): string {
  if (line.length <= 75) return line
  const parts: string[] = [line.slice(0, 75)]
  for (let i = 75; i < line.length; i += 74) parts.push(' ' + line.slice(i, i + 74))
  return parts.join('\r\n')
}

/**
 * Returns `ics` with only the event's start/end changed (written as UTC), keeping every other
 * property (attendees, alarms, description, custom X- properties) as it was. Refuses recurring
 * events and objects with more than one VEVENT, since moving one part of a series needs
 * override handling this does not implement.
 */
export function shiftEventICS(ics: string, newStart: Date, newEnd: Date): string {
  const lines = unfold(ics).split(/\r?\n/).filter(l => l.trim() !== '')
  const names = lines.map(l => l.split(/[:;]/, 1)[0].toUpperCase())
  if (names.filter(n => n === 'BEGIN').length && lines.filter(l => l.toUpperCase() === 'BEGIN:VEVENT').length !== 1) {
    throw new Error('This item has several parts and cannot be moved from here')
  }
  if (names.some(n => n === 'RRULE' || n === 'RDATE' || n === 'RECURRENCE-ID')) {
    throw new Error('Recurring events cannot be moved from here')
  }
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')

  const out: string[] = []
  let inEvent = false
  let sawStart = false
  let wroteEnd = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const name = names[i]
    const upper = line.toUpperCase()
    if (upper === 'BEGIN:VEVENT') inEvent = true
    if (inEvent && name === 'DTSTART') { out.push(`DTSTART:${fmt(newStart)}`); sawStart = true; continue }
    if (inEvent && (name === 'DTEND' || name === 'DURATION')) {
      if (!wroteEnd) { out.push(`DTEND:${fmt(newEnd)}`); wroteEnd = true }
      continue
    }
    if (inEvent && name === 'SEQUENCE') {
      out.push(`SEQUENCE:${(parseInt(line.slice(line.indexOf(':') + 1), 10) || 0) + 1}`)
      continue
    }
    if (upper === 'END:VEVENT') {
      if (!wroteEnd) { out.push(`DTEND:${fmt(newEnd)}`); wroteEnd = true }
      inEvent = false
    }
    out.push(line)
  }
  if (!sawStart) throw new Error('Event has no start time')
  return out.map(foldLine).join('\r\n') + '\r\n'
}

// ── ICS Builder ─────────────────────────────────────────────────────────────

export function buildICS(
  uid: string,
  summary: string,
  description: string,
  start: Date,
  end: Date,
): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:.]/g, '').replace(/\d{3}Z$/, 'Z')
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ResearchFlo//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(summary)}`,
  ]
  if (description) lines.push(`DESCRIPTION:${esc(description)}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n')
}
