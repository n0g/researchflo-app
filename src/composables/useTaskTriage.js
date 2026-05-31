function minutesToLabel(m) {
  if (!m) return null
  if (m <= 15) return '15m'
  if (m <= 30) return '30m'
  if (m <= 60) return '1h'
  if (m <= 120) return '2h'
  return null
}

export function getUrgencyLabel(task) {
  if (!task) return null
  const p = task.priority ?? 1
  if (p === 4) return 'Urgent'
  if (p === 3) return 'High'
  if (p === 2) return 'Med'
  return null
}

export function getImportance() {
  return null
}

export function getTime(task) {
  return minutesToLabel(task?.estimated_time)
}
