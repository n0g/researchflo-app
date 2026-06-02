<template>
  <f7-page name="schedule" class="schedule-page" no-swipeback>
    <div class="schedule-screen">
      <AppSidebar current-page="schedule">
        <template #filters>
          <template v-if="projectsWithTasks.length">
            <button class="sidebar-section-header" :aria-expanded="projectsOpen" @click="projectsOpen = !projectsOpen">
              <span class="sidebar-section-label">Projects</span>
              <i class="ph ph-caret-down sidebar-section-chevron" :class="{ open: projectsOpen }" aria-hidden="true"></i>
            </button>
            <template v-if="projectsOpen">
              <button
                v-for="project in projectsWithTasks"
                :key="project.id"
                class="sidebar-nav-item"
                :class="{ 'sidebar-filter-active': activeProjectId === project.id }"
                :title="project.name"
                @click="toggleProject(project.id)"
              >
                <i :class="activeProjectId === project.id ? 'ph ph-folder-open' : 'ph ph-folder'" aria-hidden="true"></i>
                <span class="sidebar-label">{{ project.name }}</span>
              </button>
            </template>
          </template>
          <template v-if="store.allHashtags.length">
            <button class="sidebar-section-header" :aria-expanded="tagsOpen" @click="tagsOpen = !tagsOpen">
              <span class="sidebar-section-label">Tags</span>
              <i class="ph ph-caret-down sidebar-section-chevron" :class="{ open: tagsOpen }" aria-hidden="true"></i>
            </button>
            <template v-if="tagsOpen">
              <button
                v-for="tag in store.allHashtags"
                :key="tag"
                class="sidebar-nav-item"
                :class="{ 'sidebar-filter-active': activeHashtag === tag }"
                @click="toggleHashtag(tag)"
              >
                <span class="sidebar-hashtag">#</span>
                <span class="sidebar-label">{{ tag }}</span>
              </button>
            </template>
          </template>
        </template>
      </AppSidebar>

      <div class="schedule-main">
        <button
          v-if="sidebarCollapsed"
          class="sidebar-expand-btn"
          title="Expand sidebar"
          aria-label="Expand sidebar"
          @click="toggleSidebar"
        >
          <i class="ph ph-sidebar-simple" aria-hidden="true"></i>
        </button>

        <!-- Left: task list -->
        <div class="schedule-list" :class="{ 'schedule-list-collapsed': sidebarCollapsed }">
          <div class="filter-tabs">
            <div class="seg-ctrl" role="tablist" aria-label="Task filter">
              <button
                v-for="t in TABS"
                :key="t.key"
                class="seg-btn"
                role="tab"
                :aria-selected="tab === t.key"
                :class="{ active: tab === t.key }"
                @click="tab = t.key"
              >{{ t.label }}</button>
            </div>
          </div>
          <div ref="taskListBodyEl" class="triage-list-body" role="listbox" aria-label="Tasks">
            <div v-if="!calStore.isAnyCalendarConnected && !calStore.initializing" class="cal-mobile-notice">
              <i class="ph ph-calendar" aria-hidden="true"></i>
              <span>{{ calStore.clientId ? 'Calendar session expired' : 'Connect Google Calendar to schedule tasks' }}</span>
              <button class="btn sm primary" @click="calStore.clientId ? calStore.connect() : goSettings()">
                {{ calStore.clientId ? 'Reconnect' : 'Settings' }}
              </button>
            </div>
            <template v-if="calStore.initializing">
              <div v-for="i in 5" :key="i" class="schedule-skeleton-row"></div>
            </template>
            <div v-else-if="!taskGroups.length" class="triage-empty-list">No tasks</div>
            <template v-for="group in taskGroups" :key="group.key">
              <div class="schedule-group-sep">
                <span class="schedule-group-label">{{ group.label }}</span>
                <div class="schedule-group-line"></div>
              </div>
              <div
                v-for="task in group.tasks"
                :key="task.id"
                class="triage-task-row schedule-task-row"
                :class="{ 'schedule-task-dragging': draggingTask?.id === task.id, 'schedule-task-has-check': group.key === 'today' || group.key === 'overdue' }"
                tabindex="0"
                @pointerdown="onTaskPointerDown($event, task)"
                @touchstart.passive="onTaskTouchStart"
                @touchend="onTaskTouchEnd($event, task)"
                @keydown.enter.prevent="scheduleTaskByKey(task)"
                @keydown.space.prevent="scheduleTaskByKey(task)"
                @keydown.down.prevent.stop="focusTaskRow(taskFlatIndex.get(task.id) + 1)"
                @keydown.up.prevent.stop="focusTaskRow(taskFlatIndex.get(task.id) - 1)"
              >
                <button
                  v-if="group.key === 'today' || group.key === 'overdue'"
                  class="task-check schedule-task-check"
                  title="Mark complete"
                  @pointerdown.stop
                  @touchstart.stop.passive
                  @touchend.stop
                  @click.stop="store.completeTask(task.id)"
                ></button>
                <div class="schedule-task-content">
                  <div class="triage-task-project">{{ projectName(task) }}</div>
                  <div class="triage-task-title">
                    <template v-for="seg in parseTaskContent(task.content)" :key="seg.i">
                      <a v-if="seg.href" :href="seg.href" target="_blank" rel="noopener noreferrer" class="task-link" @click.stop>{{ seg.text }}</a>
                      <template v-else>{{ seg.text }}</template>
                    </template>
                  </div>
                  <div class="triage-task-meta">
                    <div class="triage-task-tags">
                      <span v-if="getUrgencyLabel(task)" class="triage-tag">
                        <i class="ph ph-lightning" aria-hidden="true"></i>{{ getUrgencyLabel(task) }}
                      </span>
                      <span v-if="getImportance(task)" class="triage-tag">
                        <i class="ph ph-star" aria-hidden="true"></i>{{ getImportance(task) }}
                      </span>
                      <span v-if="getTime(task)" class="triage-tag triage-tag-dim">{{ getTime(task) }}</span>
                      <span v-if="dueDateLabel(task)" class="triage-tag schedule-due-tag" :class="{ 'schedule-due-urgent': task.due && Math.round((new Date(task.due.date + 'T00:00:00') - new Date().setHours(0,0,0,0)) / 86400000) <= 1 }">
                        <i class="ph ph-calendar-check" aria-hidden="true"></i>{{ dueDateLabel(task) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>
          <div class="sched-search-pill" :class="{ expanded: searchExpanded || searchQuery }">
            <button class="sched-search-btn" aria-label="Search tasks" @click="expandSearch">
              <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
            </button>
            <input
              ref="searchInputEl"
              v-model="searchQuery"
              class="sched-search-input"
              type="search"
              placeholder="Search…"
              @blur="onSearchBlur"
              @keydown.escape="clearSearch"
            />
            <button v-if="searchQuery" class="sched-search-clear" aria-label="Clear" @click="clearSearch">
              <i class="ph ph-x"></i>
            </button>
          </div>
          <button
            class="filter-fab"
            :class="{ active: showUnscheduled }"
            :aria-pressed="showUnscheduled"
            :aria-label="showUnscheduled ? 'Show all tasks' : 'Show unscheduled only'"
            @click="showUnscheduled = !showUnscheduled"
          >
            <i class="ph ph-funnel" aria-hidden="true"></i>
          </button>
        </div>

        <!-- Right: calendar -->
        <div class="schedule-cal">
          <template v-if="!calStore.isAnyCalendarConnected && !calStore.initializing">
            <div class="cal-not-connected">
              <i class="ph ph-calendar" aria-hidden="true"></i>
              <p>{{ calStore.clientId ? 'Session expired — reconnect to continue' : 'Connect Google Calendar to schedule tasks' }}</p>
              <p v-if="calStore.connectError" class="cal-connect-error">{{ calStore.connectError }}</p>
              <button class="btn primary" @click="calStore.clientId ? calStore.connect() : goSettings()">
                {{ calStore.clientId ? 'Reconnect' : 'Open Settings' }}
              </button>
              <button v-if="calStore.clientId" class="btn" style="margin-top: 8px" @click="goSettings">Settings</button>
            </div>
          </template>
          <template v-else>
            <!-- Week navigation -->
            <div class="cal-nav">
              <div class="cal-month-label">
                <span class="cal-month-name">{{ monthLabel.month }}</span>
                <span class="cal-month-year">{{ monthLabel.year }}</span>
              </div>
              <button class="cal-nav-btn" title="Previous week" @click="prevWeek">
                <i class="ph ph-caret-left" aria-hidden="true"></i>
              </button>
              <button class="cal-today-btn" @click="goToday">Today</button>
              <button class="cal-nav-btn" title="Next week" @click="nextWeek">
                <i class="ph ph-caret-right" aria-hidden="true"></i>
              </button>
              <span v-if="calStore.loading" class="cal-loading-dot"></span>
            </div>

            <!-- Calendar grid -->
            <div class="cal-week">
              <!-- Header: day names + dates -->
              <div class="cal-header">
                <div class="cal-gutter"></div>
                <div
                  v-for="day in weekDays"
                  :key="isoDate(day)"
                  class="cal-day-head"
                  :class="{ 'cal-today': isToday(day) }"
                >
                  <div class="cal-day-label">
                    <span class="cal-day-name">{{ dayName(day) }}</span>
                    <span class="cal-day-num">{{ day.getDate() }}</span>
                  </div>
                  <div
                    v-for="ev in allDayEvents(day)"
                    :key="ev.id"
                    class="cal-allday-bar"
                    :style="{ background: ev._calColor || 'var(--accent)' }"
                    :title="ev.summary"
                  >{{ ev.summary }}</div>
                </div>
              </div>

              <!-- Scrollable time grid -->
              <div ref="calBodyEl" class="cal-scroll">
                <div class="cal-inner">
                  <!-- Time labels -->
                  <div class="cal-time-col">
                    <div
                      v-for="slot in timeSlots"
                      :key="slot.key"
                      class="cal-time-cell"
                    >
                      <span v-if="slot.minute === 0" class="cal-time-label">{{ formatHour(slot.hour) }}</span>
                    </div>
                  </div>

                  <!-- Day columns -->
                  <div ref="calDaysEl" class="cal-days">
                    <div
                      v-if="pastDueOverlayLeft !== null"
                      class="cal-past-due-overlay"
                      :style="{ left: pastDueOverlayLeft }"
                    ></div>
                    <div
                      v-if="nowTop !== null"
                      class="cal-now-line"
                      :style="{ top: nowTop + 'px', left: nowLineLeft }"
                    >
                      <div class="cal-now-dot"></div>
                    </div>
                    <div
                      v-for="day in weekDays"
                      :key="isoDate(day)"
                      class="cal-day-col"
                      :class="{ 'cal-today': isToday(day) }"
                    >
                      <!-- Slot cells (drop targets + grid lines) -->
                      <div
                        v-for="slot in timeSlots"
                        :key="slot.key"
                        class="cal-slot"
                        :class="{
                          'cal-slot-hover': isHoveredSlot(day, slot),
                          'cal-slot-hour': slot.minute === 0,
                        }"
                        :data-date="isoDate(day)"
                        :data-hour="slot.hour"
                        :data-minute="slot.minute"
                      ></div>

                      <!-- Events -->
                      <div
                        v-for="ev in timedDayEvents(day)"
                        :key="ev.id"
                        class="cal-event"
                        :class="{
                          'cal-event-moving': draggingCalEvent?.id === ev.id,
                          'cal-event-readonly': ev._calId !== calStore.targetCalHref,
                          'cal-event-unlinked': isUnlinked(ev),
                          'cal-event-other-cal': isOtherCal(ev),
                        }"
                        :style="eventStyle(ev)"
                        draggable="false"
                        @dragstart.prevent
                        @pointerdown.stop="onCalEventPointerDown($event, ev)"
                      >
                        <div class="cal-event-title">{{ ev.summary }}</div>
                        <div v-if="eventTimeStr(ev)" class="cal-event-time">{{ eventTimeStr(ev) }}</div>
                      </div>

                      <!-- Drop preview -->
                      <div
                        v-if="dropPreviewStyle(day)"
                        class="cal-drop-preview"
                        :style="dropPreviewStyle(day)"
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>


    <!-- Calendar event import overlay -->
    <Teleport to="body">
      <div v-if="importingEvent" class="import-overlay" @click.self="importingEvent = null">
        <div class="import-sheet" role="dialog" aria-modal="true" aria-labelledby="import-title">
          <p class="import-label">Add as task</p>
          <p id="import-title" class="import-event-title">{{ importingEvent.summary }}</p>
          <p class="import-event-time">{{ importEventTimeStr(importingEvent) }}</p>
          <div class="import-actions">
            <button class="btn" @click="importingEvent = null">Cancel</button>
            <button class="btn primary" :disabled="importing" @click="importEventAsTask">
              {{ importing ? 'Adding…' : 'Add as task' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <AppTabbar current-tab="schedule" />
  </f7-page>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { f7 } from 'framework7-vue/bundle'
import { useBoardStore } from '../stores/board.js'
import { useCalendarStore } from '../stores/calendar.js'
import { useSidebar } from '../composables/useSidebar.js'
import { useSchedulePrefs } from '../composables/useSchedulePrefs.js'
import { getUrgencyLabel, getImportance, getTime } from '../composables/useTaskTriage.js'
import { useRelativeDateGroups } from '../composables/useRelativeDateGroups.js'
import { parseTaskContent } from '../lib/helpers.js'

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'quick', label: 'Quick' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'focus', label: 'Focus' },
]
import AppSidebar from '../components/AppSidebar.vue'
import AppTabbar from '../components/AppTabbar.vue'

