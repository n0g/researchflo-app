import { generateAuthenticationOptions } from 'npm:@simplewebauthn/server@10'
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // Prune expired challenges
  await admin.from('auth_challenges').delete().lt('expires_at', new Date().toISOString())

  const body = await req.json().catch(() => ({}))
  const email: string | undefined = body?.email?.trim() || undefined
  const rpId = Deno.env.get('WEBAUTHN_RP_ID') || 'localhost'

  let allowCredentials: { id: string; type: 'public-key' }[] = []
  let hasPasskey = false

  if (email) {
    // Look up user via people table (bridge between email and auth.users)
    const { data: person } = await admin
      .from('people')
      .select('user_id')
      .eq('email', email)
      .not('user_id', 'is', null)
      .maybeSingle()

    if (person?.user_id) {
      const { data: passkeys } = await admin
        .from('passkeys')
        .select('credential_id')
        .eq('user_id', person.user_id)

      if (passkeys?.length) {
        hasPasskey = true
        allowCredentials = passkeys.map((p) => ({ id: p.credential_id, type: 'public-key' as const }))
      }
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: rpId,
    allowCredentials,
    userVerification: 'preferred',
    timeout: 60000,
  })

  const { data: challenge, error } = await admin
    .from('auth_challenges')
    .insert({ challenge: options.challenge, type: 'authenticate' })
    .select('id')
    .single()

  if (error) return json({ error: 'Failed to create challenge' }, 500)

  return json({ challengeId: challenge.id, options, hasPasskey })
})
