import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GOOGLE_CLIENT_ID = '809750411186-1315ibr7ag630sbdkd42kt2cojlflqr6.apps.googleusercontent.com'
const REDIRECT_URI = 'https://researchflo.app'
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

  const { code } = await req.json()
  if (!code) {
    return new Response(JSON.stringify({ error: 'missing_code' }), { status: 400, headers: CORS_HEADERS })
  }

  // Exchange auth code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    console.error('Token exchange failed:', await tokenRes.text())
    return new Response(JSON.stringify({ error: 'token_exchange_failed' }), { status: 500, headers: CORS_HEADERS })
  }

  const tokens = await tokenRes.json()

  // Store tokens in calendar_sources using service role to bypass RLS
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  const { data: existing } = await admin
    .from('calendar_sources')
    .select('id')
    .eq('user_id', user.id)
    .eq('type', 'google')
    .maybeSingle()

  if (existing) {
    await admin.from('calendar_sources').update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: Date.now() + tokens.expires_in * 1000,
    }).eq('id', existing.id)
  } else {
    await admin.from('calendar_sources').insert({
      user_id: user.id,
      type: 'google',
      name: 'Google Calendar',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: Date.now() + tokens.expires_in * 1000,
      is_write_target: true,
    })
  }

  return new Response(
    JSON.stringify({ ok: true }),
    { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
  )
})
