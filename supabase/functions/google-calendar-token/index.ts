import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GOOGLE_CLIENT_ID = '809750411186-1315ibr7ag630sbdkd42kt2cojlflqr6.apps.googleusercontent.com'
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

  // Verify the Supabase JWT and get user
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: CORS_HEADERS })
  }

  // Read stored tokens from calendar_sources using service role
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  const { data: source } = await admin
    .from('calendar_sources')
    .select('id, access_token, refresh_token, token_expires_at')
    .eq('user_id', user.id)
    .eq('type', 'google')
    .maybeSingle()

  if (!source?.refresh_token) {
    return new Response(JSON.stringify({ error: 'not_connected' }), { status: 404, headers: CORS_HEADERS })
  }

  const now = Date.now()
  const bufferMs = 5 * 60 * 1000 // 5 minute buffer

  // Return existing token if still valid
  if (source.access_token && source.token_expires_at > now + bufferMs) {
    return new Response(
      JSON.stringify({ access_token: source.access_token }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  }

  // Refresh the token
  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: source.refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  if (!refreshRes.ok) {
    console.error('Token refresh failed:', await refreshRes.text())
    return new Response(JSON.stringify({ error: 'refresh_failed' }), { status: 500, headers: CORS_HEADERS })
  }

  const refreshed = await refreshRes.json()

  await admin.from('calendar_sources').update({
    access_token: refreshed.access_token,
    token_expires_at: now + refreshed.expires_in * 1000,
  }).eq('id', source.id)

  return new Response(
    JSON.stringify({ access_token: refreshed.access_token }),
    { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
  )
})
