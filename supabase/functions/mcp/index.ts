import { createClient } from 'npm:@supabase/supabase-js@2'
import { listCalendarsFromHomeSet, getCalendarEvents } from '../_shared/caldav.ts'

const GOOGLE_CLIENT_ID = '809750411186-1315ibr7ag630sbdkd42kt2cojlflqr6.apps.googleusercontent.com'

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
    description: 'List all research projects with their stage, open task count, deadline, and venue. Returns project_id values needed by list_tasks, update_project, add_task, and get_stage_history.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        stage: { type: 'string', description: 'Filter by stage name (e.g. "Planning", "Preparing"). Stage names appear in the results of this tool.' },
      },
    },
  },
  {
    name: 'list_tasks',
    description: 'List tasks filtered by project or completion status. Use list_projects first to get a project_id. Returns task_id values needed by update_task and mark_task_complete.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        project_id: { type: 'string', description: 'UUID from list_projects. Omit to return all tasks across all projects including inbox.' },
        include_completed: { type: 'boolean', description: 'Include completed tasks. Default: false.' },
      },
    },
  },
  {
    name: 'get_project_stats',
    description: 'Get task completion statistics and deadline overview across all projects. Good starting point for a weekly review or sprint planning.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'mark_task_complete',
    description: 'Mark a task as completed. Use list_tasks to get the task_id.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['task_id'],
      properties: {
        task_id: { type: 'string', description: 'UUID from list_tasks.' },
      },
    },
  },
  {
    name: 'add_task',
    description: 'Create a new task. Use list_projects to get a project_id, or omit it to add to inbox. Can be called multiple times in sequence to capture several tasks from a meeting.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['content'],
      properties: {
        content: { type: 'string', description: 'Task title.' },
        project_id: { type: 'string', description: 'UUID from list_projects. Omit to add to inbox.' },
        priority: { type: 'number', enum: [1, 2, 3, 4], description: '1=normal, 2=medium, 3=high, 4=urgent.' },
        due_date: { type: 'string', description: 'Due date in YYYY-MM-DD format.' },
        description: { type: 'string', description: 'Optional longer description or notes.' },
      },
    },
  },
  {
    name: 'update_task',
    description: 'Update fields on an existing task. Use list_tasks to get the task_id. Only provided fields are changed.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['task_id'],
      properties: {
        task_id: { type: 'string', description: 'UUID from list_tasks.' },
        content: { type: 'string', description: 'New title.' },
        priority: { type: 'number', enum: [1, 2, 3, 4], description: '1=normal, 2=medium, 3=high, 4=urgent.' },
        due_date: { type: 'string', description: 'Due date in YYYY-MM-DD format. Pass empty string to clear.' },
        description: { type: 'string', description: 'Updated description.' },
        project_id: { type: 'string', description: 'Move to this project UUID from list_projects. Pass empty string to move to inbox.' },
      },
    },
  },
  {
    name: 'add_project',
    description: 'Create a new research project.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Project name.' },
        stage: { type: 'string', description: 'Stage name (e.g. "Planning", "Preparing to Submit"). Stage names are visible in list_projects results. Defaults to the first stage.' },
        venue: { type: 'string', description: 'Conference or journal name.' },
        deadline: { type: 'string', description: 'Submission deadline in YYYY-MM-DD format.' },
        summary: { type: 'string', description: 'Project summary.' },
      },
    },
  },
  {
    name: 'update_project',
    description: "Update a project's metadata. Use list_projects to get the project_id. Only provided fields are changed. Useful for bulk status updates after a meeting.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['project_id'],
      properties: {
        project_id: { type: 'string', description: 'UUID from list_projects.' },
        name: { type: 'string', description: 'New project name.' },
        stage: { type: 'string', description: 'Stage name to move the project to (e.g. "Revision"). Stage names are visible in list_projects results.' },
        venue: { type: 'string', description: 'Conference or journal name.' },
        deadline: { type: 'string', description: 'Submission deadline in YYYY-MM-DD format. Pass empty string to clear.' },
        summary: { type: 'string', description: 'Project summary.' },
        submission_url: { type: 'string', description: 'Submission URL.' },
        status_text: { type: 'string', description: 'Short status text shown on the Kanban board card (e.g. "Waiting for co-author feedback").' },
      },
    },
  },
  {
    name: 'get_stage_history',
    description: 'Get the pipeline stage history for a project, showing how long it spent (or has spent) in each stage. Useful for identifying stuck projects. Use list_projects to get the project_id.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['project_id'],
      properties: {
        project_id: { type: 'string', description: 'UUID from list_projects.' },
      },
    },
  },
  {
    name: 'get_scheduling_preferences',
    description: 'Get the user\'s scheduling preferences: timezone, working hours, working days, and default task duration. Call this at the start of any scheduling session before placing tasks on the calendar.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'update_scheduling_preferences',
    description: 'Update the user\'s scheduling preferences. Only provided fields are changed.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        timezone: { type: 'string', description: 'IANA timezone (e.g. "America/New_York", "Europe/Berlin").' },
        work_start_time: { type: 'string', description: 'Work day start in HH:MM format (e.g. "09:00").' },
        work_end_time: { type: 'string', description: 'Work day end in HH:MM format (e.g. "17:00").' },
        work_days: { type: 'array', items: { type: 'number', enum: [1, 2, 3, 4, 5, 6, 7] }, description: 'Working days as ISO weekday numbers: 1=Monday … 7=Sunday.' },
        default_task_duration_minutes: { type: 'number', description: 'Default scheduled event duration in minutes.' },
      },
    },
  },
  {
    name: 'list_calendars',
    description: "List all connected calendars (Google Calendar and CalDAV/iCloud) with IDs, names, and source. Call this first to get calendar_id values for get_events.",
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'get_events',
    description: 'Fetch calendar events from ALL connected calendar sources (Google + CalDAV/iCloud). You MUST provide either "date" (single day) or both "start_date" and "end_date" (range, max 2 weeks). Use list_calendars to resolve calendar_id. Returns event_id and calendar_id needed by update_event.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        date: { type: 'string', description: 'Single day in YYYY-MM-DD format. Use this OR start_date+end_date, not both.' },
        start_date: { type: 'string', description: 'Start of date range in YYYY-MM-DD format. Requires end_date.' },
        end_date: { type: 'string', description: 'End of date range in YYYY-MM-DD format (inclusive). Maximum 14 days after start_date.' },
        calendar_id: { type: 'string', description: 'Calendar ID from list_calendars. Defaults to "primary".' },
      },
    },
  },
  {
    name: 'schedule_task',
    description: 'Schedule a task by creating a linked Google Calendar event, then writing the event reference and scheduled time back to the task. Use list_tasks to get task_id. Use list_calendars + get_events to check for conflicts first.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['task_id', 'start', 'duration_minutes'],
      properties: {
        task_id: { type: 'string', description: 'UUID from list_tasks.' },
        start: { type: 'string', description: 'Start datetime in ISO 8601 format (e.g. "2026-05-26T14:00:00"). Always supply timezone.' },
        duration_minutes: { type: 'number', description: 'Duration in minutes (e.g. 60 for 1 hour, 90 for 90 minutes).' },
        timezone: { type: 'string', description: 'IANA timezone (e.g. "America/New_York", "Europe/Berlin"). Defaults to UTC.' },
        calendar_id: { type: 'string', description: 'Target calendar ID from list_calendars. Defaults to the user\'s configured write calendar or "primary".' },
      },
    },
  },
  {
    name: 'reschedule_task',
    description: 'Move an already-scheduled task to a new time. Reads the existing event reference from the task, patches the calendar event, and updates the task\'s scheduled time. No calendar_id needed — it is read from the task. Use list_tasks to get task_id.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['task_id', 'start', 'duration_minutes'],
      properties: {
        task_id: { type: 'string', description: 'UUID from list_tasks. The task must already have a scheduled event (use schedule_task if not).' },
        start: { type: 'string', description: 'New start datetime in ISO 8601 format (e.g. "2026-05-27T10:00:00").' },
        duration_minutes: { type: 'number', description: 'New duration in minutes.' },
        timezone: { type: 'string', description: 'IANA timezone (e.g. "America/New_York"). Defaults to UTC.' },
      },
    },
  },
]

