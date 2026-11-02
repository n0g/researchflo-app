import { createClient } from 'npm:@supabase/supabase-js@2'
import { fetchIcs, parseIcs } from '../_shared/ical.ts'

// Server-side proxy for read-only ICS feeds (e.g. Outlook "Publish calendar" links).
// Browsers can't fetch these directly (no CORS headers), and the feed URL is a
// secret, so it stays in calendar_sources and is only used here.
//
// Actions:
//   test        { url }                                  → { name, event_count }
//   get_events  { source_id, time_min, time_max, tz? }   → { events }

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

// Short-lived per-isolate cache so paging between weeks doesn't re-download a
// multi-megabyte feed every time. Keyed by source id + url (url change busts it).
const CACHE_TTL_MS = 2 * 60_000
const cache = new Map<string, { at: number; text: string }>()

async function fetchCached(key: string, url: string): Promise<string> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.text
  const text = await fetchIcs(url)
  cache.set(key, { at: Date.now(), text })
  if (cache.size > 50) cache.delete(cache.keys().next().value!)
  return text
}

function validTz(tz: unknown): string | null {
  if (typeof tz !== 'string' || !tz) return null
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz } catch { return null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const bearer = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!bearer) return json({ error: 'Unauthorized' }, 401)
  const { data: { user }, error: authErr } = await admin.auth.getUser(bearer)
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  // deno-lint-ignore no-explicit-any
  let body: Record<string, any>
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const { action } = body

  try {
    switch (action) {
      case 'test': {
        if (!body.url) return json({ error: 'Missing url' }, 400)
        const text = await fetchIcs(String(body.url))
        const now = new Date()
        // Count upcoming events over the next 90 days so the user sees it's working.
        const { name, events } = parseIcs(text, now, new Date(now.getTime() + 90 * 86_400_000), validTz(body.tz))
        return json({ name, event_count: events.length })
      }

      case 'get_events': {
        const { source_id, time_min, time_max } = body
        if (!source_id || !time_min || !time_max) {
          return json({ error: 'Missing source_id, time_min, or time_max' }, 400)
        }
        const min = new Date(time_min)
        const max = new Date(time_max)
        if (isNaN(min.getTime()) || isNaN(max.getTime()) || max <= min) {
          return json({ error: 'Invalid time range' }, 400)
        }
        if (max.getTime() - min.getTime() > 120 * 86_400_000) {
          return json({ error: 'Time range too large' }, 400)
        }

        const { data: src } = await admin.from('calendar_sources')
          .select('id, url, type')
          .eq('id', source_id)
          .eq('user_id', user.id)
          .eq('type', 'ical')
          .single()
        if (!src?.url) return json({ error: 'Calendar source not found' }, 404)

        const text = await fetchCached(`${src.id}|${src.url}`, src.url)
        const { events } = parseIcs(text, min, max, validTz(body.tz))
        return json({ events })
      }

      default:
        return json({ error: 'Unknown action' }, 400)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unexpected error'
    console.error('ical-proxy error:', msg)
    return json({ error: msg }, 502)
  }
})