const store = useBoardStore()
const calStore = useCalendarStore()
const { sidebarCollapsed, toggleSidebar } = useSidebar()
const schedPrefs = useSchedulePrefs()
const taskListBodyEl = ref(null)
const searchInputEl = ref(null)
const searchQuery = ref('')
const searchExpanded = ref(false)

function expandSearch() {
  searchExpanded.value = true
  nextTick(() => searchInputEl.value?.focus())
}
function onSearchBlur() { if (!searchQuery.value) searchExpanded.value = false }
function clearSearch() { searchQuery.value = ''; searchExpanded.value = false }

// ── Task list ──
const tab = ref('all')
const showUnscheduled = ref(false)
const projectsOpen = ref(true)
const tagsOpen = ref(true)
const activeProjectId = ref(null)

const activeHashtag = computed(() => {
  const m = searchQuery.value.trim().match(/^#(\w+)$/)
  return m ? m[1] : null
})

function toggleHashtag(tag) {
  const token = '#' + tag
  searchQuery.value = searchQuery.value === token ? '' : token
}

function toggleProject(id) {
  activeProjectId.value = activeProjectId.value === id ? null : id
}

const allTasks = computed(() => {
  const projectSet = new Set(store.displayProjects.map(p => p.id))
  return store.tasks.filter(t =>
    !t.is_completed &&
    (t.project_id === null || projectSet.has(t.project_id)) &&
    !store.excludedSectionIds.has(t.section_id) &&
    (t.assigned_to === null || t.assigned_to === store.myPeopleId)
  )
})

const projectsWithTasks = computed(() => {
  const ids = new Set(allTasks.value.map(t => t.project_id))
  return store.displayProjects.filter(p => ids.has(p.id))
})

const filteredTasks = computed(() => {
  let tasks = activeProjectId.value
    ? allTasks.value.filter(t => t.project_id === activeProjectId.value)
    : allTasks.value
  if (showUnscheduled.value) tasks = tasks.filter(t => !scheduledIso(t))
  switch (tab.value) {
    case 'quick': return tasks.filter(t => t.estimated_time != null && t.estimated_time < 30)
    case 'assigned': return tasks.filter(t => t.assigned_to === store.myPeopleId)
    case 'focus': return tasks.filter(t => store.projectEnergy(t.project_id) === 2)
    default: return tasks
  }
})

const nowDate = ref(new Date())
let nowTimer = null

const searchedTasks = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return filteredTasks.value
  return filteredTasks.value.filter(t => {
    if ((t.content || '').toLowerCase().includes(q)) return true
    const pName = t.project_id === null ? 'inbox' : (store.displayProjects.find(p => p.id === t.project_id)?.name ?? '')
    return pName.toLowerCase().includes(q)
  })
})

