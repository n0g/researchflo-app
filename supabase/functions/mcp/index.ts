import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function rpcOk(id: unknown, result: unknown) {
  return json({ jsonrpc: '2.0', id, result })
}

function rpcErr(id: unknown, code: number, message: string) {
  return json({ jsonrpc: '2.0', id, error: { code, message } })
}

function toolErr(message: string) {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

function toolOk(text: string) {
  return { content: [{ type: 'text', text }] }
}

const TOOLS = [
  {
    name: 'list_projects',
    description: 'List all research projects with their stage, open task count, deadline, and venue.',
    inputSchema: {
      type: 'object',
      properties: {
        stage: { type: 'string', description: 'Filter by stage name, e.g. "Planning" or "Preparing"' },
      },
    },
  },
  {
    name: 'list_tasks',
    description: 'List tasks, optionally filtered by project or completion status.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Filter by project UUID (omit for all tasks)' },
        include_completed: { type: 'boolean', description: 'Include completed tasks (default: false)' },
      },
    },
  },
  {
    name: 'get_project_stats',
    description: 'Get task completion statistics and deadline overview across all projects.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'mark_task_complete',
    description: 'Mark a task as completed.',
    inputSchema: {
      type: 'object',
      required: ['task_id'],
      properties: {
        task_id: { type: 'string', description: 'UUID of the task to complete' },
      },
    },
  },
  {
    name: 'add_task',
    description: 'Create a new task, optionally assigned to a project (omit project_id for inbox).',
    inputSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: { type: 'string', description: 'Task title' },
        project_id: { type: 'string', description: 'UUID of the project (omit for inbox)' },
        priority: { type: 'number', description: '1=normal 2=medium 3=high 4=urgent' },
        due_date: { type: 'string', description: 'Due date in YYYY-MM-DD format' },
        description: { type: 'string', description: 'Optional longer description' },
      },
    },
  },
  {
    name: 'update_task',
    description: 'Update fields on an existing task.',
    inputSchema: {
      type: 'object',
      required: ['task_id'],
      properties: {
        task_id: { type: 'string', description: 'UUID of the task' },
        content: { type: 'string', description: 'New title' },
        priority: { type: 'number', description: '1=normal 2=medium 3=high 4=urgent' },
        due_date: { type: 'string', description: 'Due date in YYYY-MM-DD, or empty string to clear' },
        description: { type: 'string', description: 'Updated description' },
        project_id: { type: 'string', description: 'Move to this project UUID, or empty string for inbox' },
      },
    },
  },
  {
    name: 'add_project',
    description: 'Create a new research project.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Project name' },
        stage: { type: 'string', description: 'Stage name, e.g. "Planning". Defaults to first stage.' },
        venue: { type: 'string', description: 'Conference or journal name' },
        deadline: { type: 'string', description: 'Submission deadline in YYYY-MM-DD' },
        summary: { type: 'string', description: 'Project summary' },
      },
    },
  },
  {
    name: 'update_project',
    description: "Update a project's metadata.",
    inputSchema: {
      type: 'object',
      required: ['project_id'],
      properties: {
        project_id: { type: 'string', description: 'UUID of the project' },
        name: { type: 'string', description: 'New project name' },
        stage: { type: 'string', description: 'Stage name to move to' },
        venue: { type: 'string', description: 'Conference or journal name' },
        deadline: { type: 'string', description: 'Submission deadline in YYYY-MM-DD, or empty string to clear' },
        summary: { type: 'string', description: 'Project summary' },
        submission_url: { type: 'string', description: 'Submission URL' },
        status_text: { type: 'string', description: 'Status text shown on the board card' },
      },
    },
  },
]

// deno-lint-ignore no-explicit-any
type Admin = ReturnType<typeof createClient>

async function resolveStageId(admin: Admin, stageName: string): Promise<{ id: string | null; error?: string }> {
  const { data: stages } = await admin.from('stages').select('id, name').order('sort_order')
  const match = stages?.find((s: any) => s.name.toLowerCase() === stageName.toLowerCase())
  if (!match) {
    return { id: null, error: `Stage "${stageName}" not found. Available: ${stages?.map((s: any) => s.name).join(', ')}` }
  }
  return { id: match.id }
}

