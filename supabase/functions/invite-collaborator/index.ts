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

    // Verify the temp people row exists and is unclaimed
    const { data: tempPerson, error: fetchErr } = await admin
      .from('people')
      .select('id, invite_token')
      .eq('id', personId)
      .is('user_id', null)
      .single()
    if (fetchErr || !tempPerson) return json({ error: 'Person not found or already joined' }, 404)

    // Check if the email belongs to someone already on the platform
    const { data: existingPerson } = await admin
      .from('people')
      .select('id')
      .eq('email', email.trim())
      .not('user_id', 'is', null)
      .maybeSingle()

    if (existingPerson) {
      // Already on the platform — migrate project memberships and drop the temp row
      const { data: memberships } = await admin
        .from('project_members')
        .select('project_id, role')
        .eq('person_id', personId)

      if (memberships?.length) {
        // Upsert: skip projects where they're already a member
        await admin.from('project_members').upsert(
          memberships.map((m: any) => ({
            project_id: m.project_id,
            person_id: existingPerson.id,
            role: m.role,
          })),
          { onConflict: 'project_id,person_id', ignoreDuplicates: true },
        )
      }

      await admin.from('project_members').delete().eq('person_id', personId)
      await admin.from('people').delete().eq('id', personId)

      return json({ success: true, linked: true })
    }

    // New user — save email, set invited_at, send invite email
    await admin
      .from('people')
      .update({ email: email.trim(), invited_at: new Date().toISOString() })
      .eq('id', personId)

    const rpId = Deno.env.get('WEBAUTHN_RP_ID') || 'localhost'
    const appUrl = rpId === 'localhost' ? 'http://localhost:3000' : `https://${rpId}`
    const redirectTo = `${appUrl}/?invite=${tempPerson.invite_token}`

    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email.trim(), { redirectTo })
    if (inviteErr) {
      console.error('inviteUserByEmail error:', inviteErr)
      return json({ error: 'Failed to send invite email' }, 500)
    }

    return json({ success: true, linked: false })
  } catch (err) {
    console.error('Unhandled error in invite-collaborator:', err)
    return json({ error: String(err) }, 500)
  }
})
