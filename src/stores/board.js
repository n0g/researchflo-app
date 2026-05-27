import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '../lib/supabase.js'
import { useCalendarStore } from './calendar.js'
import { DEFAULT_STAGES, parseLocalDate } from '../lib/helpers.js'

export const useBoardStore = defineStore('board', () => {
  // ── State ──────────────────────────────────────────────────────────────────
  const token = ref('supabase')  // Always truthy; Todoist token no longer needed
  const stages = ref(JSON.parse(localStorage.getItem('rb_stages') || 'null'))
  const projects = ref([])
  const tasks = ref([])
  const excludedSectionIds = ref(new Set())  // Empty — no sections in Supabase schema
  const deadlineSectionIds = ref(new Set())  // Empty — deadline is a project column
  const lastUpdated = ref(null)
  const loading = ref(false)
  const setupStatus = ref('')
  const cardDragging = ref(false)
  const triageTaskIds = ref([])
  const triageCurrentId = ref(null)
  const pendingScheduleTask = ref(null)
  const labels = ref([])  // No Todoist labels; kept for API compat (always empty)
  const activeFilter = ref(null)

  // Internal map of stage UUID → { name, icon } built during loadData()
  const _stageById = ref(new Map())
  // Per-user energy levels: projectId → 0|1|2
  const _userEnergy = ref(new Map())
  // Per-user task schedule: taskId → { caldav_event_uid, caldav_calendar_id, scheduled_at }
  const _taskSchedule = ref(new Map())
  // Current user's people.id — used for self-filter in collaborator lists
  const myPeopleId = ref(null)
  // Cache of completed tasks per project, fetched on demand: projectId → task[]
  const completedTasksCache = ref({})
  // Lightweight count cache populated on page load: cacheKey → number
  const completedCountCache = ref({})

  // ── Computed ───────────────────────────────────────────────────────────────
  const stageLabels = computed(() => (stages.value || []).map(s => s.id).filter(Boolean))
  const displayProjects = computed(() => projects.value)
  const inboxProjectId = computed(() => null)

  const allPeople = computed(() => {
    const map = new Map()
    for (const p of projects.value) {
      if (p.owner_person && !map.has(p.owner_person.id)) map.set(p.owner_person.id, p.owner_person)
      for (const m of (p.members || [])) {
        if (m.person && !map.has(m.person.id)) map.set(m.person.id, m.person)
      }
    }
    return [...map.values()]
  })

  const allCollaborators = computed(() =>
    [...new Set(allPeople.value.map(p => p.display_name))].sort()
  )

  const allVenues = computed(() => {
    const venues = new Set()
    displayProjects.value.forEach(p => { if (p.venue) venues.add(p.venue) })
    return [...venues].sort()
  })

  const focusProjectIds = computed(() => {
    const ids = new Set()
    for (const [projectId, energy] of _userEnergy.value) {
      if (energy > 0) ids.add(projectId)
    }
    return ids
  })

  // ── Internal helpers ───────────────────────────────────────────────────────

  // Reconstruct the in-memory description string from clean DB description + managed columns
  function _buildTaskDescription(task) {
    const base = (task.description || '').trim()
    const gcalLine = task.caldav_event_uid
      ? `📅 GCal: ${task.caldav_event_uid}|${task.caldav_calendar_id ?? ''}`
      : null
    let scheduledLine = null
    if (task.scheduled_at) {
      const d = new Date(task.scheduled_at)
      const readable =
        d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) +
        ' at ' +
        d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      scheduledLine = `📅 Scheduled: ${readable} (${task.scheduled_at})`
    }
    return [base, gcalLine, scheduledLine].filter(Boolean).join('\n')
  }

  // Normalize a raw Supabase task row to match the shape components expect.
  // scheduleMap is passed during initial loadData(); otherwise falls back to the live _taskSchedule map.
  function _transformTask(t, scheduleMap) {
    const sched = (scheduleMap ?? _taskSchedule.value).get(t.id)
    const withSched = {
      ...t,
      due: t.due_date ? { date: t.due_date } : null,
      order: t.sort_order ?? 0,
      caldav_event_uid: sched?.caldav_event_uid ?? null,
      caldav_calendar_id: sched?.caldav_calendar_id ?? null,
      scheduled_at: sched?.scheduled_at ?? null,
    }
    return { ...withSched, description: _buildTaskDescription(withSched) }
  }

  // ── Filter ─────────────────────────────────────────────────────────────────
  function setFilter(type, value) {
    if (activeFilter.value?.type === type && activeFilter.value?.value === value) {
      activeFilter.value = null
    } else {
      activeFilter.value = { type, value }
    }
  }

  // ── Stage display config (not DB stage records) ────────────────────────────
  function initStages() {
    if (!stages.value) {
      stages.value = DEFAULT_STAGES
      localStorage.setItem('rb_stages', JSON.stringify(DEFAULT_STAGES))
    }
  }

  async function saveStages(newStages) {
    const result = []
    for (let i = 0; i < newStages.length; i++) {
      const s = newStages[i]
      if (s.id) {
        await supabase.from('stages').update({ name: s.name, icon: s.icon || 'kanban', sort_order: i }).eq('id', s.id)
        result.push({ id: s.id, name: s.name, icon: s.icon || 'kanban', sort_order: i })
      } else {
        const { data: inserted } = await supabase.from('stages').insert({
          name: s.name,
          icon: s.icon || 'kanban',
          sort_order: i,
        }).select().single()
        if (inserted) result.push({ id: inserted.id, name: s.name, icon: s.icon || 'kanban', sort_order: i })
      }
    }
    stages.value = result
    localStorage.setItem('rb_stages', JSON.stringify(result))
    // Rebuild map
    const m = new Map()
    for (const s of result) m.set(s.id, s)
    _stageById.value = m
  }

  // ── Auth ───────────────────────────────────────────────────────────────────
  async function saveToken() {}  // No-op; auth handled by Supabase

  async function resetToken() {
    await supabase.auth.signOut()
  }

  // ── Data loading ───────────────────────────────────────────────────────────
  async function loadIfStale() {
    const TEN_MIN = 10 * 60 * 1000
    if (!lastUpdated.value || Date.now() - lastUpdated.value.getTime() > TEN_MIN) {
      await loadData()
      return true
    }
    return false
  }

  async function loadData() {
    loading.value = true
    try {
      // Ensure current user has a people row (creates one if missing) and store their people.id
      const myProfile = await loadMyProfile().catch(() => null)
      myPeopleId.value = myProfile?.id ?? null

      const [
        { data: projectsData, error: projErr },
        { data: tasksData,    error: taskErr },
        { data: stagesData,   error: stageErr },
        { data: scheduleData },
      ] = await Promise.all([
        supabase.from('projects').select('*, members:project_members(person:people(id, display_name, user_id, email, invite_token))').order('name'),
        supabase.from('tasks').select('*').eq('is_completed', false).order('sort_order', { ascending: true }),
        supabase.from('stages').select('*'),
        supabase.from('task_schedule').select('task_id, caldav_event_uid, caldav_calendar_id, scheduled_at'),
      ])

      if (projErr)  console.error('[board] projects error:', JSON.stringify(projErr))
      if (taskErr)  console.error('[board] tasks error:', JSON.stringify(taskErr))
      if (stageErr) console.error('[board] stages error:', JSON.stringify(stageErr))
      console.log('[board] loaded:', projectsData?.length, 'projects,', tasksData?.length, 'tasks,', stagesData?.length, 'stages')

      // Fetch owner people rows so collaborator list can include project owners
      const ownerIds = [...new Set((projectsData || []).map(p => p.owner_id).filter(Boolean))]
      const ownerPeopleMap = new Map()
      if (ownerIds.length) {
        const { data: ownerPeople } = await supabase
          .from('people')
          .select('id, display_name, user_id, email, invite_token')
          .in('user_id', ownerIds)
        for (const p of (ownerPeople || [])) ownerPeopleMap.set(p.user_id, p)
      }
      for (const proj of (projectsData || [])) {
        proj.owner_person = ownerPeopleMap.get(proj.owner_id) || null
      }

      projects.value = projectsData || []

      // Build per-user schedule map before transforming tasks so virtual fields are populated
      const scheduleMap = new Map()
      for (const row of (scheduleData || [])) scheduleMap.set(row.task_id, row)
      _taskSchedule.value = scheduleMap
      tasks.value = (tasksData || []).map(t => _transformTask(t, scheduleMap))

      // Load per-user energy levels
      const { data: focusData } = await supabase.from('project_focus').select('project_id, energy')
      const energyMap = new Map()
      for (const row of (focusData || [])) energyMap.set(row.project_id, row.energy)
      _userEnergy.value = energyMap

      // Build internal stage UUID → { name, icon } map
      const byId = new Map()
      for (const s of (stagesData || [])) byId.set(s.id, { name: s.name, icon: s.icon || 'kanban' })
      _stageById.value = byId

      // Always sync display stages from DB so IDs stay in sync
      if (stagesData?.length) {
        const derived = stagesData
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map(s => ({ id: s.id, name: s.name, icon: s.icon || 'kanban' }))
        stages.value = derived
        localStorage.setItem('rb_stages', JSON.stringify(derived))
      }

      lastUpdated.value = new Date()
    } finally {
      loading.value = false
    }
  }

  // ── Project queries ────────────────────────────────────────────────────────
  function projectStage(projectId) {
    const project = projects.value.find(p => p.id === projectId)
    if (!project?.stage_id) return null
    const info = _stageById.value.get(project.stage_id)
    if (!info) return null
    return { id: project.stage_id, name: info.name, icon: info.icon }
  }

  function projectStatusTask(projectId) {
    const project = projects.value.find(p => p.id === projectId)
    if (!project) return null
    return { id: projectId, content: project.status_text || '', labels: [] }
  }

  function projectDeadlineTaskBase(projectId) {
    const project = projects.value.find(p => p.id === projectId)
    if (!project) return null
    return {
      id: projectId,
      content: project.venue || '',
      due: project.deadline ? { date: project.deadline } : null,
    }
  }

  function projectDeadlineTaskObj(projectId) {
    const project = projects.value.find(p => p.id === projectId)
    if (!project?.deadline) return null
    return {
      id: projectId,
      content: project.venue || project.name,
      due: { date: project.deadline },
    }
  }

  function projectMeta(projectId) {
    const project = projects.value.find(p => p.id === projectId)
    return { venue: project?.venue || null, author: null }
  }

  function projectTasks(projectId) {
    return tasks.value
      .filter(t => t.project_id === projectId && !t.is_completed && !t.is_private)
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
  }

  function privateProjectTasks(projectId) {
    return tasks.value
      .filter(t => t.project_id === projectId && !t.is_completed && t.is_private)
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
  }

  function _ck(projectId) { return projectId ?? '__inbox__' }

  function completedProjectTasks(projectId) {
    return completedTasksCache.value[_ck(projectId)] || []
  }

  function completedProjectTaskCount(projectId) {
    const key = _ck(projectId)
    return completedTasksCache.value[key]?.length ?? completedCountCache.value[key] ?? 0
  }

  async function fetchCompletedCount(projectId) {
    const key = _ck(projectId)
    let query = supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('is_completed', true)
    query = projectId === null ? query.is('project_id', null) : query.eq('project_id', projectId)
    const { count, error } = await query
    if (error) throw new Error(error.message)
    completedCountCache.value = { ...completedCountCache.value, [key]: count ?? 0 }
  }

  async function fetchCompletedTasks(projectId) {
    let query = supabase.from('tasks').select('*').eq('is_completed', true).order('completed_at', { ascending: false }).limit(50)
    query = projectId === null ? query.is('project_id', null) : query.eq('project_id', projectId)
    const { data, error } = await query
    if (error) throw new Error(error.message)
    const transformed = (data || []).map(t => _transformTask(t))
    const key = _ck(projectId)
    completedTasksCache.value = { ...completedTasksCache.value, [key]: transformed }
    completedCountCache.value = { ...completedCountCache.value, [key]: transformed.length }
  }

  function completedInboxTasks() {
    return completedTasksCache.value['__inbox__'] || []
  }

  function _addToCompletedCache(row) {
    const key = _ck(row.project_id)
    const fullCache = completedTasksCache.value[key]
    if (fullCache !== undefined) {
      completedTasksCache.value = { ...completedTasksCache.value, [key]: [_transformTask(row), ...fullCache] }
    } else if (completedCountCache.value[key] !== undefined) {
      completedCountCache.value = { ...completedCountCache.value, [key]: completedCountCache.value[key] + 1 }
    }
  }

  function _removeFromCompletedCache(taskId, projectId) {
    const key = _ck(projectId)
    const fullCache = completedTasksCache.value[key]
    if (fullCache !== undefined) {
      const next = fullCache.filter(t => t.id !== taskId)
      if (next.length < fullCache.length) {
        completedTasksCache.value = { ...completedTasksCache.value, [key]: next }
        completedCountCache.value = { ...completedCountCache.value, [key]: next.length }
      }
    } else if (completedCountCache.value[key] !== undefined) {
      completedCountCache.value = { ...completedCountCache.value, [key]: Math.max(0, completedCountCache.value[key] - 1) }
    }
  }

  function projectDeadline(projectId) {
    const project = projects.value.find(p => p.id === projectId)
    if (!project?.deadline) return null
    return parseLocalDate(project.deadline)
  }

  function projectSummaryTask(projectId) {
    const project = projects.value.find(p => p.id === projectId)
    if (!project) return null
    return { id: projectId, content: project.summary || '' }
  }

  function projectSubmissionTask(projectId) {
    const project = projects.value.find(p => p.id === projectId)
    if (!project) return null
    return { id: projectId, content: project.submission_url || '' }
  }

  function projectEnergy(projectId) {
    return _userEnergy.value.get(projectId) || 0
  }

  // ── Project mutations ──────────────────────────────────────────────────────
  async function moveStage(projectId, _oldTaskId, _oldId, newStageId) {
    const { error } = await supabase.from('projects').update({ stage_id: newStageId || null }).eq('id', projectId)
    if (error) throw new Error(error.message)
    const project = projects.value.find(p => p.id === projectId)
    if (project) project.stage_id = newStageId || null
  }

  // projectId passed as taskId — pseudo-tasks have id === projectId
  async function updateStatusText(projectId, content) {
    const { error } = await supabase.from('projects').update({ status_text: content }).eq('id', projectId)
    if (error) throw new Error(error.message)
    const project = projects.value.find(p => p.id === projectId)
    if (project) project.status_text = content
  }

  async function updateVenue(projectId, name) {
    const { error } = await supabase.from('projects').update({ venue: name || '' }).eq('id', projectId)
    if (error) throw new Error(error.message)
    const project = projects.value.find(p => p.id === projectId)
    if (project) project.venue = name || ''
  }

  async function setDeadlineDate(projectId, dateVal) {
    const { error } = await supabase.from('projects').update({ deadline: dateVal || null }).eq('id', projectId)
    if (error) throw new Error(error.message)
    const project = projects.value.find(p => p.id === projectId)
    if (project) project.deadline = dateVal || null
  }

  async function updateSummary(projectId, text) {
    const { error } = await supabase.from('projects').update({ summary: text || '' }).eq('id', projectId)
    if (error) throw new Error(error.message)
    const project = projects.value.find(p => p.id === projectId)
    if (project) project.summary = text || ''
  }

  async function updateSubmissionUrl(projectId, url) {
    const { error } = await supabase.from('projects').update({ submission_url: url || '' }).eq('id', projectId)
    if (error) throw new Error(error.message)
    const project = projects.value.find(p => p.id === projectId)
    if (project) project.submission_url = url || ''
  }

  async function addCollaborator(projectId, name) {
    const project = projects.value.find(p => p.id === projectId)
    if (!project) return
    const trimmed = name.trim()
    if (!trimmed) return
    const { data: { user } } = await supabase.auth.getUser()
    // Reuse existing person if name matches
    let person = allPeople.value.find(p => p.display_name.toLowerCase() === trimmed.toLowerCase())
    if (!person) {
      const { data, error } = await supabase.from('people')
        .insert({ display_name: trimmed, invited_by: user.id })
        .select().single()
      if (error) throw new Error(error.message)
      person = data
    }
    const { error } = await supabase.from('project_members')
      .insert({ project_id: projectId, person_id: person.id, added_by: user.id })
    if (error && error.code !== '23505') throw new Error(error.message) // ignore duplicate
    if (!project.members) project.members = []
    if (!project.members.find(m => m.person?.id === person.id)) {
      project.members.push({ person })
    }
  }

  async function removeCollaborator(projectId, personId) {
    const project = projects.value.find(p => p.id === projectId)
    if (!project) return
    const { error } = await supabase.from('project_members')
      .delete().eq('project_id', projectId).eq('person_id', personId)
    if (error) throw new Error(error.message)
    project.members = (project.members || []).filter(m => m.person?.id !== personId)
  }

  async function loadPendingCollaborators() {
    const { data, error } = await supabase
      .from('people')
      .select('id, display_name, email, invite_token')
      .is('user_id', null)
    if (error) throw new Error(error.message)
    return data || []
  }

  async function loadMyProfile() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { data } = await supabase.from('people').select('id, display_name, email').eq('user_id', user.id).single()
    if (data) return data
    // Owner has no people row yet — create one
    const defaultName = user.user_metadata?.name || user.email?.split('@')[0] || ''
    const { data: created } = await supabase
      .from('people')
      .insert({ user_id: user.id, display_name: defaultName, email: user.email || null })
      .select('id, display_name, email')
      .single()
    return created
  }

  async function saveMyDisplayName(name) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: existing } = await supabase.from('people').select('id').eq('user_id', user.id).single()
    if (existing) {
      await supabase.from('people').update({ display_name: name.trim() }).eq('user_id', user.id)
    } else {
      await supabase.from('people').insert({ user_id: user.id, display_name: name.trim() })
    }
  }

  async function savePersonEmail(personId, email) {
    const { error } = await supabase.from('people').update({ email: email.trim() || null }).eq('id', personId)
    if (error) throw new Error(error.message)
  }

  async function sendInviteEmail(personId, email) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-collaborator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ personId, email }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Failed to send invite')
    // Update local state
    const person = allPeople.value.find(p => p.id === personId)
    if (person) person.email = email
  }

  async function claimInvite(token) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('people')
      .update({ user_id: user.id, joined_at: new Date().toISOString() })
      .eq('invite_token', token)
      .is('user_id', null)
  }

  async function cycleEnergy(projectId) {
    const next = ((_userEnergy.value.get(projectId) || 0) + 1) % 3
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('project_focus')
      .upsert({ user_id: user.id, project_id: projectId, energy: next, updated_at: new Date().toISOString() })
    if (error) throw new Error(error.message)
    _userEnergy.value = new Map(_userEnergy.value).set(projectId, next)
  }

  function applyRealtimeTask(event, newRow, oldRow) {
    if (event === 'DELETE') {
      tasks.value = tasks.value.filter(t => t.id !== oldRow.id)
      _removeFromCompletedCache(oldRow.id, oldRow.project_id)
      return
    }
    if (newRow.is_completed) {
      tasks.value = tasks.value.filter(t => t.id !== newRow.id)
      if (!oldRow?.is_completed) _addToCompletedCache(newRow)
      return
    }
    if (oldRow?.is_completed) _removeFromCompletedCache(newRow.id, newRow.project_id)
    const transformed = _transformTask(newRow)
    const idx = tasks.value.findIndex(t => t.id === transformed.id)
    if (idx >= 0) tasks.value.splice(idx, 1, transformed)
    else tasks.value.push(transformed)
  }

  function applyRealtimeProject(newRow) {
    const idx = projects.value.findIndex(p => p.id === newRow.id)
    if (idx < 0) return
    const existing = projects.value[idx]
    // Preserve joined data (members, owner_person) which realtime doesn't include
    projects.value.splice(idx, 1, { ...existing, ...newRow, members: existing.members, owner_person: existing.owner_person })
  }

  async function applyRealtimeMember(event, newRow, oldRow) {
    if (event === 'DELETE') {
      const { project_id, person_id } = oldRow
      const project = projects.value.find(p => p.id === project_id)
      if (project) project.members = (project.members || []).filter(m => m.person?.id !== person_id)
    } else if (event === 'INSERT') {
      const { project_id, person_id } = newRow
      const project = projects.value.find(p => p.id === project_id)
      if (!project || (project.members || []).some(m => m.person?.id === person_id)) return
      const { data: person } = await supabase.from('people').select('id, display_name, user_id, email, invite_token').eq('id', person_id).single()
      if (person) {
        if (!project.members) project.members = []
        project.members.push({ person })
      }
    }
  }

  async function renameProject(projectId, name) {
    const { error } = await supabase.from('projects').update({ name }).eq('id', projectId)
    if (error) throw new Error(error.message)
    const project = projects.value.find(p => p.id === projectId)
    if (project) project.name = name
  }

  async function deleteProject(projectId) {
    const { error } = await supabase.from('projects').delete().eq('id', projectId)
    if (error) throw new Error(error.message)
    projects.value = projects.value.filter(p => p.id !== projectId)
    tasks.value = tasks.value.filter(t => t.project_id !== projectId)
  }

  async function createProject(name, stageId) {
    const { data: { user } } = await supabase.auth.getUser()
    const resolvedStageId = stageId ?? stages.value?.[0]?.id ?? null

    const { data: project, error } = await supabase.from('projects').insert({
      name,
      owner_id: user.id,
      stage_id: resolvedStageId,
    }).select().single()
    if (error) throw new Error(error.message)

    const { data: myPerson } = await supabase.from('people')
      .select('id, display_name, user_id, email, invite_token')
      .eq('user_id', user.id).maybeSingle()
    projects.value.push({ ...project, members: [], owner_person: myPerson || null })
    return project
  }

  // ── Task mutations ─────────────────────────────────────────────────────────
  async function completeTask(taskId) {
    const { error } = await supabase.from('tasks')
      .update({ is_completed: true, completed_at: new Date().toISOString() })
      .eq('id', taskId)
    if (error) throw new Error(error.message)
    await useCalendarStore().deleteAllByTaskId(taskId).catch(() => {})
    tasks.value = tasks.value.filter(t => t.id !== taskId)
  }

  async function uncompleteTask(taskId, projectId) {
    const { data, error } = await supabase.from('tasks')
      .update({ is_completed: false, completed_at: null })
      .eq('id', taskId)
      .select().single()
    if (error) throw new Error(error.message)
    // Remove from completed cache
    const cacheKey = projectId ?? '__inbox__'
    const cache = completedTasksCache.value[cacheKey]
    if (cache) {
      completedTasksCache.value = {
        ...completedTasksCache.value,
        [cacheKey]: cache.filter(t => t.id !== taskId),
      }
    }
    // Add back to active tasks
    tasks.value.push(_transformTask(data))
  }

  async function deleteTask(taskId) {
    const { error } = await supabase.from('tasks').delete().eq('id', taskId)
    if (error) throw new Error(error.message)
    tasks.value = tasks.value.filter(t => t.id !== taskId)
  }

  async function reorderTasks(orderedTaskIds) {
    orderedTaskIds.forEach((id, idx) => {
      const task = tasks.value.find(t => t.id === id)
      if (task) { task.sort_order = idx + 1; task.order = idx + 1 }
    })
    await Promise.all(
      orderedTaskIds.map((id, idx) =>
        supabase.from('tasks').update({ sort_order: idx + 1 }).eq('id', id)
      )
    )
  }

  async function unPrivatizeTask(taskId, newOrderedPublicIds) {
    const task = tasks.value.find(t => t.id === taskId)
    if (task) task.is_private = false
    newOrderedPublicIds.forEach((id, idx) => {
      const t = tasks.value.find(t => t.id === id)
      if (t) { t.sort_order = idx + 1; t.order = idx + 1 }
    })
    await Promise.all([
      supabase.from('tasks').update({ is_private: false }).eq('id', taskId),
      ...newOrderedPublicIds.map((id, idx) =>
        supabase.from('tasks').update({ sort_order: idx + 1 }).eq('id', id)
      )
    ])
  }

  async function quickAddTask(content, projectId, isPrivate = false) {
    const { data: { user } } = await supabase.auth.getUser()
    const { data: task, error } = await supabase.from('tasks')
      .insert({ content, project_id: projectId, created_by: user.id, is_private: isPrivate || false })
      .select().single()
    if (error) throw new Error(error.message)
    tasks.value.push(_transformTask(task))
  }

  async function addInboxTask(content, description) {
    const { data: { user } } = await supabase.auth.getUser()
    const { data: task, error } = await supabase.from('tasks')
      .insert({ content, description: description || '', created_by: user.id, project_id: null })
      .select().single()
    if (error) throw new Error(error.message)
    const t = _transformTask(task)
    tasks.value.push(t)
    return t
  }

  async function assignTaskToProject(taskId, projectId) {
    const { error } = await supabase.from('tasks').update({ project_id: projectId }).eq('id', taskId)
    if (error) throw new Error(error.message)
    const task = tasks.value.find(t => t.id === taskId)
    if (task) task.project_id = projectId
  }

  async function updateTaskContent(taskId, content) {
    const { error } = await supabase.from('tasks').update({ content }).eq('id', taskId)
    if (error) throw new Error(error.message)
    const task = tasks.value.find(t => t.id === taskId)
    if (task) task.content = content
  }

  async function updateTaskDue(taskId, dateVal) {
    const { error } = await supabase.from('tasks').update({ due_date: dateVal || null }).eq('id', taskId)
    if (error) throw new Error(error.message)
    const task = tasks.value.find(t => t.id === taskId)
    if (task) task.due = dateVal ? { date: dateVal } : null
  }

  async function saveGCalEvent(taskId, eventId, calId) {
    const { data: { user } } = await supabase.auth.getUser()
    const existing = _taskSchedule.value.get(taskId) || {}
    const row = { user_id: user.id, task_id: taskId, caldav_event_uid: eventId, caldav_calendar_id: calId, scheduled_at: existing.scheduled_at ?? null }
    const { error } = await supabase.from('task_schedule').upsert(row, { onConflict: 'user_id,task_id' })
    if (error) throw new Error(error.message)
    _taskSchedule.value = new Map(_taskSchedule.value).set(taskId, { ...existing, caldav_event_uid: eventId, caldav_calendar_id: calId })
    const task = tasks.value.find(t => t.id === taskId)
    if (task) {
      task.caldav_event_uid = eventId
      task.caldav_calendar_id = calId
      task.description = _buildTaskDescription(task)
    }
  }

  async function saveScheduledTime(taskId, isoDatetime) {
    const task = tasks.value.find(t => t.id === taskId)
    if (!task) return
    const { data: { user } } = await supabase.auth.getUser()
    const existing = _taskSchedule.value.get(taskId) || {}
    const row = { user_id: user.id, task_id: taskId, caldav_event_uid: existing.caldav_event_uid ?? null, caldav_calendar_id: existing.caldav_calendar_id ?? null, scheduled_at: isoDatetime }
    const { error } = await supabase.from('task_schedule').upsert(row, { onConflict: 'user_id,task_id' })
    if (error) throw new Error(error.message)
    _taskSchedule.value = new Map(_taskSchedule.value).set(taskId, { ...existing, scheduled_at: isoDatetime })
    task.scheduled_at = isoDatetime
    task.description = _buildTaskDescription(task)
  }

  async function clearScheduledTime(taskId) {
    const task = tasks.value.find(t => t.id === taskId)
    if (!task) return
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('task_schedule').delete().eq('user_id', user.id).eq('task_id', taskId)
    const newMap = new Map(_taskSchedule.value)
    newMap.delete(taskId)
    _taskSchedule.value = newMap
    task.scheduled_at = null
    task.caldav_event_uid = null
    task.caldav_calendar_id = null
    task.description = _buildTaskDescription(task)
  }

  async function updateTaskTriage(taskId, { priority, labels: newLabels, dueDate, description, content }) {
    const task = tasks.value.find(t => t.id === taskId)
    const updates = {}
    if (priority !== undefined) updates.priority = priority
    if (newLabels !== undefined) updates.labels = newLabels
    if (content !== undefined) updates.content = content
    if (dueDate !== undefined) updates.due_date = dueDate || null
    if (description !== undefined) {
      // Strip managed annotation lines — they live in DB columns, not the description field
      const userLines = description
        .split('\n')
        .filter(l => !l.startsWith('📅 Scheduled:') && !l.startsWith('📅 GCal:'))
      updates.description = userLines.join('\n').trim()
    }

    const { error } = await supabase.from('tasks').update(updates).eq('id', taskId)
    if (error) throw new Error(error.message)

    if (task) {
      if (priority !== undefined) task.priority = priority
      if (newLabels !== undefined) task.labels = newLabels
      if (content !== undefined) task.content = content
      if (dueDate !== undefined) task.due = dueDate ? { date: dueDate } : null
      if (description !== undefined) {
        task.description = _buildTaskDescription({ ...task, description: updates.description })
      }
      if (content !== undefined || newLabels !== undefined || description !== undefined) {
        const calStore = useCalendarStore()
        if (calStore.isConnected) {
          const projectName = projects.value.find(p => p.id === task.project_id)?.name ?? ''
          calStore.syncEventForTask(task, projectName).catch(() => {})
        }
      }
    }
  }

  return {
    token, stages, projects, tasks, loading, lastUpdated, cardDragging,
    triageTaskIds, triageCurrentId, pendingScheduleTask, labels,
    activeFilter, stageLabels, displayProjects, inboxProjectId,
    excludedSectionIds, deadlineSectionIds, allCollaborators, allVenues, allPeople, setupStatus, myPeopleId,
    initStages, saveToken, saveStages, resetToken, loadData, loadIfStale,
    projectStage, projectStatusTask, projectMeta, projectTasks, privateProjectTasks,
    completedProjectTasks, completedProjectTaskCount, fetchCompletedTasks, fetchCompletedCount, projectDeadline,
    moveStage, completeTask, uncompleteTask, deleteTask, reorderTasks, unPrivatizeTask, quickAddTask, updateTaskContent, updateTaskDue,
    completedInboxTasks,
    saveGCalEvent, saveScheduledTime, clearScheduledTime, updateStatusText,
    updateVenue, setDeadlineDate, addCollaborator, removeCollaborator, renameProject,
    projectDeadlineTaskBase, projectDeadlineTaskObj,
    projectSummaryTask, updateSummary, projectSubmissionTask, updateSubmissionUrl,
    updateTaskTriage, createProject, deleteProject, setFilter,
    focusProjectIds, projectEnergy, cycleEnergy,
    addInboxTask, assignTaskToProject,
    loadPendingCollaborators, claimInvite, loadMyProfile, saveMyDisplayName, savePersonEmail, sendInviteEmail,
    applyRealtimeTask, applyRealtimeProject, applyRealtimeMember,
  }
})
