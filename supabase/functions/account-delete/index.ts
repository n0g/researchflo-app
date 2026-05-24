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

    // Find this user's people row
    const { data: person } = await admin
      .from('people')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (person) {
      // Reassign tasks they created in projects they don't own to the project owner,
      // so those tasks are preserved rather than cascade-deleted with the auth row.
      const { data: foreignTasks } = await admin
        .from('tasks')
        .select('id, project_id, projects!inner(owner_id)')
        .eq('created_by', user.id)
        .neq('projects.owner_id', user.id)

      if (foreignTasks && foreignTasks.length > 0) {
        for (const task of foreignTasks) {
          const ownerId = (task.projects as { owner_id: string }).owner_id
          await admin.from('tasks').update({ created_by: ownerId }).eq('id', task.id)
        }
      }

      // Remove from all project_members so the people row doesn't linger as a ghost collaborator
      await admin.from('project_members').delete().eq('person_id', person.id)

      // Delete the people row itself
      await admin.from('people').delete().eq('id', person.id)
    }

    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) {
      console.error('deleteUser error:', error)
      return json({ error: error.message }, 500)
    }

    return json({ success: true })
  } catch (err) {
    console.error('Unhandled error in account-delete:', err)
    return json({ error: String(err) }, 500)
  }
})
