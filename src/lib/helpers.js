export function parseTaskContent(text) {
  const segments = []
  const re = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g
  let last = 0, m, i = 0
  while ((m = re.exec(text ?? '')) !== null) {
    if (m.index > last) segments.push({ i: i++, text: text.slice(last, m.index) })
    segments.push({ i: i++, text: m[1], href: m[2] })
    last = m.index + m[0].length
  }
  if (last < (text ?? '').length) segments.push({ i: i++, text: text.slice(last) })
  return segments
}

export const DEFAULT_STAGES = [
  { name: 'Planning',         icon: 'potted-plant' },
  { name: 'Data Collection',  icon: 'flask' },
  { name: 'Preparing',        icon: 'pencil-line' },
  { name: 'Revision',         icon: 'eraser' },
  { name: 'Awaiting Reviews', icon: 'paper-plane-tilt' },
  { name: 'On Ice',           icon: 'snowflake' },
]

export function getStageIcon(stage) {
  return stage?.icon || 'kanban'
}

export const VENUES = ['ccs', 'usenix', 'ndss', 's&p', 'soups', 'chi', 'cscw', 'pets', 'popets']

export function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function stripPersonPrefix(l) {
  if (l.startsWith('person::')) return l.slice(8)
  if (l.startsWith('@person::')) return l.slice(9)
  return l
}

export function isPersonLabel(l) {
  return l.startsWith('person::') || l.startsWith('@person::')
}

export function getProjectStage(tasks, stageLabels, projectId) {
  const stageLabelSet = new Set(stageLabels)
  for (const t of tasks) {
    if (t.project_id !== projectId) continue
    const sl = (t.labels || []).find(l => stageLabelSet.has(l))
    if (sl) return { task: t, label: sl }
  }
  return null
}

export function getProjectMeta(tasks, projectId) {
  let venue = null, author = null
  for (const t of tasks) {
    if (t.project_id !== projectId) continue
    const n = t.content.toLowerCase()
    for (const v of VENUES) {
      if (n.includes(v)) { venue = v.toUpperCase(); break }
    }
    if (n.startsWith('author:') || n.startsWith('first author:')) {
      author = t.content.split(':')[1].trim().split(' ')[0]
    }
    for (const l of (t.labels || [])) {
      for (const v of VENUES) {
        if (l.toLowerCase() === v) { venue = v.toUpperCase(); break }
      }
    }
  }
  return { venue, author }
}

export function getProjectTasks(tasks, stageLabels, excludedSectionIds, projectId) {
  const stageLabelSet = new Set(stageLabels)
  return tasks
    .filter(t => {
      if (t.project_id !== projectId) return false
      if (t.is_completed) return false
      if ((t.labels || []).some(l => stageLabelSet.has(l))) return false
      if (excludedSectionIds.has(t.section_id)) return false
      return true
    })
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
}

export function getProjectDeadline(tasks, deadlineSectionIds, projectId) {
  const deadlineTasks = tasks.filter(
    t => t.project_id === projectId && deadlineSectionIds.has(t.section_id) && !t.is_completed && t.due
  )
  if (!deadlineTasks.length) return null
  const dates = deadlineTasks.map(t => parseLocalDate(t.due.date)).sort((a, b) => a - b)
  const future = dates.filter(d => d > Date.now())
  return future.length ? future[0] : dates[dates.length - 1]
}

export function nearestDue(tasks) {
  let nearest = null
  for (const t of tasks) {
    if (!t.due) continue
    const d = parseLocalDate(t.due.date).getTime()
    if (!nearest || d < nearest) nearest = d
  }
  return nearest
}

export function dueStatus(dateMs) {
  const diff = dateMs - Date.now()
  if (diff < 0) return 'overdue'
  if (diff < 7 * 86400000) return 'due-soon'
  return 'ok'
}

export function formatDate(dateStr) {
  if (!dateStr) return ''
  return parseLocalDate(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