// deno-lint-ignore no-explicit-any
type Admin = ReturnType<typeof createClient>

async function _ensureGCalToken(userId: string, admin: Admin): Promise<{ token: string | null; error?: string }> {
  const { data: source } = await admin
    .from('calendar_sources')
    .select('id, access_token, refresh_token, token_expires_at')
    .eq('user_id', userId)
    .eq('type', 'google')
    .maybeSingle()

  if (!source?.refresh_token) return { token: null, error: 'Google Calendar not connected for this user' }

  const now = Date.now()
  if (source.access_token && source.token_expires_at > now + 5 * 60 * 1000) {
    return { token: source.access_token }
  }

  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: source.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  if (!refreshRes.ok) return { token: null, error: 'Failed to refresh Google Calendar token' }

  const refreshed = await refreshRes.json()
  await admin.from('calendar_sources').update({
    access_token: refreshed.access_token,
    token_expires_at: now + refreshed.expires_in * 1000,
  }).eq('id', source.id)

  return { token: refreshed.access_token }
}

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

    case 'get_stage_history': {
      const { project_id } = args
      if (!project_id) return toolErr('project_id is required')

      const { allIds } = await getAccessibleProjectIds(userId, admin)
      if (!allIds.includes(project_id)) return toolErr('Project not found or access denied')

      const { data: history, error } = await admin
        .from('project_stage_history')
        .select('entered_at, stage:stages(id, name)')
        .eq('project_id', project_id)
        .order('entered_at', { ascending: false })
      if (error) return toolErr(error.message)

      const now = new Date()
      const out = (history ?? []).map((entry: any, i: number) => {
        const enteredAt = new Date(entry.entered_at)
        const exitedAt = i === 0 ? now : new Date((history as any[])[i - 1].entered_at)
        const days = Math.round((exitedAt.getTime() - enteredAt.getTime()) / 86_400_000)
        return {
          stage: entry.stage?.name ?? 'Unassigned',
          entered_at: entry.entered_at,
          days_in_stage: days,
          current: i === 0,
        }
      })
      return toolOk(JSON.stringify(out, null, 2))
    }

    case 'get_scheduling_preferences': {
      const { data: settings } = await admin
        .from('user_settings')
        .select('timezone, work_start_time, work_end_time, work_days, default_task_duration_minutes')
        .eq('user_id', userId)
        .maybeSingle()

      const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
      const days = (settings as any)?.work_days ?? [1, 2, 3, 4, 5]
      return toolOk(JSON.stringify({
        timezone: (settings as any)?.timezone ?? null,
        work_start_time: (settings as any)?.work_start_time ?? '09:00',
        work_end_time: (settings as any)?.work_end_time ?? '17:00',
        work_days: days,
        work_day_names: days.map((d: number) => DAY_NAMES[d] ?? d),
        default_task_duration_minutes: (settings as any)?.default_task_duration_minutes ?? 60,
      }, null, 2))
    }

    case 'update_scheduling_preferences': {
      const patch: Record<string, unknown> = {}
      if (args.timezone !== undefined) patch.timezone = args.timezone
      if (args.work_start_time !== undefined) patch.work_start_time = args.work_start_time
      if (args.work_end_time !== undefined) patch.work_end_time = args.work_end_time
      if (args.work_days !== undefined) patch.work_days = args.work_days
      if (args.default_task_duration_minutes !== undefined) patch.default_task_duration_minutes = args.default_task_duration_minutes
      if (Object.keys(patch).length === 0) return toolErr('No fields to update')
      await admin.from('user_settings').upsert(
        { user_id: userId, ...patch },
        { onConflict: 'user_id' }
      )
      return toolOk('Scheduling preferences updated.')
    }

    case 'list_calendars': {
      // deno-lint-ignore no-explicit-any
      const out: any[] = []

      // Google Calendar
      const { token } = await _ensureGCalToken(userId, admin)
      if (token) {
        const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          const data = await res.json()
          // deno-lint-ignore no-explicit-any
          for (const cal of (data.items ?? []) as any[]) {
            out.push({ id: cal.id, name: cal.summary, source: 'Google Calendar', access_role: cal.accessRole, color: cal.backgroundColor ?? null })
          }
        }
      }

      // CalDAV / iCloud sources
      const { data: caldavSources } = await admin.from('calendar_sources')
        .select('id, type, name, url, username, password')
        .eq('user_id', userId)
        .in('type', ['caldav', 'icloud'])
        .eq('enabled', true)
      for (const src of (caldavSources ?? []) as any[]) {
        try {
          const cals = await listCalendarsFromHomeSet(src.url, src.username, src.password)
          const srcLabel = src.type === 'icloud' ? 'iCloud' : src.name
          for (const cal of cals) {
            out.push({ id: cal.href, name: cal.name, source: srcLabel, access_role: 'owner', color: cal.color })
          }
        } catch { /* skip sources that fail */ }
      }

      return toolOk(JSON.stringify(out, null, 2))
    }

    case 'get_events': {
      let timeMin: Date, timeMax: Date
      if (args.date) {
        timeMin = new Date(`${args.date}T00:00:00Z`)
        timeMax = new Date(`${args.date}T23:59:59Z`)
      } else if (args.start_date && args.end_date) {
        timeMin = new Date(`${args.start_date}T00:00:00Z`)
        timeMax = new Date(`${args.end_date}T23:59:59Z`)
        if (timeMax.getTime() - timeMin.getTime() > 14 * 24 * 60 * 60 * 1000) {
          return toolErr('Date range exceeds maximum of 2 weeks')
        }
      } else {
        return toolErr('Provide either "date" or both "start_date" and "end_date"')
      }

      // deno-lint-ignore no-explicit-any
      const out: any[] = []

      // Google Calendar
      const { token } = await _ensureGCalToken(userId, admin)
      if (token) {
        const targetCalId = (args.calendar_id as string) ?? null
        const { data: gcalSources } = await admin.from('calendar_sources')
          .select('id').eq('user_id', userId).eq('type', 'google').maybeSingle()

        // If a specific calendar_id was requested and it looks like a CalDAV href, skip Google
        const isCalDAVHref = targetCalId && targetCalId.startsWith('http')

        if (!isCalDAVHref) {
          const params = new URLSearchParams({
            timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(),
            singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
          })
          const calIdEnc = encodeURIComponent(targetCalId ?? 'primary')
          const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calIdEnc}/events?${params}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (res.ok) {
            const data = await res.json()
            // deno-lint-ignore no-explicit-any
            for (const ev of (data.items ?? []) as any[]) {
              out.push({
                id: ev.id,
                summary: ev.summary ?? '(No title)',
                start: ev.start?.dateTime ?? ev.start?.date,
                end: ev.end?.dateTime ?? ev.end?.date,
                description: ev.description ?? null,
                calendar_id: targetCalId ?? 'primary',
                source: 'Google Calendar',
                status: ev.status ?? null,
              })
            }
          }
        }
      }

      // CalDAV / iCloud sources (fan-out across all enabled sources if no specific caldav href requested)
      const targetHref = args.calendar_id && (args.calendar_id as string).startsWith('http') ? args.calendar_id as string : null
      const { data: caldavSources } = await admin.from('calendar_sources')
        .select('id, type, name, url, username, password')
        .eq('user_id', userId)
        .in('type', ['caldav', 'icloud'])
        .eq('enabled', true)

      // deno-lint-ignore no-explicit-any
      await Promise.allSettled(((caldavSources ?? []) as any[]).flatMap(async (src: any) => {
        try {
          const cals = await listCalendarsFromHomeSet(src.url, src.username, src.password)
          const calList = targetHref ? cals.filter(c => c.href === targetHref) : cals
          const srcLabel = src.type === 'icloud' ? 'iCloud' : src.name
          await Promise.allSettled(calList.map(async cal => {
            try {
              const events = await getCalendarEvents(cal.href, src.username, src.password, timeMin, timeMax)
              for (const ev of events) {
                out.push({
                  id: ev.uid,
                  summary: ev.summary || '(No title)',
                  start: ev.start,
                  end: ev.end,
                  description: ev.description || null,
                  calendar_id: cal.href,
                  source: `${srcLabel} — ${cal.name}`,
                  status: null,
                })
              }
            } catch { /* skip calendars that fail */ }
          }))
        } catch { /* skip sources that fail */ }
      }))

      out.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      return toolOk(JSON.stringify(out, null, 2))
    }

    case 'schedule_task': {
      const { token, error: tokenError } = await _ensureGCalToken(userId, admin)
      if (!token) return toolErr(tokenError!)

      const { task_id, start, duration_minutes, timezone, calendar_id } = args
      if (!task_id) return toolErr('task_id is required')
      if (!start) return toolErr('start is required')
      if (!duration_minutes) return toolErr('duration_minutes is required')

      // Get task + project name for event description
      const { data: task } = await admin
        .from('tasks')
        .select('id, content, description, project_id')
        .eq('id', task_id)
        .single()
      if (!task) return toolErr('Task not found')

      let projectName = ''
      if (task.project_id) {
        const { data: proj } = await admin.from('projects').select('name').eq('id', task.project_id).single()
        projectName = (proj as any)?.name ?? ''
      }

      // Resolve target calendar: explicit arg → stored write-target → 'primary'
      let targetCalId = calendar_id as string | undefined
      if (!targetCalId) {
        const { data: source } = await admin
          .from('calendar_sources')
          .select('calendar_id')
          .eq('user_id', userId)
          .eq('type', 'google')
          .maybeSingle()
        targetCalId = (source as any)?.calendar_id ?? 'primary'
      }

      const tz = (timezone as string) ?? 'UTC'
      const startDate = new Date(start as string)
      const endDate = new Date(startDate.getTime() + (duration_minutes as number) * 60_000)

      const descParts: string[] = []
      if (projectName) descParts.push(`Project: ${projectName}`)
      const notes = ((task.description ?? '') as string)
        .split('\n')
        .filter((l: string) => !l.startsWith('📅 Scheduled:') && !l.startsWith('📅 GCal:'))
        .join('\n').trim()
      if (notes) descParts.push(notes)

      const body = {
        summary: task.content,
        description: descParts.join('\n\n'),
        start: { dateTime: startDate.toISOString(), timeZone: tz },
        end:   { dateTime: endDate.toISOString(),   timeZone: tz },
      }

      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalId!)}/events`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        return toolErr(`Google Calendar error: ${err?.error?.message ?? res.status}`)
      }
      const event = await res.json()

      // Write event reference + scheduled time back to task_schedule
      await admin.from('task_schedule').upsert({
        user_id: userId,
        task_id,
        caldav_event_uid: event.id,
        caldav_calendar_id: targetCalId,
        scheduled_at: startDate.toISOString(),
      }, { onConflict: 'user_id,task_id' })

      return toolOk(JSON.stringify({
        task_id,
        event_id: event.id,
        calendar_id: targetCalId,
        scheduled_at: startDate.toISOString(),
        html_link: event.htmlLink,
      }, null, 2))
    }

    case 'reschedule_task': {
      const { token, error: tokenError } = await _ensureGCalToken(userId, admin)
      if (!token) return toolErr(tokenError!)

      const { task_id, start, duration_minutes, timezone } = args
      if (!task_id) return toolErr('task_id is required')
      if (!start) return toolErr('start is required')
      if (!duration_minutes) return toolErr('duration_minutes is required')

      // Read existing event reference from task_schedule
      const { data: schedule } = await admin
        .from('task_schedule')
        .select('caldav_event_uid, caldav_calendar_id')
        .eq('user_id', userId)
        .eq('task_id', task_id)
        .single()
      if (!schedule?.caldav_event_uid) {
        return toolErr('Task has no scheduled event. Use schedule_task to create one first.')
      }

      const tz = (timezone as string) ?? 'UTC'
      const startDate = new Date(start as string)
      const endDate = new Date(startDate.getTime() + (duration_minutes as number) * 60_000)

      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(schedule.caldav_calendar_id)}/events/${encodeURIComponent(schedule.caldav_event_uid)}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            start: { dateTime: startDate.toISOString(), timeZone: tz },
            end:   { dateTime: endDate.toISOString(),   timeZone: tz },
          }),
        }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        return toolErr(`Google Calendar error: ${err?.error?.message ?? res.status}`)
      }

      await admin.from('task_schedule')
        .update({ scheduled_at: startDate.toISOString() })
        .eq('user_id', userId)
        .eq('task_id', task_id)

      return toolOk(JSON.stringify({
        task_id,
        event_id: schedule.caldav_event_uid,
        calendar_id: schedule.caldav_calendar_id,
        scheduled_at: startDate.toISOString(),
      }, null, 2))
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
        instructions: `researchflo manages academic research projects and tasks, with Google Calendar integration for scheduling.

