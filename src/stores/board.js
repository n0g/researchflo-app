import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api, apiAll, syncCommands } from '../lib/todoist.js'
import { useCalendarStore } from './calendar.js'
import {
  DEFAULT_STAGES,
  VENUES,
  getProjectStage,
  getProjectMeta,
  getProjectTasks,
  getProjectDeadline,
  parseLocalDate,
  stripPersonPrefix,
  isPersonLabel,
} from '../lib/helpers.js'

export const useBoardStore = defineStore('board', () => {
  const token = ref(localStorage.getItem('rb_token'))
  const stages = ref(JSON.parse(localStorage.getItem('rb_stages') || 'null'))
  const projects = ref([])
  const tasks = ref([])
  const excludedSectionIds = ref(new Set())
  const deadlineSectionIds = ref(new Set())
  const statusSectionIds = ref(new Set())
  const deadlineSectionByProject = ref(new Map())
  const summarySectionByProject = ref(new Map())
  const submissionSectionByProject = ref(new Map())
  const lastUpdated = ref(null)
  const loading = ref(false)
  const setupStatus = ref('')
  const cardDragging = ref(false)
  const triageTaskIds = ref([])
  const triageCurrentId = ref(null)
  const pendingScheduleTask = ref(null)
  const labels = ref([])
  const activeFilter = ref(null) // { type: 'person'|'venue', value: string } | null

  const stageLabels = computed(() => (stages.value || []).map(s => s.label))

  const displayProjects = computed(() => {
    const root = projects.value.find(p => !p.parent_id && p.name === 'Research')
    return root ? projects.value.filter(p => p.parent_id === root.id) : projects.value
  })

  const inboxProjectId = computed(() =>
    projects.value.find(p => p.is_inbox_project || p.inbox_project || (!p.parent_id && p.name === 'Inbox'))?.id ?? null
  )

  const allCollaborators = computed(() => {
    const stageSet = new Set(stageLabels.value)
    const venueSet = new Set(VENUES)
    const people = new Set()
    displayProjects.value.forEach(p => {
      const stage = getProjectStage(tasks.value, stageLabels.value, p.id)
      if (stage) {
        (stage.task.labels || [])
          .filter(l => !stageSet.has(l) && !venueSet.has(l.toLowerCase()) && isPersonLabel(l))
          .forEach(l => people.add(stripPersonPrefix(l)))
      }
    })
    return [...people].sort()
  })

  const allVenues = computed(() => {
    const venues = new Set()
    displayProjects.value.forEach(p => {
      const sectionId = deadlineSectionByProject.value.get(p.id)
      const dt = sectionId ? tasks.value.find(t => t.project_id === p.id && t.section_id === sectionId && !t.is_completed) : null
      if (dt?.content) venues.add(dt.content)
    })
    return [...venues].sort()
  })

  function setFilter(type, value) {
    if (activeFilter.value?.type === type && activeFilter.value?.value === value) {
      activeFilter.value = null
    } else {
      activeFilter.value = { type, value }
    }
  }

  function initStages() {
    if (!stages.value) {
      stages.value = DEFAULT_STAGES
      localStorage.setItem('rb_stages', JSON.stringify(DEFAULT_STAGES))
    } else {
      // Migrate: ensure Revision comes before Awaiting Reviews
      const ri = stages.value.findIndex(s => s.label === 'stage::revision')
      const ai = stages.value.findIndex(s => s.label === 'stage::under-submission')
      if (ri !== -1 && ai !== -1 && ri > ai) {
        stages.value.splice(ai, 0, stages.value.splice(ri, 1)[0])
        localStorage.setItem('rb_stages', JSON.stringify(stages.value))
      }
    }
  }

  async function runSetup(tokenVal) {
    setupStatus.value = 'Checking Todoist structure…'
    const allProjects = await apiAll(tokenVal, '/projects')

    let research = allProjects.find(p => !p.parent_id && p.name === 'Research')
    if (!research) {
      setupStatus.value = 'Creating Research project…'
      research = await api(tokenVal, '/projects', 'POST', { name: 'Research' })
    }

    const hasSettings = allProjects.some(p => !p.parent_id && p.name === 'Settings')
    if (!hasSettings) {
      setupStatus.value = 'Creating Settings project…'
      await api(tokenVal, '/projects', 'POST', { name: 'Settings' })
    }

    const subProjects = allProjects.filter(p => p.parent_id === research.id)
    if (subProjects.length) {
      setupStatus.value = 'Checking project sections…'
      const allSections = await apiAll(tokenVal, '/sections')
      const REQUIRED = ['📌 Current Status', '📌 Deadlines', '📌 Summary', '📌 Submission']
      await Promise.all(subProjects.map(async project => {
        const existing = new Set(allSections.filter(s => s.project_id === project.id).map(s => s.name))
        await Promise.all(
          REQUIRED
            .filter(name => !existing.has(name))
            .map(name => api(tokenVal, '/sections', 'POST', { name, project_id: project.id }))
        )
      }))
    }

    setupStatus.value = ''
  }

  async function saveToken(val) {
    await api(val, '/projects')
    await runSetup(val)
    token.value = val
    localStorage.setItem('rb_token', val)
    if (!stages.value) {
      stages.value = DEFAULT_STAGES
      localStorage.setItem('rb_stages', JSON.stringify(DEFAULT_STAGES))
    }
  }

  function saveStages(newStages) {
    stages.value = newStages
    localStorage.setItem('rb_stages', JSON.stringify(newStages))
  }

  function resetToken() {
    localStorage.removeItem('rb_token')
    localStorage.removeItem('rb_stages')
    token.value = null
    stages.value = null
  }

  async function loadIfStale() {
    const TEN_MIN = 10 * 60 * 1000
    if (!lastUpdated.value || Date.now() - lastUpdated.value.getTime() > TEN_MIN) {
      await loadData()
    }
  }

  async function loadData() {
    loading.value = true
    try {
      const [projectsData, tasksData, sectionsData] = await Promise.all([
        apiAll(token.value, '/projects'),
        apiAll(token.value, '/tasks'),
        apiAll(token.value, '/sections'),
      ])
      projects.value = projectsData
      tasks.value = tasksData
      const EXCLUDED = new Set(['📌 Current Status', '📌 Deadlines', '📌 Summary', '📌 Submission'])
      excludedSectionIds.value = new Set(sectionsData.filter(s => EXCLUDED.has(s.name)).map(s => s.id))
      deadlineSectionIds.value = new Set(sectionsData.filter(s => s.name === '📌 Deadlines').map(s => s.id))
      statusSectionIds.value = new Set(sectionsData.filter(s => s.name === '📌 Current Status').map(s => s.id))
      const deadlineMap = new Map()
      sectionsData.filter(s => s.name === '📌 Deadlines').forEach(s => deadlineMap.set(s.project_id, s.id))
      deadlineSectionByProject.value = deadlineMap
      const summaryMap = new Map()
      sectionsData.filter(s => s.name === '📌 Summary').forEach(s => summaryMap.set(s.project_id, s.id))
      summarySectionByProject.value = summaryMap
      const submissionMap = new Map()
      sectionsData.filter(s => s.name === '📌 Submission').forEach(s => submissionMap.set(s.project_id, s.id))
      submissionSectionByProject.value = submissionMap
      lastUpdated.value = new Date()
    } finally {
      loading.value = false
    }
  }

  const FOCUS_LABEL = 'sprint::focus'
  const ENERGY_LOW  = 'sprint::energy-1'
  const ENERGY_HIGH = 'sprint::energy-2'

  function projectEnergy(projectId) {
    const stage = getProjectStage(tasks.value, stageLabels.value, projectId)
    if (!stage) return 0
    const labels = stage.task.labels || []
    if (labels.includes(ENERGY_HIGH)) return 2
    if (labels.includes(ENERGY_LOW))  return 1
    return 0
  }

  const focusProjectIds = computed(() => {
    const ids = new Set()
    for (const p of displayProjects.value) {
      if (projectEnergy(p.id) > 0) ids.add(p.id)
    }
    return ids
  })

  async function cycleEnergy(projectId) {
    const stage = getProjectStage(tasks.value, stageLabels.value, projectId)
    if (!stage) return
    const task = stage.task
    const labels = task.labels || []
    const current = labels.includes(ENERGY_HIGH) ? 2 : labels.includes(ENERGY_LOW) ? 1 : 0
    const next = (current + 1) % 3
    const newLabels = labels.filter(l => l !== ENERGY_LOW && l !== ENERGY_HIGH && l !== FOCUS_LABEL)
    if (next === 1) newLabels.push(ENERGY_LOW)
    if (next === 2) newLabels.push(ENERGY_HIGH)
    task.labels = newLabels
    await api(token.value, `/tasks/${task.id}`, 'POST', { labels: newLabels })
  }

  function projectStage(projectId) {
    return getProjectStage(tasks.value, stageLabels.value, projectId)
  }

  function projectStatusTask(projectId) {
    return tasks.value.find(t => t.project_id === projectId && statusSectionIds.value.has(t.section_id) && !t.is_completed) ?? null
  }

  function projectDeadlineTaskBase(projectId) {
    const sectionId = deadlineSectionByProject.value.get(projectId)
    if (!sectionId) return null
    return tasks.value.find(t => t.project_id === projectId && t.section_id === sectionId && !t.is_completed) ?? null
  }

  function projectMeta(projectId) {
    const meta = getProjectMeta(tasks.value, projectId)
    const dt = projectDeadlineTaskBase(projectId)
    if (dt) meta.venue = dt.content
    return meta
  }

  function projectTasks(projectId) {
    return getProjectTasks(tasks.value, stageLabels.value, excludedSectionIds.value, projectId)
  }

  function projectDeadline(projectId) {
    return getProjectDeadline(tasks.value, deadlineSectionIds.value, projectId)
  }

  async function moveStage(projectId, oldTaskId, oldLabel, newLabel) {
    if (oldLabel === newLabel) return
    const taskId = oldTaskId || projectStatusTask(projectId)?.id
    if (!taskId) throw new Error('No stage task found for this project.')
    const task = tasks.value.find(t => t.id === taskId)
    if (task) {
      const newLabels = (task.labels || []).filter(l => l !== oldLabel).concat(newLabel)
      await api(token.value, `/tasks/${taskId}`, 'POST', { labels: newLabels })
      task.labels = newLabels
    }
  }

  async function completeTask(taskId) {
    await api(token.value, `/tasks/${taskId}/close`, 'POST')
    tasks.value = tasks.value.filter(t => t.id !== taskId)
  }

  async function deleteTask(taskId) {
    const task = tasks.value.find(t => t.id === taskId)
    if (task) {
      const gcalLine = (task.description || '').split('\n').find(l => l.startsWith('📅 GCal:'))
      if (gcalLine) {
        const parts = gcalLine.slice('📅 GCal: '.length).split('|')
        if (parts.length === 2) {
          const { useCalendarStore } = await import('./calendar.js')
          useCalendarStore().unlinkTaskFromEvent(parts[0], parts[1]).catch(console.error)
        }
      }
    }
    await api(token.value, `/tasks/${taskId}`, 'DELETE')
    tasks.value = tasks.value.filter(t => t.id !== taskId)
  }

  async function reorderTasks(orderedTaskIds) {
    orderedTaskIds.forEach((id, idx) => {
      const task = tasks.value.find(t => t.id === id)
      if (task) task.order = idx + 1
    })
    await syncCommands(token.value, [{
      type: 'item_reorder',
      uuid: crypto.randomUUID(),
      args: { items: orderedTaskIds.map((id, idx) => ({ id, child_order: idx + 1 })) },
    }])
  }

  async function quickAddTask(content, projectId) {
    const task = await api(token.value, '/tasks', 'POST', { content, project_id: projectId })
    tasks.value.push(task)
  }

  async function addInboxTask(content, description) {
    const task = await api(token.value, '/tasks', 'POST', { content })
    if (description) {
      await api(token.value, `/tasks/${task.id}`, 'POST', { description })
      task.description = description
    }
    tasks.value.push(task)
    return task
  }

  async function assignTaskToProject(taskId, projectId) {
    await api(token.value, `/tasks/${taskId}`, 'POST', { project_id: projectId })
    const task = tasks.value.find(t => t.id === taskId)
    if (task) task.project_id = projectId
  }

  async function updateTaskDue(taskId, dateVal) {
    const body = dateVal ? { due_date: dateVal } : { due_string: 'no due date' }
    await api(token.value, `/tasks/${taskId}`, 'POST', body)
    const task = tasks.value.find(t => t.id === taskId)
    if (task) task.due = dateVal ? { date: dateVal } : null
  }

  async function saveGCalEvent(taskId, eventId, calId) {
    const task = tasks.value.find(t => t.id === taskId)
    if (!task) return
    const gcalLine = `📅 GCal: ${eventId}|${calId}`
    const filtered = (task.description || '').split('\n').filter(l => !l.startsWith('📅 GCal:'))
    const trimmed = filtered.join('\n').trimEnd()
    const newDesc = trimmed ? `${trimmed}\n${gcalLine}` : gcalLine
    await api(token.value, `/tasks/${taskId}`, 'POST', { description: newDesc })
    task.description = newDesc
  }

  async function saveScheduledTime(taskId, isoDatetime) {
    const task = tasks.value.find(t => t.id === taskId)
    if (!task) return
    const d = new Date(isoDatetime)
    const readable = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) +
      ' at ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    const scheduledLine = `📅 Scheduled: ${readable} (${isoDatetime})`
    const filtered = (task.description || '').split('\n').filter(l => !l.startsWith('📅 Scheduled:'))
    const trimmed = filtered.join('\n').trimEnd()
    const newDesc = trimmed ? `${trimmed}\n${scheduledLine}` : scheduledLine
    const labels = [...(task.labels || [])]
    if (!labels.includes('scheduled')) labels.push('scheduled')
    await api(token.value, `/tasks/${taskId}`, 'POST', { description: newDesc, labels })
    task.description = newDesc
    task.labels = labels
  }

  async function clearScheduledTime(taskId) {
    const task = tasks.value.find(t => t.id === taskId)
    if (!task) return
    const filtered = (task.description || '').split('\n')
      .filter(l => !l.startsWith('📅 Scheduled:') && !l.startsWith('📅 GCal:'))
    const newDesc = filtered.join('\n').trim()
    const newLabels = (task.labels || []).filter(l => l !== 'scheduled')
    await api(token.value, `/tasks/${taskId}`, 'POST', { description: newDesc, labels: newLabels })
    task.description = newDesc
    task.labels = newLabels
  }

  async function updateStatusText(taskId, content) {
    await api(token.value, `/tasks/${taskId}`, 'POST', { content })
    const task = tasks.value.find(t => t.id === taskId)
    if (task) task.content = content
  }

  async function renameProject(projectId, name) {
    await api(token.value, `/projects/${projectId}`, 'POST', { name })
    const project = projects.value.find(p => p.id === projectId)
    if (project) project.name = name
  }

  async function addCollaborator(projectId, name) {
    const stageInfo = getProjectStage(tasks.value, stageLabels.value, projectId)
    if (!stageInfo) return
    const task = stageInfo.task
    const label = `person::${name}`
    const newLabels = [...(task.labels || []), label]
    await api(token.value, `/tasks/${task.id}`, 'POST', { labels: newLabels })
    task.labels = newLabels
  }

  async function removeCollaborator(projectId, name) {
    const stageInfo = getProjectStage(tasks.value, stageLabels.value, projectId)
    if (!stageInfo) return
    const task = stageInfo.task
    const newLabels = (task.labels || []).filter(l => stripPersonPrefix(l) !== name)
    await api(token.value, `/tasks/${task.id}`, 'POST', { labels: newLabels })
    task.labels = newLabels
  }

  async function updateVenue(projectId, name) {
    const existing = projectDeadlineTaskBase(projectId)
    if (!name) return
    if (existing) {
      if (name === existing.content) return
      await api(token.value, `/tasks/${existing.id}`, 'POST', { content: name })
      existing.content = name
    } else {
      const sectionId = deadlineSectionByProject.value.get(projectId)
      if (!sectionId) return
      const task = await api(token.value, '/tasks', 'POST', { content: name, project_id: projectId, section_id: sectionId })
      tasks.value.push(task)
    }
  }

  async function setDeadlineDate(projectId, dateVal) {
    let task = projectDeadlineTaskBase(projectId)
    if (!task) {
      const sectionId = deadlineSectionByProject.value.get(projectId)
      if (!sectionId) return
      const project = projects.value.find(p => p.id === projectId)
      task = await api(token.value, '/tasks', 'POST', {
        content: project?.name || 'Deadline',
        project_id: projectId,
        section_id: sectionId,
      })
      tasks.value.push(task)
    }
    const body = dateVal ? { due_date: dateVal } : { due_string: 'no due date' }
    await api(token.value, `/tasks/${task.id}`, 'POST', body)
    task.due = dateVal ? { date: dateVal } : null
  }

  function projectSummaryTask(projectId) {
    const sectionId = summarySectionByProject.value.get(projectId)
    if (!sectionId) return null
    return tasks.value.find(t => t.project_id === projectId && t.section_id === sectionId && !t.is_completed) ?? null
  }

  async function updateSummary(projectId, text) {
    const existing = projectSummaryTask(projectId)
    if (!text) return
    if (existing) {
      if (text === existing.content) return
      await api(token.value, `/tasks/${existing.id}`, 'POST', { content: text })
      existing.content = text
    } else {
      const sectionId = summarySectionByProject.value.get(projectId)
      if (!sectionId) return
      const task = await api(token.value, '/tasks', 'POST', { content: text, project_id: projectId, section_id: sectionId })
      tasks.value.push(task)
    }
  }

  function projectSubmissionTask(projectId) {
    const sectionId = submissionSectionByProject.value.get(projectId)
    if (!sectionId) return null
    return tasks.value.find(t => t.project_id === projectId && t.section_id === sectionId && !t.is_completed) ?? null
  }

  async function updateSubmissionUrl(projectId, url) {
    const existing = projectSubmissionTask(projectId)
    if (!url) {
      if (existing) {
        await api(token.value, `/tasks/${existing.id}`, 'POST', { content: ' ' })
        existing.content = ' '
      }
      return
    }
    if (existing) {
      if (url === existing.content) return
      await api(token.value, `/tasks/${existing.id}`, 'POST', { content: url })
      existing.content = url
    } else {
      const sectionId = submissionSectionByProject.value.get(projectId)
      if (!sectionId) return
      const task = await api(token.value, '/tasks', 'POST', { content: url, project_id: projectId, section_id: sectionId })
      tasks.value.push(task)
    }
  }

  async function updateTaskTriage(taskId, { priority, labels, dueDate, description, content }) {
    const body = {}
    if (priority !== undefined) body.priority = priority
    if (labels !== undefined) body.labels = labels
    if (description !== undefined) {
      // Preserve managed lines — scheduler and calendar event ID, not edited by the user
      const task = tasks.value.find(t => t.id === taskId)
      const managedLines = task
        ? (task.description || '').split('\n').filter(l => l.startsWith('📅 Scheduled:') || l.startsWith('📅 GCal:'))
        : []
      const userLines = description.split('\n').filter(l => !l.startsWith('📅 Scheduled:') && !l.startsWith('📅 GCal:'))
      const trimmed = userLines.join('\n').trimEnd()
      body.description = managedLines.length ? (trimmed ? `${trimmed}\n${managedLines.join('\n')}` : managedLines.join('\n')) : description
    }
    if (content !== undefined) {
      body.content = content
    }
    if (dueDate !== undefined) {
      if (dueDate) body.due_date = dueDate
      else body.due_string = 'no due date'
    }
    await api(token.value, `/tasks/${taskId}`, 'POST', body)
    const task = tasks.value.find(t => t.id === taskId)
    if (task) {
      if (priority !== undefined) task.priority = priority
      if (labels !== undefined) task.labels = labels
      if (description !== undefined) task.description = body.description
      if (content !== undefined) task.content = content
      if (dueDate !== undefined) task.due = dueDate ? { date: dueDate } : null
      if (content !== undefined || labels !== undefined || description !== undefined) {
        const calStore = useCalendarStore()
        if (calStore.isConnected) {
          const projectName = projects.value.find(p => p.id === task.project_id)?.name ?? ''
          calStore.syncEventForTask(task, projectName).catch(() => {})
        }
      }
    }
  }

  async function deleteProject(projectId) {
    await api(token.value, `/projects/${projectId}`, 'DELETE')
    projects.value = projects.value.filter(p => p.id !== projectId)
    tasks.value = tasks.value.filter(t => t.project_id !== projectId)
  }

  async function createProject(name) {
    const root = projects.value.find(p => !p.parent_id && p.name === 'Research')
    if (!root) throw new Error('Research project not found')

    const project = await api(token.value, '/projects', 'POST', { name, parent_id: root.id })

    const [statusSection, deadlinesSection, summarySection, submissionSection] = await Promise.all([
      api(token.value, '/sections', 'POST', { name: '📌 Current Status', project_id: project.id }),
      api(token.value, '/sections', 'POST', { name: '📌 Deadlines', project_id: project.id }),
      api(token.value, '/sections', 'POST', { name: '📌 Summary', project_id: project.id }),
      api(token.value, '/sections', 'POST', { name: '📌 Submission', project_id: project.id }),
    ])

    const defaultLabel = stages.value?.[0]?.label || 'stage::planning'
    const statusTask = await api(token.value, '/tasks', 'POST', {
      content: name,
      project_id: project.id,
      section_id: statusSection.id,
      labels: [defaultLabel],
    })

    projects.value.push(project)
    tasks.value.push(statusTask)
    excludedSectionIds.value = new Set([...excludedSectionIds.value, statusSection.id, deadlinesSection.id, summarySection.id, submissionSection.id])
    deadlineSectionIds.value = new Set([...deadlineSectionIds.value, deadlinesSection.id])
    statusSectionIds.value = new Set([...statusSectionIds.value, statusSection.id])
    const dm = new Map(deadlineSectionByProject.value)
    dm.set(project.id, deadlinesSection.id)
    deadlineSectionByProject.value = dm
    const sm = new Map(summarySectionByProject.value)
    sm.set(project.id, summarySection.id)
    summarySectionByProject.value = sm
    const sbm = new Map(submissionSectionByProject.value)
    sbm.set(project.id, submissionSection.id)
    submissionSectionByProject.value = sbm

    return project
  }

  function projectDeadlineTaskObj(projectId) {
    const candidates = tasks.value.filter(
      t => t.project_id === projectId && deadlineSectionIds.value.has(t.section_id) && !t.is_completed && t.due
    )
    if (!candidates.length) return null
    const future = candidates.filter(t => parseLocalDate(t.due.date) > new Date())
    return future.length
      ? future.sort((a, b) => new Date(a.due.date) - new Date(b.due.date))[0]
      : candidates.sort((a, b) => new Date(b.due.date) - new Date(a.due.date))[0]
  }

  return {
    token, stages, projects, tasks, loading, lastUpdated, cardDragging, triageTaskIds, triageCurrentId, pendingScheduleTask, labels,
    activeFilter, stageLabels, displayProjects, inboxProjectId, excludedSectionIds, deadlineSectionIds,
    allCollaborators, allVenues,
    setupStatus,
    initStages, saveToken, saveStages, resetToken, loadData, loadIfStale,
    projectStage, projectStatusTask, projectMeta, projectTasks, projectDeadline,
    moveStage, completeTask, deleteTask, reorderTasks, quickAddTask, updateTaskDue, saveGCalEvent, saveScheduledTime, clearScheduledTime, updateStatusText,
    updateVenue, setDeadlineDate, addCollaborator, removeCollaborator, renameProject,
    projectDeadlineTaskBase, projectDeadlineTaskObj,
    projectSummaryTask, updateSummary, projectSubmissionTask, updateSubmissionUrl,
    updateTaskTriage, createProject, deleteProject, setFilter,
    focusProjectIds, projectEnergy, cycleEnergy,
    addInboxTask, assignTaskToProject,
  }
})
