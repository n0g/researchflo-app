import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  discoverCalDAV,
  listCalendarsFromHomeSet,
  getCalendarEvents,
  buildICS,
  caldavRequest,
} from '../_shared/caldav.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Auth: user's Supabase JWT
  const bearer = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!bearer) return json({ error: 'Unauthorized' }, 401)
  const { data: { user }, error: authErr } = await admin.auth.getUser(bearer)
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  // deno-lint-ignore no-explicit-any
  let body: Record<string, any>
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const { action, source_id, url, username, password } = body

  // Resolve credentials — either from a saved source or inline (for initial connect)
  let creds: { url: string; username: string; password: string } | null = null

  if (source_id) {
    const { data: src } = await admin.from('calendar_sources')
      .select('url, username, password')
      .eq('id', source_id)
      .eq('user_id', user.id)
      .single()
    if (!src) return json({ error: 'Calendar source not found' }, 404)
    creds = { url: src.url!, username: src.username!, password: src.password! }
  } else if (url && username && password) {
    creds = { url, username, password }
  } else {
    return json({ error: 'Provide source_id or url+username+password' }, 400)
  }

  try {
    switch (action) {
      case 'discover': {
        const { homeSetUrl, serverUrl } = await discoverCalDAV(creds.url, creds.username, creds.password)
        const calendars = await listCalendarsFromHomeSet(homeSetUrl, creds.username, creds.password)
        return json({ calendars, homeSetUrl, serverUrl })
      }

      case 'list_calendars': {
        const calendars = await listCalendarsFromHomeSet(creds.url, creds.username, creds.password)
        return json({ calendars })
      }

      case 'get_events': {
        const { cal_href, time_min, time_max } = body
        if (!cal_href || !time_min || !time_max) return json({ error: 'Missing cal_href, time_min, or time_max' }, 400)
        const events = await getCalendarEvents(cal_href, creds.username, creds.password, new Date(time_min), new Date(time_max))
        return json({ events })
      }

      case 'create_event': {
        const { cal_href, uid, summary, description, start_iso, end_iso } = body
        if (!cal_href || !uid || !summary || !start_iso) {
          return json({ error: 'Missing cal_href, uid, summary, or start_iso' }, 400)
        }
        const start = new Date(start_iso)
        const end = end_iso ? new Date(end_iso) : new Date(start.getTime() + 60 * 60_000)
        const icsData = buildICS(uid, summary, description ?? '', start, end)
        const putUrl = cal_href.endsWith('/') ? `${cal_href}${uid}.ics` : `${cal_href}/${uid}.ics`
        const res = await caldavRequest(putUrl, 'PUT', creds.username, creds.password, icsData, {
          'Content-Type': 'text/calendar; charset=utf-8',
          'If-None-Match': '*',
        })
        if (!res.ok && res.status !== 201 && res.status !== 204) {
          return json({ error: `PUT failed: ${res.status}` }, res.status)
        }
        return json({ href: putUrl, etag: res.headers.get('ETag') })
      }

      case 'update_event': {
        const { event_href, uid, summary, description, start_iso, end_iso, etag } = body
        if (!event_href || !summary || !start_iso) {
          return json({ error: 'Missing event_href, summary, or start_iso' }, 400)
        }
        const start = new Date(start_iso)
        const end = end_iso ? new Date(end_iso) : new Date(start.getTime() + 60 * 60_000)
        const resolvedUid = uid || event_href.split('/').pop()?.replace('.ics', '') || 'event'
        const icsData = buildICS(resolvedUid, summary, description ?? '', start, end)
        const extra: Record<string, string> = { 'Content-Type': 'text/calendar; charset=utf-8' }
        if (etag) extra['If-Match'] = etag
        const res = await caldavRequest(event_href, 'PUT', creds.username, creds.password, icsData, extra)
        if (!res.ok && res.status !== 204) return json({ error: `PUT failed: ${res.status}` }, res.status)
        return json({ etag: res.headers.get('ETag') })
      }

      case 'delete_event': {
        const { event_href } = body
        if (!event_href) return json({ error: 'Missing event_href' }, 400)
        const res = await caldavRequest(event_href, 'DELETE', creds.username, creds.password)
        if (!res.ok && res.status !== 204 && res.status !== 404) {
          return json({ error: `DELETE failed: ${res.status}` }, res.status)
        }
        return json({ ok: true })
      }

      case 'get_event': {
        const { event_href } = body
        if (!event_href) return json({ error: 'Missing event_href' }, 400)
        const res = await caldavRequest(event_href, 'GET', creds.username, creds.password)
        if (res.status === 404 || res.status === 410) return json({ found: false })
        if (!res.ok) return json({ error: `GET failed: ${res.status}` }, res.status)
        const ics = await res.text()
        const { parseVEvents } = await import('../_shared/caldav.ts')
        const events = parseVEvents(ics)
        if (!events.length) return json({ found: false })
        return json({ found: true, event: events[0] })
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (err) {
    console.error('caldav-proxy error:', err)
    return json({ error: (err as Error).message }, 500)
  }
})
