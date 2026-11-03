// Read-only ICS feed support: safe fetching + parsing with recurrence expansion.
// Used by the ical-proxy Edge Function.
//
// Handles what the hand-rolled parser in caldav.ts does not: RRULE/EXDATE,
// RECURRENCE-ID overrides, VTIMEZONE blocks, and Windows time zone names
// ("W. Europe Standard Time") as emitted by Outlook / Microsoft 365.

import ICAL from 'npm:ical.js@2.1.0'

export interface IcalEvent {
  uid: string          // unique per occurrence: "<uid>@<start>"
  baseUid: string      // the event's own UID (shared by all occurrences of a series)
  recurring: boolean   // true for series occurrences and their overrides
  summary: string
  description: string
  location: string
  start: string        // ISO instant, or YYYY-MM-DD when isAllDay
  end: string          // ISO instant, or YYYY-MM-DD (exclusive) when isAllDay
  isAllDay: boolean
}

const MAX_BYTES = 10 * 1024 * 1024
const FETCH_TIMEOUT_MS = 20_000
const MAX_REDIRECTS = 3
const MAX_ITERATIONS = 20_000
const MAX_EVENTS = 2_000

// ── Fetching ────────────────────────────────────────────────────────────────

export function normalizeIcsUrl(raw: string): URL {
  let s = (raw ?? '').trim()
  if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:\/\//i, 'https://')
  let u: URL
  try { u = new URL(s) } catch { throw new Error('Invalid URL') }
  if (u.protocol !== 'https:') throw new Error('Only https:// (or webcal://) URLs are supported')
  return u
}

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

async function assertPublicHost(u: URL): Promise<void> {
  const host = u.hostname.toLowerCase()
  if (
    host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
    host.endsWith('.internal') || host.endsWith('.localdomain') ||
    host.startsWith('[') || // IPv6 literal
    isPrivateIPv4(host)
  ) throw new Error('This host is not allowed')

  // Best effort: reject hostnames that resolve to private addresses.
  try {
    const addrs = await Deno.resolveDns(host, 'A')
    if (addrs.some(isPrivateIPv4)) throw new Error('This host is not allowed')
  } catch (e) {
    if (e instanceof Error && e.message === 'This host is not allowed') throw e
    // DNS API unavailable or no A record: let fetch() decide.
  }
}

export async function fetchIcs(rawUrl: string): Promise<string> {
  let url = normalizeIcsUrl(rawUrl)

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url)
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { Accept: 'text/calendar, text/plain, */*', 'User-Agent': 'researchflo-ical/1.0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('Location')
      if (!loc) throw new Error('Redirect without Location header')
      url = normalizeIcsUrl(new URL(loc, url).toString())
      continue
    }
    if (!res.ok) throw new Error(`Calendar server returned ${res.status}`)

    const len = Number(res.headers.get('Content-Length') ?? 0)
    if (len > MAX_BYTES) throw new Error('Calendar file is too large')

    // Stream with a hard size cap (Content-Length can be absent or wrong).
    const reader = res.body?.getReader()
    if (!reader) throw new Error('Empty response')
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > MAX_BYTES) { await reader.cancel(); throw new Error('Calendar file is too large') }
      chunks.push(value)
    }
    const buf = new Uint8Array(total)
    let off = 0
    for (const c of chunks) { buf.set(c, off); off += c.length }
    const text = new TextDecoder('utf-8').decode(buf)
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('URL did not return an ICS calendar')
    return text
  }
  throw new Error('Too many redirects')
}

// ── Time zones ──────────────────────────────────────────────────────────────

// Windows zone names (Outlook) → IANA. Only used when the feed has no
// matching VTIMEZONE block and the name isn't already an IANA id.
const WINDOWS_TZ: Record<string, string> = {
  'UTC': 'UTC',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'GMT Standard Time': 'Europe/London',
  'GTB Standard Time': 'Europe/Bucharest',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Atlantic Standard Time': 'America/Halifax',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'India Standard Time': 'Asia/Kolkata',
  'Arabian Standard Time': 'Asia/Dubai',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
}

function resolveIana(tzid: string): string | null {
  const candidates = [tzid, WINDOWS_TZ[tzid]].filter(Boolean) as string[]
  for (const c of candidates) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: c }); return c } catch { /* next */ }
  }
  return null
}

function tzOffsetMs(tz: string, atUtcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(atUtcMs))
  const p: Record<string, number> = {}
  for (const x of parts) if (x.type !== 'literal') p[x.type] = Number(x.value)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(atUtcMs / 1000) * 1000
}

function wallClockToInstant(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s)
  let t = guess - tzOffsetMs(tz, guess)
  t = guess - tzOffsetMs(tz, t) // second pass settles DST boundaries
  return t
}

// ── Parsing ─────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
type AnyTime = any

