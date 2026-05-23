import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: CORS_HEADERS })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: CORS_HEADERS })
  }

  const url = new URL(req.url)
  const target = url.searchParams.get('url')
  const token = url.searchParams.get('token')

  if (!target) {
    return new Response(JSON.stringify({ error: 'missing url param' }), { status: 400, headers: CORS_HEADERS })
  }

  try {
    const parsed = new URL(target)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid url' }), { status: 400, headers: CORS_HEADERS })
  }

  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  try {
    const response = await fetch(target, { headers })
    const body = await response.text()
    return new Response(body, {
      status: response.status,
      headers: { ...CORS_HEADERS, 'Content-Type': response.headers.get('Content-Type') || 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'proxy_error', message: (e as Error).message }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
