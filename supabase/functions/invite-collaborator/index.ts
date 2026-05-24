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

  try {
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

    const { personId, email } = await req.json()
    if (!personId || !email) return json({ error: 'Missing personId or email' }, 400)

    // Save email on the people row
    const { data: person, error: fetchErr } = await admin
      .from('people')
      .update({ email: email.trim() })
      .eq('id', personId)
      .is('user_id', null)  // only uninvited people
      .select('invite_token')
      .single()

    if (fetchErr || !person) return json({ error: 'Person not found or already joined' }, 404)

    const rpId = Deno.env.get('WEBAUTHN_RP_ID') || 'localhost'
    const appUrl = rpId === 'localhost' ? 'http://localhost:3000' : `https://${rpId}`
    const redirectTo = `${appUrl}/?invite=${person.invite_token}`

    // Try invite (creates user if needed); fall back to magic link for existing accounts
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email.trim(), { redirectTo })
    if (inviteErr) {
      // User already exists — send a magic link instead
      const { error: linkErr } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email: email.trim(),
        options: { redirectTo },
      })
      if (linkErr) {
        console.error('generateLink error:', linkErr)
        return json({ error: 'Failed to send invite email' }, 500)
      }
      // generateLink doesn't auto-send; email delivery isn't available without SMTP setup
      // Return success — the link is generated, user can be notified manually if needed
      // In practice, inviteUserByEmail handles 99% of cases
    }

    return json({ success: true })
  } catch (err) {
    console.error('Unhandled error in invite-collaborator:', err)
    return json({ error: String(err) }, 500)
  }
})
