import { computed, unref } from 'vue'

function startOfDay(d) {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

function getMonday(d) {
  const day = new Date(d)
  const dow = day.getDay()
  day.setDate(day.getDate() + (dow === 0 ? -6 : 1 - dow))
  day.setHours(0, 0, 0, 0)
  return day
}

const DEFS = [
  { key: 'overdue',     label: 'Overdue' },
  { key: 'today',       label: 'Today' },
  { key: 'tomorrow',    label: 'Tomorrow' },
  { key: 'thisWeek',    label: 'Rest of week' },
  { key: 'nextWeek',    label: 'Next week' },
  { key: 'later',       label: 'Later' },
  { key: 'unscheduled', label: 'Unscheduled' },
]

// tasks: ref<Task[]> or Task[]
// getScheduledIso: (task) => ISO string | null
export function useRelativeDateGroups(tasks, getScheduledIso) {
  return computed(() => {
    const taskList = unref(tasks)
    const todayStart       = startOfDay(new Date())
    const tomorrowStart    = new Date(todayStart);    tomorrowStart.setDate(tomorrowStart.getDate() + 1)
    const dayAfterTomorrow = new Date(tomorrowStart); dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1)
    const thisWeekEnd      = getMonday(todayStart);   thisWeekEnd.setDate(thisWeekEnd.getDate() + 7)
    const nextWeekEnd      = new Date(thisWeekEnd);   nextWeekEnd.setDate(nextWeekEnd.getDate() + 7)

    const buckets = { overdue: [], today: [], tomorrow: [], thisWeek: [], nextWeek: [], later: [], unscheduled: [] }

    for (const task of taskList) {
      const iso = getScheduledIso(task)
      if (!iso) { buckets.unscheduled.push({ task, t: Infinity }); continue }
      const d = new Date(iso)
      const day = startOfDay(d)
      if (day < todayStart)                                buckets.overdue.push({ task, t: d.getTime() })
      else if (day.getTime() === todayStart.getTime())     buckets.today.push({ task, t: d.getTime() })
      else if (day.getTime() === tomorrowStart.getTime())  buckets.tomorrow.push({ task, t: d.getTime() })
      else if (day >= dayAfterTomorrow && day < thisWeekEnd) buckets.thisWeek.push({ task, t: d.getTime() })
      else if (day >= thisWeekEnd && day < nextWeekEnd)    buckets.nextWeek.push({ task, t: d.getTime() })
      else if (day >= nextWeekEnd)                         buckets.later.push({ task, t: d.getTime() })
      else                                                 buckets.unscheduled.push({ task, t: d.getTime() })
    }

    for (const key of Object.keys(buckets)) buckets[key].sort((a, b) => a.t - b.t)

    return DEFS
      .filter(d => buckets[d.key].length > 0)
      .map(d => ({ key: d.key, label: d.label, tasks: buckets[d.key].map(e => e.task) }))
  })
}