/** ICAL.Time → epoch ms. Falls back to wall-clock + IANA/Windows tz when the feed has no VTIMEZONE for it. */
function toEpochMs(t: AnyTime, tzid: string | null, fallbackTz: string | null): number {
  const zone = t.zone
  const isFloating = !zone || zone.tzid === 'floating'
  if (!isFloating) return t.toJSDate().getTime()
  const tz = (tzid && resolveIana(tzid)) || fallbackTz || 'UTC'
  return wallClockToInstant(t.year, t.month, t.day, t.hour, t.minute, t.second, tz)
}

// deno-lint-ignore no-explicit-any
function tzidOf(vevent: any, prop: string): string | null {
  const p = vevent.getFirstProperty(prop)
  return (p?.getParameter('tzid') as string | undefined) ?? null
}

export function parseIcs(
  icsText: string,
  timeMin: Date,
  timeMax: Date,
  fallbackTz: string | null = null,
): { name: string | null; events: IcalEvent[] } {
  // ical.js throws on anything before BEGIN:VCALENDAR (BOM, or the newline/indent that
  // CalDAV servers leave around <calendar-data> in XML), so cut to the real start.
  const startIdx = icsText.search(/BEGIN:VCALENDAR/i)
  const cleaned = (startIdx > 0 ? icsText.slice(startIdx) : icsText).replace(/^\uFEFF/, '').trimEnd()
  const comp = new ICAL.Component(ICAL.parse(cleaned))
  const name = (comp.getFirstPropertyValue('x-wr-calname') as string | null) ?? null

  // Register the feed's own time zone definitions (single synchronous pass, so
  // the global TimezoneService can't be interleaved with another request).
  ICAL.TimezoneService.reset()
  for (const vtz of comp.getAllSubcomponents('vtimezone')) {
    try { ICAL.TimezoneService.register(new ICAL.Timezone(vtz)) } catch { /* skip bad tz */ }
  }

  try {
    const minMs = timeMin.getTime()
    const maxMs = timeMax.getTime()
    const out: IcalEvent[] = []

    const masters = new Map<string, AnyTime>()
    const exceptions: AnyTime[] = []
    const singles: AnyTime[] = []

    for (const vevent of comp.getAllSubcomponents('vevent')) {
      if (String(vevent.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') continue
      if (!vevent.hasProperty('dtstart')) continue
      const ev = new ICAL.Event(vevent)
      if (ev.isRecurrenceException()) exceptions.push(ev)
      else if (ev.isRecurring()) masters.set(ev.uid, ev)
      else singles.push(ev)
    }
    // Overrides whose master is missing from the feed are shown as plain events.
    const orphanExceptions: AnyTime[] = []
    for (const ex of exceptions) {
      const m = masters.get(ex.uid)
      if (m) m.relateException(ex)
      else orphanExceptions.push(ex)
    }

    // deno-lint-ignore no-explicit-any
    const push = (ev: any, startT: AnyTime, endT: AnyTime, recurring = false) => {
      if (out.length >= MAX_EVENTS) return
      const startTz = tzidOf(ev.component, 'dtstart')
      const endTz = tzidOf(ev.component, 'dtend') ?? startTz
      const isAllDay = !!startT.isDate
      let start: string, end: string, sMs: number, eMs: number
      if (isAllDay) {
        start = startT.toString()
        end = endT.toString()
        sMs = Date.UTC(startT.year, startT.month - 1, startT.day)
        eMs = Date.UTC(endT.year, endT.month - 1, endT.day)
      } else {
        sMs = toEpochMs(startT, startTz, fallbackTz)
        eMs = toEpochMs(endT, endTz, fallbackTz)
        if (eMs < sMs) eMs = sMs
        start = new Date(sMs).toISOString()
        end = new Date(eMs).toISOString()
      }
      if (eMs <= minMs && !(eMs === sMs && sMs === minMs)) return
      if (sMs >= maxMs) return
      out.push({
        uid: `${ev.uid}@${start}`,
        baseUid: ev.uid,
        recurring,
        summary: ev.summary ?? '',
        description: ev.description ?? '',
        location: ev.location ?? '',
        start, end, isAllDay,
      })
    }

    for (const ev of singles) push(ev, ev.startDate, ev.endDate)
    for (const ev of orphanExceptions) push(ev, ev.startDate, ev.endDate)
    // Overrides of recurring events (including ones moved into the window).
    for (const ev of exceptions) if (masters.has(ev.uid)) push(ev, ev.startDate, ev.endDate, true)

    for (const master of masters.values()) {
      const it = master.iterator()
      let next: AnyTime
      let n = 0
      while ((next = it.next()) && n++ < MAX_ITERATIONS) {
        // Wall-clock lower bound on the instant; 2-day margin covers any tz offset.
        const approxMs = Date.UTC(next.year, next.month - 1, next.day, next.hour, next.minute, next.second)
        if (approxMs > maxMs + 2 * 86_400_000) break
        const d = master.getOccurrenceDetails(next)
        if (d.item !== master) continue // overridden; emitted above
        push(master, d.startDate, d.endDate, true)
      }
    }

    out.sort((a, b) => a.start.localeCompare(b.start))
    return { name, events: out }
  } finally {
    ICAL.TimezoneService.reset()
  }
}
