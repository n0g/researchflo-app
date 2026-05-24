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

  try {
    return await handle(req)
  } catch (err) {
    console.error('Unhandled error in passkey-auth-finish:', err)
    return json({ error: String(err) }, 500)
  }
})

async function handle(req: Request) {
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
      // Support both old API (authenticator.credentialID) and new API (credential.id)
      authenticator: {
        credentialID: fromBase64url(passkey.credential_id),
        credentialPublicKey: fromBase64url(passkey.public_key),
        counter: passkey.sign_count,
      },
    } as Parameters<typeof verifyAuthenticationResponse>[0])
  } catch (err) {
    console.error('WebAuthn verification error:', err)
    return json({ error: `Verification failed: ${err}` }, 401)
  }

  if (!verification.verified) return json({ error: 'Authentication failed' }, 401)

  // Update sign count + last used
  await admin.from('passkeys').update({
    sign_count: verification.authenticationInfo.newCounter,
    last_used_at: new Date().toISOString(),
  }).eq('id', passkey.id)

  // Delete used challenge
  await admin.from('auth_challenges').delete().eq('id', challengeId)

  // Create a session for the verified user via magic link exchange
  const { data: { user: authUser } } = await admin.auth.admin.getUserById(passkey.user_id)
  if (!authUser?.email) return json({ error: 'User has no email' }, 500)

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: authUser.email,
  })
  if (linkError || !linkData?.properties?.hashed_token) {
    console.error('generateLink error:', linkError)
    return json({ error: 'Failed to create session' }, 500)
  }

  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  )
  const { data: sessionData, error: otpError } = await anonClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink',
  })
  if (otpError || !sessionData?.session) {
    console.error('verifyOtp error:', otpError)
    return json({ error: 'Failed to create session' }, 500)
  }

  return json({
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
  })
}