// Returns { ownedIds, collabIds, allIds } for a user — mirrors the app's RLS visibility
async function getAccessibleProjectIds(userId: string, admin: Admin) {
  const { data: owned } = await admin.from('projects').select('id').eq('owner_id', userId)
  const ownedIds = new Set(owned?.map((p: any) => p.id) ?? [])

  const { data: person } = await admin.from('people').select('id').eq('user_id', userId).single()
  const collabIds = new Set<string>()
  if (person) {
    const { data: members } = await admin.from('project_members').select('project_id').eq('person_id', person.id)
    for (const m of members ?? []) collabIds.add(m.project_id)
  }

  const allIds = [...new Set([...ownedIds, ...collabIds])]
  return { ownedIds, collabIds, allIds }
}

// deno-lint-ignore no-explicit-any
async function callTool(name: string, args: any, userId: string, admin: Admin): Promise<any> {
  switch (name) {

    case 'list_projects': {
      const { data: stages } = await admin.from('stages').select('id, name').order('sort_order')
      const stageById = new Map(stages?.map((s: any) => [s.id, s.name]) ?? [])

      const { ownedIds, allIds } = await getAccessibleProjectIds(userId, admin)
      if (!allIds.length) return toolOk(JSON.stringify([], null, 2))

      let query = admin.from('projects').select('*').in('id', allIds).order('name')
      if (args.stage) {
        const found = stages?.find((s: any) => s.name.toLowerCase() === args.stage.toLowerCase())
        if (!found) return toolErr(`Stage "${args.stage}" not found. Available: ${stages?.map((s: any) => s.name).join(', ')}`)
        query = query.eq('stage_id', found.id)
      }
      const { data: projects, error } = await query
      if (error) return toolErr(error.message)

      const ids = projects?.map((p: any) => p.id) ?? []
      const countMap = new Map<string, number>()
      if (ids.length) {
        const { data: taskRows } = await admin.from('tasks').select('project_id').in('project_id', ids).eq('is_completed', false)
        for (const t of taskRows ?? []) countMap.set(t.project_id, (countMap.get(t.project_id) ?? 0) + 1)
      }

      const out = (projects ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        role: ownedIds.has(p.id) ? 'owner' : 'collaborator',
        stage: stageById.get(p.stage_id) ?? 'Unassigned',
        venue: p.venue || null,
        deadline: p.deadline || null,
        open_tasks: countMap.get(p.id) ?? 0,
        energy: (['none', 'low', 'high'] as const)[p.energy ?? 0] ?? 'none',
        summary: p.summary || null,
        status_text: p.status_text || null,
        submission_url: p.submission_url || null,
      }))
      return toolOk(JSON.stringify(out, null, 2))
    }

    case 'list_tasks': {
      const { allIds } = await getAccessibleProjectIds(userId, admin)

      let query = admin.from('tasks').select('*, project:projects(id, name)').order('sort_order')
      if (args.project_id) {
        query = query.eq('project_id', args.project_id)
      } else if (allIds.length) {
        // inbox tasks the user created + all tasks on accessible projects
        query = query.or(`created_by.eq.${userId},project_id.in.(${allIds.join(',')})`)
      } else {
        query = query.eq('created_by', userId)
      }
      // Exclude private tasks not created by the user
      query = query.or(`is_private.eq.false,created_by.eq.${userId}`)
      if (!args.include_completed) query = query.eq('is_completed', false)

      const { data: tasks, error } = await query
      if (error) return toolErr(error.message)

      const PRIORITY = ['', 'normal', 'medium', 'high', 'urgent'] as const
      const out = (tasks ?? []).map((t: any) => ({
        id: t.id,
        content: t.content,
        project: t.project?.name ?? 'Inbox',
        project_id: t.project_id ?? null,
        priority: PRIORITY[t.priority] ?? 'normal',
        due_date: t.due_date ?? null,
        is_completed: t.is_completed,
        description: t.description || null,
        labels: t.labels ?? [],
        created_at: t.created_at,
      }))
      return toolOk(JSON.stringify(out, null, 2))
    }

    case 'get_project_stats': {
      const { data: stages } = await admin.from('stages').select('id, name').order('sort_order')
      const stageById = new Map(stages?.map((s: any) => [s.id, s.name]) ?? [])

      const { ownedIds, allIds } = await getAccessibleProjectIds(userId, admin)
      const { data: projects } = allIds.length
        ? await admin.from('projects').select('id, name, deadline, stage_id').in('id', allIds)
        : { data: [] }
      const ids = projects?.map((p: any) => p.id) ?? []

      const { data: allTasks } = ids.length
        ? await admin.from('tasks').select('project_id, is_completed, due_date').in('project_id', ids)
        : { data: [] }

      const now = new Date()
      const stats = (projects ?? []).map((p: any) => {
        const pTasks = (allTasks ?? []).filter((t: any) => t.project_id === p.id)
        const open = pTasks.filter((t: any) => !t.is_completed)
        const done = pTasks.filter((t: any) => t.is_completed)
        const overdue = open.filter((t: any) => t.due_date && new Date(t.due_date) < now)
        let daysToDeadline: number | null = null
        if (p.deadline) daysToDeadline = Math.ceil((new Date(p.deadline).getTime() - now.getTime()) / 86_400_000)
        return {
          project: p.name,
          role: ownedIds.has(p.id) ? 'owner' : 'collaborator',
          stage: stageById.get(p.stage_id) ?? 'Unassigned',
          open_tasks: open.length,
          completed_tasks: done.length,
          overdue_tasks: overdue.length,
          days_to_deadline: daysToDeadline,
          deadline: p.deadline ?? null,
        }
      }).sort((a: any, b: any) => {
        if (a.days_to_deadline === null) return 1
        if (b.days_to_deadline === null) return -1
        return a.days_to_deadline - b.days_to_deadline
      })

      const summary = {
        total_projects: projects?.length ?? 0,
        total_open_tasks: (allTasks ?? []).filter((t: any) => !t.is_completed).length,
        total_overdue_tasks: stats.reduce((n: number, s: any) => n + s.overdue_tasks, 0),
        projects: stats,
      }
      return toolOk(JSON.stringify(summary, null, 2))
    }

    case 'mark_task_complete': {
      const { task_id } = args
      if (!task_id) return toolErr('task_id is required')
      const { data: task } = await admin.from('tasks').select('id, content, created_by').eq('id', task_id).single()
      if (!task) return toolErr('Task not found')
      if (task.created_by !== userId) return toolErr('Not authorized to modify this task')
      const { error } = await admin.from('tasks')
        .update({ is_completed: true, completed_at: new Date().toISOString() })
        .eq('id', task_id)
      if (error) return toolErr(error.message)
      return toolOk(`Task "${task.content}" marked as complete.`)
    }

    case 'add_task': {
      const { content, project_id, priority, due_date, description } = args
      if (!content?.trim()) return toolErr('content is required')
      if (project_id) {
        const { data: proj } = await admin.from('projects').select('owner_id').eq('id', project_id).single()
        if (!proj) return toolErr('Project not found')
        if (proj.owner_id !== userId) return toolErr('Not authorized to add tasks to this project')
      }
      const insert: Record<string, unknown> = {
        content: content.trim(),
        created_by: userId,
        project_id: project_id || null,
        priority: priority ?? 1,
        description: description?.trim() ?? '',
      }
      if (due_date) insert.due_date = due_date
      const { data: task, error } = await admin.from('tasks').insert(insert).select().single()
      if (error) return toolErr(error.message)
      return toolOk(`Task created: "${task.content}" (id: ${task.id})`)
    }

    case 'update_task': {
      const { task_id, ...updates } = args
      if (!task_id) return toolErr('task_id is required')
      const { data: task } = await admin.from('tasks').select('id, created_by').eq('id', task_id).single()
      if (!task) return toolErr('Task not found')
      if (task.created_by !== userId) return toolErr('Not authorized to modify this task')

      const patch: Record<string, unknown> = {}
      if (updates.content !== undefined) patch.content = updates.content.trim()
      if (updates.priority !== undefined) patch.priority = updates.priority
      if (updates.due_date !== undefined) patch.due_date = updates.due_date || null
      if (updates.description !== undefined) patch.description = updates.description
      if (updates.project_id !== undefined) patch.project_id = updates.project_id || null

      if (Object.keys(patch).length === 0) return toolErr('No fields to update')
      const { error } = await admin.from('tasks').update(patch).eq('id', task_id)
      if (error) return toolErr(error.message)
      return toolOk(`Task updated.`)
    }

    case 'add_project': {
      const { name, stage, venue, deadline, summary } = args
      if (!name?.trim()) return toolErr('name is required')

      let stageId: string | null = null
      if (stage) {
        const resolved = await resolveStageId(admin, stage)
        if (resolved.error) return toolErr(resolved.error)
        stageId = resolved.id
      } else {
        const { data: first } = await admin.from('stages').select('id').order('sort_order').limit(1)
        stageId = first?.[0]?.id ?? null
      }

      const insert: Record<string, unknown> = { name: name.trim(), owner_id: userId, stage_id: stageId }
      if (venue) insert.venue = venue.trim()
      if (deadline) insert.deadline = deadline
      if (summary) insert.summary = summary.trim()

      const { data: project, error } = await admin.from('projects').insert(insert).select().single()
      if (error) return toolErr(error.message)
      return toolOk(`Project created: "${project.name}" (id: ${project.id})`)
    }

    case 'update_project': {
      const { project_id, ...updates } = args
      if (!project_id) return toolErr('project_id is required')
      const { data: project } = await admin.from('projects').select('id, owner_id').eq('id', project_id).single()
      if (!project) return toolErr('Project not found')
      if (project.owner_id !== userId) return toolErr('Not authorized to modify this project')

      const patch: Record<string, unknown> = {}
      if (updates.name !== undefined) patch.name = updates.name.trim()
      if (updates.venue !== undefined) patch.venue = updates.venue
      if (updates.deadline !== undefined) patch.deadline = updates.deadline || null
      if (updates.summary !== undefined) patch.summary = updates.summary
      if (updates.submission_url !== undefined) patch.submission_url = updates.submission_url
      if (updates.status_text !== undefined) patch.status_text = updates.status_text
      if (updates.stage !== undefined) {
        const resolved = await resolveStageId(admin, updates.stage)
        if (resolved.error) return toolErr(resolved.error)
        patch.stage_id = resolved.id
      }

      if (Object.keys(patch).length === 0) return toolErr('No fields to update')
      const { error } = await admin.from('projects').update(patch).eq('id', project_id)
      if (error) return toolErr(error.message)
      return toolOk(`Project updated.`)
    }

    default:
      return toolErr(`Unknown tool: ${name}`)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  try {
    // Authenticate via MCP token
    const bearer = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim()
    if (!bearer) return json({ error: 'Unauthorized' }, 401)

    const { data: settings } = await admin
      .from('user_settings')
      .select('user_id')
      .eq('mcp_token', bearer)
      .single()
    if (!settings) return json({ error: 'Unauthorized' }, 401)

    const userId = settings.user_id

    // Parse JSON-RPC
    let body: Record<string, unknown>
    try { body = await req.json() } catch { return rpcErr(null, -32700, 'Parse error') }

    const { id, method, params } = body as { id?: unknown; method?: string; params?: Record<string, unknown> }

    if (!method) return rpcErr(id ?? null, -32600, 'Invalid request')

    // Notifications (no id) — acknowledge and return
    if (id === undefined) {
      return new Response(null, { status: 202, headers: CORS })
    }

    if (method === 'initialize') {
      return rpcOk(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'researchflo', version: '1.0.0' },
      })
    }

    if (method === 'tools/list') {
      return rpcOk(id, { tools: TOOLS })
    }

    if (method === 'tools/call') {
      const { name, arguments: toolArgs = {} } = (params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
      if (!name) return rpcErr(id, -32602, 'Missing tool name')
      const result = await callTool(name, toolArgs, userId, admin)
      return rpcOk(id, result)
    }

    return rpcErr(id, -32601, `Method not found: ${method}`)

  } catch (err) {
    console.error('MCP error:', err)
    return rpcErr(null, -32603, String(err))
  }
})