const taskGroups = useRelativeDateGroups(searchedTasks, scheduledIso, nowDate)

const taskFlatIndex = computed(() => {
  const map = new Map()
  let i = 0
  for (const group of taskGroups.value) for (const task of group.tasks) map.set(task.id, i++)
  return map
})

function projectName(task) {
  if (task.project_id === null) return 'Inbox'
  return store.displayProjects.find(p => p.id === task.project_id)?.name ?? ''
}

function focusTaskRow(idx) {
  const rows = taskListBodyEl.value?.querySelectorAll('.schedule-task-row')
  if (rows && idx >= 0 && idx < rows.length) rows[idx].focus()
}

function scheduleTaskByKey(task) {
  if (calStore.isAnyCalendarConnected) {
    store.pendingScheduleTask = task
    f7.view.current.router.navigate('/schedule/place/')
  } else {
    goSettings()
  }
}

function scheduledIso(task) {
  const ev = calStore.scheduledByTaskId.get(task.id)?.[0]
  if (ev?.start?.dateTime) return new Date(ev.start.dateTime).toISOString()
  return task.scheduled_at ?? null
}

function isOverdue(task) {
  const iso = scheduledIso(task)
  return !!(iso && new Date(iso) < new Date())
}

function scheduledLabel(task) {
  const ev = calStore.scheduledByTaskId.get(task.id)?.[0]
  const iso = scheduledIso(task)
  if (!iso && !ev) return null
  const start = ev ? new Date(ev.start.dateTime || ev.start.date) : new Date(iso)
  const datePart = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  if (ev && !ev.start.dateTime) return datePart
  const hour12 = schedPrefs.timeFormat.value !== '24h'
  const timePart = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12 })
  return `${datePart} ${timePart}`
}

