import { verifyRegistrationResponse } from 'npm:@simplewebauthn/server@10'
import { createClient } from 'npm:@supabase/supabase-js@2'

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

function toBase64url(buf: Uint8Array): string {
  let binary = ''
  for (const byte of buf) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    return await handle(req)
  } catch (err) {
    console.error('Unhandled error in passkey-register-finish:', err)
    return json({ error: String(err) }, 500)
  }
})

async function handle(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return json({ error: 'Unauthorized' }, 401)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const { challengeId, credential, deviceLabel } = await req.json()
  if (!challengeId || !credential) return json({ error: 'Missing required fields' }, 400)

  // Load challenge
  const { data: challengeRow } = await admin
    .from('auth_challenges')
    .select('challenge, expires_at')
    .eq('id', challengeId)
    .eq('type', 'register')
    .single()

  if (!challengeRow) return json({ error: 'Invalid challenge' }, 400)
  if (new Date(challengeRow.expires_at) < new Date()) {
    await admin.from('auth_challenges').delete().eq('id', challengeId)
    return json({ error: 'Challenge expired' }, 400)
  }

  const rpId = Deno.env.get('WEBAUTHN_RP_ID') || 'localhost'
  const defaultOrigin = rpId === 'localhost' ? 'http://localhost:3000' : `https://${rpId}`
  const origins = (Deno.env.get('WEBAUTHN_RP_ORIGIN') || defaultOrigin)
    .split(',')
    .map((o: string) => o.trim())

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: origins,
      expectedRPID: rpId,
      requireUserVerification: false,
    })
  } catch (err) {
    console.error('Registration verification error:', err)
    return json({ error: 'Verification failed' }, 400)
  }

  if (!verification.verified || !verification.registrationInfo) {
    return json({ error: 'Registration not verified' }, 400)
  }

  const info = verification.registrationInfo as Record<string, unknown>
  const credentialId = info.credentialID as string
  const credentialPublicKey = info.credentialPublicKey as Uint8Array
  const counter = (info.counter as number) ?? 0
  const aaguid = (info.aaguid as string) ?? ''

  if (!credentialId || !credentialPublicKey) {
    console.error('Missing credential fields in registrationInfo:', Object.keys(info))
    return json({ error: 'Missing credential fields' }, 500)
  }

  const { error: insertError } = await admin.from('passkeys').insert({
    user_id: user.id,
    credential_id: credentialId,
    public_key: toBase64url(credentialPublicKey),
    aaguid,
    sign_count: counter,
    device_label: (deviceLabel || '').slice(0, 120),
  })

  if (insertError) {
    console.error('Passkey insert error:', insertError)
    return json({ error: 'Failed to save passkey' }, 500)
  }

  await admin.from('auth_challenges').delete().eq('id', challengeId)

  return json({ success: true })
}
