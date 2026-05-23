import { verifyAuthenticationResponse } from 'npm:@simplewebauthn/server@10'
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function fromBase64url(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64)
  return new Uint8Array(Array.from(binary, (c) => c.charCodeAt(0)))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const { challengeId, credential } = await req.json()
  if (!challengeId || !credential) return json({ error: 'Missing required fields' }, 400)

  // Load and validate challenge
  const { data: challengeRow } = await admin
    .from('auth_challenges')
    .select('challenge, expires_at')
    .eq('id', challengeId)
    .eq('type', 'authenticate')
    .single()

  if (!challengeRow) return json({ error: 'Invalid challenge' }, 400)
  if (new Date(challengeRow.expires_at) < new Date()) {
    await admin.from('auth_challenges').delete().eq('id', challengeId)
    return json({ error: 'Challenge expired' }, 400)
  }

  // Find passkey by credential ID
  const { data: passkey } = await admin
    .from('passkeys')
    .select('id, user_id, credential_id, public_key, sign_count')
    .eq('credential_id', credential.id)
    .single()

  if (!passkey) return json({ error: 'Passkey not found' }, 401)

  const rpId = Deno.env.get('WEBAUTHN_RP_ID') || 'localhost'
  const defaultOrigin = rpId === 'localhost' ? 'http://localhost:3000' : `https://${rpId}`
  const origins = (Deno.env.get('WEBAUTHN_RP_ORIGIN') || defaultOrigin)
    .split(',')
    .map((o: string) => o.trim())

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: origins,
      expectedRPID: rpId,
      credential: {
        id: passkey.credential_id,
        publicKey: fromBase64url(passkey.public_key),
        counter: passkey.sign_count,
      },
    })
  } catch (err) {
    console.error('WebAuthn verification error:', err)
    return json({ error: 'Verification failed' }, 401)
  }

  if (!verification.verified) return json({ error: 'Authentication failed' }, 401)

  // Update sign count + last used
  await admin.from('passkeys').update({
    sign_count: verification.authenticationInfo.newCounter,
    last_used_at: new Date().toISOString(),
  }).eq('id', passkey.id)

  // Delete used challenge
  await admin.from('auth_challenges').delete().eq('id', challengeId)

  // Create a Supabase session for the verified user
  const { data: sessionData, error: sessionError } = await admin.auth.admin.createSession({
    user_id: passkey.user_id,
  })

  if (sessionError || !sessionData?.session) {
    console.error('Session creation error:', sessionError)
    return json({ error: 'Failed to create session' }, 500)
  }

  return json({
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
  })
})
