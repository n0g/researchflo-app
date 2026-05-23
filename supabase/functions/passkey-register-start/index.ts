import { generateRegistrationOptions } from 'npm:@simplewebauthn/server@10'
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  // Verify caller's session
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

  // Prune expired challenges
  await admin.from('auth_challenges').delete().lt('expires_at', new Date().toISOString())

  // Get existing credentials to exclude from registration
  const { data: existing } = await admin
    .from('passkeys')
    .select('credential_id')
    .eq('user_id', user.id)

  const rpId = Deno.env.get('WEBAUTHN_RP_ID') || 'localhost'
  const rpName = Deno.env.get('WEBAUTHN_RP_NAME') || 'researchflo'

  // Fetch full user record via admin to ensure email is present
  const { data: { user: fullUser } } = await admin.auth.admin.getUserById(user.id)
  const userEmail = fullUser?.email || user.email || user.id
  const userDisplayName = (fullUser?.user_metadata?.name as string) || fullUser?.email || userEmail

  const encoder = new TextEncoder()
  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpId,
    user: {
      id: encoder.encode(user.id),
      name: userEmail,
      displayName: userDisplayName,
    },
    attestationType: 'none',
    excludeCredentials: (existing || []).map((p) => ({
      id: p.credential_id,
      type: 'public-key' as const,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  })

  const { data: challenge, error } = await admin
    .from('auth_challenges')
    .insert({ challenge: options.challenge, type: 'register' })
    .select('id')
    .single()

  if (error) return json({ error: 'Failed to create challenge' }, 500)

  return json({ challengeId: challenge.id, options })
})
