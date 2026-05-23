import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GOOGLE_CLIENT_ID = '809750411186-1315ibr7ag630sbdkd42kt2cojlflqr6.apps.googleusercontent.com'
const REDIRECT_URI = 'https://oqqevpkeqcbkqrgabpkc.supabase.co/functions/v1/google-calendar-auth'
const APP_URL = 'https://researchflo.app'

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state') // Supabase access token passed as state
  const error = url.searchParams.get('error')

  if (error) {
    return Response.redirect(`${APP_URL}?gcal_error=${encodeURIComponent(error)}`)
  }

  if (!code || !state) {
    return new Response('Missing code or state', { status: 400 })
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
    return Response.redirect(`${APP_URL}?gcal_error=token_exchange_failed`)
  }

  const tokens = await tokenRes.json()

  // Verify state is a valid Supabase JWT
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${state}` } } }
  )
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return Response.redirect(`${APP_URL}?gcal_error=invalid_session`)
  }

  // Store tokens using service role to bypass RLS
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  await admin.from('user_settings').upsert({
    user_id: user.id,
    gcal_access_token: tokens.access_token,
    gcal_refresh_token: tokens.refresh_token,
    gcal_token_expires_at: Date.now() + tokens.expires_in * 1000,
  })

  return Response.redirect(`${APP_URL}?gcal_connected=1`)
})