TOOL CHAINING (call in this order):
- Projects: list_projects → update_project / add_task / get_stage_history
- Tasks: list_projects → list_tasks → update_task / mark_task_complete
- Calendar (read): list_calendars → get_events
- Schedule task: get_scheduling_preferences → list_tasks → (list_calendars) → (get_events, check conflicts) → schedule_task
- Reschedule task: list_tasks → reschedule_task

ID SOURCES:
- project_id → list_projects
- task_id → list_tasks
- calendar_id → list_calendars (or from get_events results)

FORMATS:
- Dates: YYYY-MM-DD (e.g. "2026-05-26")
- Datetimes: ISO 8601 (e.g. "2026-05-26T14:00:00"). Always include timezone for timed calendar events.
- Priority: 1=normal, 2=medium, 3=high, 4=urgent

COMMON WORKFLOWS:

Weekly review / sprint planning:
  1. get_project_stats — see deadline pressure and open task counts
  2. list_projects — identify which projects need attention
  3. update_project (multiple) — update status_text or stage for each project discussed
  4. list_calendars + get_events — check the week's calendar for conflicts

Batch task capture after a meeting:
  1. list_projects — find the relevant project_id
  2. add_task (repeat) — one call per task captured; set priority and due_date while context is fresh

Schedule tasks for the week:
  1. get_scheduling_preferences — get working hours, days, timezone, default duration
  2. list_tasks — find open tasks to schedule
  2. list_calendars — resolve calendar_id once
  3. get_events — check existing commitments for the target days
  4. schedule_task (repeat) — one call per task; creates the calendar event and writes the reference back to the task

Reschedule a task:
  1. list_tasks — get task_id
  2. reschedule_task — no calendar lookup needed, reads event reference from the task

Create and schedule new tasks (e.g. paper reviews before a deadline):
  1. get_scheduling_preferences — get working hours, days, timezone, default duration
  2. list_projects — find the right project_id
  2. add_task (repeat) — create one task per item; set due_date to the deadline
  3. list_calendars — resolve calendar_id once
  4. get_events — check the window between now and the deadline for existing commitments
  5. schedule_task (repeat) — distribute tasks evenly across free slots before the deadline
  When spacing tasks, avoid weekends and existing events; prefer morning slots unless told otherwise.

Quick project status update:
  1. list_projects — get project_id and current state
  2. update_project — set new stage, status_text, deadline in a single call`,
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