function dueDateLabel(task) {
  const date = task.due?.date
  if (!date) return null
  const due = new Date(date + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diffDays = Math.round((due - today) / 86400000)
  if (diffDays < 0) return 'Overdue'
  if (diffDays === 0) return 'Due today'
  if (diffDays === 1) return 'Due tomorrow'
  if (diffDays < 7) return `Due in ${diffDays}d`
  return `Due ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

// ── Calendar / week navigation ──
const SLOT_HEIGHT = 40
const START_HOUR = 7
const END_HOUR = 21

function getWeekStart(d) {
  const day = new Date(d)
  const dow = day.getDay() // 0=Sun … 6=Sat
  if (schedPrefs.weekStartDay.value === 'sunday') {
    day.setDate(day.getDate() - dow)
  } else {
    const diff = dow === 0 ? -6 : 1 - dow
    day.setDate(day.getDate() + diff)
  }
  day.setHours(0, 0, 0, 0)
  return day
}

const weekStart = ref(getWeekStart(new Date()))

watch(schedPrefs.weekStartDay, () => {
  // re-anchor to the new week boundary for whichever week is currently visible
  const mid = new Date(weekStart.value)
  mid.setDate(mid.getDate() + 3)
  weekStart.value = getWeekStart(mid)
  calStore.loadWeekEvents(weekStart.value)
})

const calBodyEl = ref(null)
const calDaysEl = ref(null)

const weekDays = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart.value)
    d.setDate(d.getDate() + i)
    return d
  })
)

const timeSlots = computed(() => {
  const slots = []
  for (let h = START_HOUR; h < END_HOUR; h++) {
    slots.push({ hour: h, minute: 0, key: `${h}:00` })
    slots.push({ hour: h, minute: 30, key: `${h}:30` })
  }
  return slots
})

const monthLabel = computed(() => {
  const mid = weekDays.value[3] // Thursday — most representative day for split-month weeks
  return {
    month: mid.toLocaleDateString(undefined, { month: 'long' }),
    year: mid.getFullYear(),
  }
})

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function isToday(d) { return isoDate(d) === isoDate(nowDate.value) }
function dayName(d) { return d.toLocaleDateString(undefined, { weekday: 'short' }) }

function formatHour(h) {
  if (schedPrefs.timeFormat.value === '24h') return `${String(h).padStart(2, '0')}:00`
  if (h === 12) return '12pm'
  return h > 12 ? `${h - 12}pm` : `${h}am`
}

async function prevWeek() {
  const d = new Date(weekStart.value)
  d.setDate(d.getDate() - 7)
  weekStart.value = d
  calStore.loadWeekEvents(d)
}

async function nextWeek() {
  const d = new Date(weekStart.value)
  d.setDate(d.getDate() + 7)
  weekStart.value = d
  calStore.loadWeekEvents(d)
}

function goToday() {
  weekStart.value = getWeekStart(new Date())
  calStore.loadWeekEvents(weekStart.value)
}

// ── Events ──
function timedDayEvents(day) {
  const dateStr = isoDate(day)
  return calStore.events.filter(ev => ev.start?.dateTime && ev.start.dateTime.slice(0, 10) === dateStr)
}

function allDayEvents(day) {
  const dateStr = isoDate(day)
  return calStore.events.filter(ev => !ev.start?.dateTime && ev.start?.date === dateStr)
}

function eventStyle(ev) {
  const start = new Date(ev.start.dateTime || ev.start.date + 'T00:00')
  const end = new Date(ev.end.dateTime || ev.end.date + 'T00:00')
  const startMins = (start.getHours() - START_HOUR) * 60 + start.getMinutes()
  const duration = Math.max((end - start) / 60000, 30)
  return {
    top: `${(startMins / 30) * SLOT_HEIGHT}px`,
    height: `${(duration / 30) * SLOT_HEIGHT - 2}px`,
    background: ev._calColor || 'var(--accent)',
  }
}

function eventTimeStr(ev) {
  if (!ev.start?.dateTime) return ''
  const hour12 = schedPrefs.timeFormat.value !== '24h'
  return new Date(ev.start.dateTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12 })
}


// ── Due date constraint visualization ──
const draggingTaskDueDate = computed(() => {
  const date = draggingTask.value?.due?.date
  if (!date) return null
  const d = new Date(date + 'T00:00:00'); d.setHours(0, 0, 0, 0); return d
})
function isDayPastDue(day) {
  if (!draggingTaskDueDate.value) return false
  const d = new Date(day); d.setHours(0, 0, 0, 0)
  return d > draggingTaskDueDate.value
}
function isDayDueBoundary(day) {
  if (!isDayPastDue(day)) return false
  const prev = new Date(day); prev.setDate(prev.getDate() - 1)
  return !isDayPastDue(prev)
}
const pastDueOverlayLeft = computed(() => {
  if (!draggingTaskDueDate.value) return null
  const pastDueCount = weekDays.value.filter(d => isDayPastDue(d)).length
  if (pastDueCount === 0) return null
  return `${((7 - pastDueCount) / 7 * 100).toFixed(4)}%`
})

// ── Drag and drop ──
const draggingTask = ref(null)
const draggingCalEvent = ref(null)
const hoveredSlot = ref(null)
let ghostEl = null

// ── Calendar event import ──
const importingEvent = ref(null)
const importing = ref(false)

function isUnlinked(ev) {
  return !calStore.taskIdByEventUid.has(ev.id) && ev._calId === calStore.targetCalHref
}

function isOtherCal(ev) {
  return ev._calId !== calStore.targetCalHref
}

function importEventTimeStr(ev) {
  if (!ev) return ''
  const start = new Date(ev.start.dateTime || ev.start.date)
  const date = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  if (!ev.start.dateTime) return date
  const hour12 = schedPrefs.timeFormat.value !== '24h'
  const time = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12 })
  return `${date} at ${time}`
}

async function importEventAsTask() {
  if (importing.value || !importingEvent.value) return
  importing.value = true
  try {
    const ev = importingEvent.value
    const isoDatetime = ev.start.dateTime || (ev.start.date + 'T09:00:00')
    const d = new Date(isoDatetime)
    const hour12 = schedPrefs.timeFormat.value !== '24h'
    const task = await store.addInboxTask(ev.summary, '')
    await calStore.linkEventToTask(ev.id, ev._calId, task.id)
    importingEvent.value = null
  } finally {
    importing.value = false
  }
}

function taskDurationMinutes(task) {
  const t = getTime(task)
  if (t === '15m') return 15
  if (t === '30m') return 30
  if (t === '2h') return 120
  return 60
}

function isHoveredSlot(day, slot) {
  return (
    hoveredSlot.value?.dateStr === isoDate(day) &&
    hoveredSlot.value?.hour === slot.hour &&
    hoveredSlot.value?.minute === slot.minute
  )
}

function dropPreviewStyle(day) {
  if ((!draggingTask.value && !draggingCalEvent.value) || !hoveredSlot.value) return null
  if (hoveredSlot.value.dateStr !== isoDate(day)) return null
  const startMins = (hoveredSlot.value.hour - START_HOUR) * 60 + hoveredSlot.value.minute
  let duration = 60
  if (draggingTask.value) {
    duration = taskDurationMinutes(draggingTask.value)
  } else if (draggingCalEvent.value?.start?.dateTime && draggingCalEvent.value?.end?.dateTime) {
    duration = Math.max(
      (new Date(draggingCalEvent.value.end.dateTime) - new Date(draggingCalEvent.value.start.dateTime)) / 60000,
      30
    )
  }
  return {
    top: `${(startMins / 30) * SLOT_HEIGHT}px`,
    height: `${(duration / 30) * SLOT_HEIGHT - 2}px`,
  }
}

function _startDrag(e, label, isTouch = false) {
  if (!isTouch) {
    ghostEl = document.createElement('div')
    ghostEl.className = 'cal-drag-ghost'
    ghostEl.textContent = label
    ghostEl.style.left = `${e.clientX + 14}px`
    ghostEl.style.top = `${e.clientY - 10}px`
    document.body.appendChild(ghostEl)
  }
  document.addEventListener('pointermove', onPointerMove)
  document.addEventListener('pointerup', onPointerUp)
}

// Phone tap — raw touchstart/touchend bypasses F7's synthesized-click blocker
let _taskTapStartX = 0
let _taskTapStartY = 0

function onTaskTouchStart(e) {
  const t = e.touches[0]
  if (t) { _taskTapStartX = t.clientX; _taskTapStartY = t.clientY }
}

function onTaskTouchEnd(e, task) {
  if (window.innerWidth >= 768) return  // iPad/desktop: drag via @pointerdown
  const t = e.changedTouches[0]
  if (!t) return
  if (Math.abs(t.clientX - _taskTapStartX) > 10 || Math.abs(t.clientY - _taskTapStartY) > 10) return
  e.preventDefault()  // suppress synthesized click
  if (calStore.isAnyCalendarConnected) {
    store.pendingScheduleTask = task
    f7.view.current.router.navigate('/schedule/place/')
  } else {
    goSettings()
  }
}

function onTaskPointerDown(e, task) {
  if (e.pointerType === 'touch' && window.innerWidth < 768) return  // handled by @click
  if (e.pointerType === 'mouse' && e.button !== 0) return

  if (e.pointerType === 'touch') {
    // iPad: long press (350ms) to initiate drag — avoids scroll interference
    const startX = e.clientX
    const startY = e.clientY
    let cancelled = false

    function cleanup() {
      document.removeEventListener('pointermove', onMoveCancel)
      document.removeEventListener('pointerup', onUpCancel)
      document.removeEventListener('pointercancel', onCancel)
    }
    function onMoveCancel(me) {
      if (Math.hypot(me.clientX - startX, me.clientY - startY) > 8) {
        cancelled = true
        clearTimeout(longPressTimer)
        cleanup()
      }
    }
    function onUpCancel() { cancelled = true; clearTimeout(longPressTimer); cleanup() }
    function onCancel() { cancelled = true; clearTimeout(longPressTimer); cleanup() }
    const longPressTimer = setTimeout(() => {
      cleanup()
      if (cancelled) return
      navigator.vibrate?.(10)
      draggingTask.value = task
      _startDrag(e, task.content, true)
    }, 350)
    document.addEventListener('pointermove', onMoveCancel, { passive: true })
    document.addEventListener('pointerup', onUpCancel)
    document.addEventListener('pointercancel', onCancel)
    return
  }

  e.preventDefault()
  draggingTask.value = task
  _startDrag(e, task.content)
}

function onCalEventPointerDown(e, ev) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  if (isUnlinked(ev)) {
    importingEvent.value = ev
    return
  }
  if (ev._calId !== calStore.targetCalHref) return
  // Phone: no drag support on small screens; skip to avoid stuck listener state
  if (e.pointerType === 'touch' && window.innerWidth < 768) return
  e.preventDefault()
  draggingCalEvent.value = ev
  _startDrag(e, ev.summary)
}

function _slotFromPointer(e) {
  const daysEl = calDaysEl.value
  const scrollEl = calBodyEl.value
  if (!daysEl || !scrollEl) return null
  const rect = daysEl.getBoundingClientRect()
  const scrollRect = scrollEl.getBoundingClientRect()
  // bounds check against the visible scroll container, not the full (clipped) cal-days element
  if (e.clientX < rect.left || e.clientX > rect.right ||
      e.clientY < scrollRect.top || e.clientY > scrollRect.bottom) return null
  const colWidth = rect.width / 7
  const dayIndex = Math.min(6, Math.max(0, Math.floor((e.clientX - rect.left) / colWidth)))
  // getBoundingClientRect already reflects scroll — do NOT add scrollTop again
  const yInContent = e.clientY - rect.top
  const quarterSlot = Math.floor(yInContent / (SLOT_HEIGHT / 2))
  const totalQuarterSlots = (END_HOUR - START_HOUR) * 4
  if (quarterSlot < 0 || quarterSlot >= totalQuarterSlots) return null
  return {
    dateStr: isoDate(weekDays.value[dayIndex]),
    hour: START_HOUR + Math.floor(quarterSlot / 4),
    minute: (quarterSlot % 4) * 15,
  }
}

function onPointerMove(e) {
  if (!draggingTask.value && !draggingCalEvent.value) return
  if (ghostEl) {
    ghostEl.style.left = `${e.clientX + 14}px`
    ghostEl.style.top = `${e.clientY - 10}px`
  }
  hoveredSlot.value = _slotFromPointer(e)
}

async function onPointerUp() {
  document.removeEventListener('pointermove', onPointerMove)
  document.removeEventListener('pointerup', onPointerUp)
  if (ghostEl) { ghostEl.remove(); ghostEl = null }

  const task = draggingTask.value
  const calEv = draggingCalEvent.value
  const slot = hoveredSlot.value
  const isPastDueDrop = slot ? isDayPastDue(new Date(slot.dateStr + 'T00:00:00')) : false
  draggingTask.value = null
  draggingCalEvent.value = null
  hoveredSlot.value = null

  if (!slot || !calStore.isAnyCalendarConnected || isPastDueDrop) return

  const [year, month, day] = slot.dateStr.split('-').map(Number)

  if (task) {
    // Delete any existing events for this task across all weeks, then create a fresh one
    await calStore.deleteAllByTaskId(task.id)
    try {
      const start = new Date(year, month - 1, day, slot.hour, slot.minute, 0, 0)
      const projectName = store.displayProjects.find(p => p.id === task.project_id)?.name ?? ''
      await calStore.createEvent(
        task,
        projectName,
        new Date(year, month - 1, day),
        slot.hour,
        slot.minute,
        taskDurationMinutes(task)
      )
      await store.saveScheduledTime(task.id, start.toISOString())
    } catch (err) {
      console.error('Failed to create event:', err)
    }
  } else if (calEv?.start?.dateTime) {
    // Move existing calendar event, preserving duration
    const newStart = new Date(year, month - 1, day, slot.hour, slot.minute, 0, 0)
    const duration = new Date(calEv.end.dateTime) - new Date(calEv.start.dateTime)
    const newEnd = new Date(newStart.getTime() + duration)
    try {
      await calStore.updateEvent(calEv.id, calEv._calId, newStart, newEnd)
    } catch (err) {
      console.error('Failed to move event:', err)
    }
  }
}

function onPageAfterIn() {
  document.removeEventListener('pointermove', onPointerMove)
  document.removeEventListener('pointerup', onPointerUp)
  if (ghostEl) { ghostEl.remove(); ghostEl = null }
  draggingTask.value = null
  draggingCalEvent.value = null
  hoveredSlot.value = null
  importingEvent.value = null
}

function _onF7PageAfterIn(page) {
  if (page.name === 'schedule') onPageAfterIn()
}

onBeforeUnmount(() => {
  clearInterval(nowTimer)
  document.removeEventListener('pointermove', onPointerMove)
  document.removeEventListener('pointerup', onPointerUp)
  if (ghostEl) { ghostEl.remove(); ghostEl = null }
  draggingTask.value = null
  draggingCalEvent.value = null
  f7.off('pageAfterIn', _onF7PageAfterIn)
})

// ── Navigation ──
function goBoard()    { f7.tab.show('#view-board') }
function goTasks()    { f7.tab.show('#view-tasks') }
function goSettings() { f7.tab.show('#view-settings') }

watch(() => calStore.isAnyCalendarConnected, async (connected) => {
  if (connected) {
    calStore.loadWeekEvents(weekStart.value)
    await nextTick()
    if (calBodyEl.value) calBodyEl.value.scrollTop = SLOT_HEIGHT * 2
  }
})

// Sync calendar ↔ Todoist: reconcile scheduled time and title on calendar load.
// Time: calendar is always source of truth (user rescheduled in Google Calendar).
// Title: last-write-wins via updated timestamps; 5s threshold ignores same-write jitter.
watch(() => calStore.scheduledByTaskId, async (map) => {
  for (const [taskId, evs] of map) {
    if (!evs.length) continue
    const ev = evs[0]
    if (!ev.start?.dateTime) continue
    const task = store.tasks.find(t => t.id === taskId)
    if (!task) continue

    const calIso = new Date(ev.start.dateTime).toISOString()
    const savedIso = task.scheduled_at ? new Date(task.scheduled_at).toISOString() : null
    if (calIso !== savedIso) {
      await store.saveScheduledTime(taskId, calIso)
    }

    if (ev.summary && ev.summary !== task.content) {
      const calUpdated = ev.updated ? new Date(ev.updated).getTime() : 0
      const taskUpdated = task.updated_at ? new Date(task.updated_at).getTime() : 0
      if (calUpdated > taskUpdated + 5000) {
        await store.updateTaskTriage(taskId, { content: ev.summary })
      } else if (taskUpdated > calUpdated + 5000) {
        const projectName = store.displayProjects.find(p => p.id === task.project_id)?.name ?? ''
        await calStore.syncEventForTask(task, projectName)
      }
    }
  }
})

// ── Current time indicator ──
const nowMinutes = computed(() => {
  const n = nowDate.value
  return Math.round((n.getHours() * 60 + n.getMinutes()) / 15) * 15
})
const nowTop = computed(() => {
  const todayInWeek = weekDays.value.some(d => isToday(d))
  if (!todayInWeek) return null
  const mins = nowMinutes.value - START_HOUR * 60
  if (mins < 0 || mins > (END_HOUR - START_HOUR) * 60) return null
  return (mins / 30) * SLOT_HEIGHT
})
const nowLineLeft = computed(() => {
  const idx = weekDays.value.findIndex(d => isToday(d))
  if (idx < 0) return '0%'
  return `${(idx / 7) * 100}%`
})

onMounted(async () => {
  nowTimer = setInterval(() => { nowDate.value = new Date() }, 60000)
  f7.on('pageAfterIn', _onF7PageAfterIn)
  store.initStages()
  await store.loadIfStale()
  if (calStore.isAnyCalendarConnected) {
    calStore.loadWeekEvents(weekStart.value)
    await nextTick()
    if (calBodyEl.value) calBodyEl.value.scrollTop = SLOT_HEIGHT * 2
  }
})
</script>
