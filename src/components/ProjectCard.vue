<template>
  <div
    ref="cardEl"
    class="card"
    :class="{
      dragging: dragging,
      stale: isStale && !isOnIce,
      'on-ice': isOnIce,
      'card-energy-1': energyLevel === 1,
      'card-energy-2': energyLevel === 2,
    }"
    role="listitem"
    tabindex="0"
    @keydown.enter.prevent="$emit('click')"
    @keydown.space.prevent="$emit('click')"
  >
    <!-- Top-right corner icons -->
    <div class="card-top-right">
      <span
        v-if="submissionStatus"
        class="card-submission-icon"
        :class="`card-submission-${submissionStatusKey}`"
        :title="submissionStatus"
      ><i :class="`ph ph-${submissionStatusIcon}`"></i></span>
      <span
        v-else-if="submissionError"
        class="card-submission-unavailable"
        title="Status unavailable"
      >?</span>
    </div>

    <div v-if="meta.venue" class="card-venue-badge">
      <span class="card-venue-dot"></span>
      <span class="card-venue-name">{{ meta.venue }}</span>
    </div>

    <!-- Title -->
    <div class="card-name">{{ project.name }}</div>

    <!-- Status -->
    <div v-if="statusText" class="card-status">{{ statusText }}</div>

    <!-- Bottom row: people + date + focus -->
    <div class="card-bottom">
      <div class="card-people">
        <span
          v-for="person in personLabels"
          :key="person"
          class="card-person-chip"
        >{{ person }}</span>
      </div>

      <div class="card-bottom-right">
        <div v-if="deadlineDate" class="card-date" :class="deadlineDateClass">
          <i class="ph ph-calendar" aria-hidden="true"></i>
          {{ deadlineFormatted }}
        </div>
        <button
          class="card-energy-btn"
          :class="{ 'energy-low': energyLevel === 1, 'energy-high': energyLevel === 2, 'energy-stale': energyLevel === 0 && isStale && !isOnIce }"
          :aria-label="energyLevel === 2 ? 'Full focus — click to clear' : energyLevel === 1 ? 'Some attention — click to increase' : 'No focus — click to set'"
          @pointerdown.stop
          @click.stop="store.cycleEnergy(project.id)"
        >
          <i :class="batteryIcon" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useBoardStore } from '../stores/board.js'
import { useReviewsStore } from '../stores/reviews.js'
import { nearestDue, dueStatus, formatDate } from '../lib/helpers.js'

const props = defineProps({
  project: { type: Object, required: true },
  stage: { type: Object, default: null },
})

const emit = defineEmits(['click'])

const store = useBoardStore()
const reviewsStore = useReviewsStore()
const cardEl = ref(null)
const dragging = ref(false)

const stageInfo = computed(() => store.projectStage(props.project.id))
const tasks = computed(() => store.projectTasks(props.project.id))
const meta = computed(() => store.projectMeta(props.project.id))
const deadline = computed(() => store.projectDeadline(props.project.id))
const energyLevel = computed(() => store.projectEnergy(props.project.id))
const batteryIcon = computed(() => {
  if (energyLevel.value === 2) return 'ph ph-battery-charging'
  if (energyLevel.value === 1) return 'ph ph-battery-low'
  if (isStale.value && !isOnIce.value) return 'ph ph-battery-warning'
  return 'ph ph-battery-empty'
})

function _getMonday(d) {
  const day = new Date(d); const dow = day.getDay()
  day.setDate(day.getDate() + (dow === 0 ? -6 : 1 - dow)); day.setHours(0,0,0,0); return day
}
const scheduledHoursThisWeek = computed(() => {
  if (energyLevel.value === 0) return 0
  const monday = _getMonday(new Date())
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 7)
  let minutes = 0
  for (const task of store.tasks) {
    if (task.project_id !== props.project.id || task.is_completed) continue
    const line = (task.description || '').split('\n').find(l => l.startsWith('📅 Scheduled:'))
    const m = line?.match(/\(([^)]+)\)$/)
    if (!m) continue
    const dt = new Date(m[1])
    if (dt < monday || dt >= sunday) continue
    if (!task.estimated_time) continue
    minutes += task.estimated_time
  }
  return minutes / 60
})

const statusText = computed(() => props.project.status_text || '')
const personLabels = computed(() => {
  const myId = store.myPeopleId
  const seen = new Set()
  const names = []
  const op = props.project.owner_person
  if (op && op.id !== myId) { seen.add(op.id); names.push(op.display_name) }
  for (const m of (props.project.members || [])) {
    if (!m.person || m.person.id === myId || seen.has(m.person.id)) continue
    seen.add(m.person.id)
    names.push(m.person.display_name)
  }
  return names
})

const staleDays = computed(() => {
  const ts = props.project.updated_at || props.project.created_at
  return ts ? (Date.now() - new Date(ts).getTime()) / 86400000 : null
})
const isStale = computed(() => staleDays.value !== null && staleDays.value > 14)
const isOnIce = computed(() => props.stage?.name === 'On Ice')
const staleWeeks = computed(() => staleDays.value ? Math.floor(staleDays.value / 7) : 0)

// Submission status badge
const submissionStatus = computed(() => reviewsStore.submissionStatuses[props.project.id]?.status ?? null)
const submissionError = computed(() => reviewsStore.submissionStatuses[props.project.id]?.error ?? null)
const submissionStatusKey = computed(() => {
  const s = (submissionStatus.value || '').toLowerCase()
  if (s.includes('accept')) return 'accepted'
  if (s.includes('reject')) return 'rejected'
  if (s === 'submitted' || (s.includes('submit') && !s.includes('not'))) return 'submitted'
  if (s.includes('not')) return 'draft'
  return 'draft'
})
const submissionStatusIcon = computed(() => {
  const k = submissionStatusKey.value
  if (k === 'accepted') return 'check-circle'
  if (k === 'rejected') return 'x-circle'
  if (k === 'submitted') return 'cloud-arrow-up'
  return 'circle'
})

// Deadline display
const deadlineDate = computed(() => deadline.value)
const deadlineFormatted = computed(() => {
  if (!deadline.value) return ''
  return deadline.value.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
})
const deadlineDateClass = computed(() => {
  if (!deadline.value) return ''
  const diff = deadline.value.getTime() - Date.now()
  if (diff < 0) return 'overdue'
  if (diff < 7 * 86400000) return 'due-soon'
  return ''
})


onMounted(() => {
  const card = cardEl.value
  if (!card) return

  card.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return

    const startX = e.clientX
    const startY = e.clientY
    const rect = card.getBoundingClientRect()
    const offsetX = startX - rect.left
    const offsetY = startY - rect.top
    const isTouch = e.pointerType === 'touch'
    const pointerId = e.pointerId

    let isDragging = false
    let wasCancelled = false
    let ghost = null
    let currentCol = null
    let longPressTimer = null
    let lastX = startX
    let lastY = startY

    function activateDrag() {
      if (isDragging) return
      isDragging = true
      dragging.value = true
      store.cardDragging = true
      if (isTouch) {
        navigator.vibrate?.(10)
        card.setPointerCapture(pointerId)
      }
      document.body.style.cursor = 'grabbing'
      document.documentElement.style.setProperty('--placeholder-h', rect.height + 'px')
      const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      ghost = card.cloneNode(true)
      Object.assign(ghost.style, {
        position: 'fixed',
        width: rect.width + 'px',
        borderRadius: '12px',
        pointerEvents: 'none',
        zIndex: '1000',
        opacity: '0.9',
        transform: 'rotate(2deg) scale(1.04)',
        boxShadow: `0 28px 60px rgba(0,0,0,0.25), 0 0 0 1.5px ${accentColor}`,
        margin: '0',
        transition: 'none',
      })
      ghost.style.left = (lastX - offsetX) + 'px'
      ghost.style.top  = (lastY - offsetY) + 'px'
      document.body.appendChild(ghost)
    }

    if (isTouch) {
      longPressTimer = setTimeout(activateDrag, 350)
    }

    function onMove(e) {
      lastX = e.clientX
      lastY = e.clientY

      if (!isDragging) {
        if (isTouch) {
          if (Math.hypot(e.clientX - startX, e.clientY - startY) > 8) {
            wasCancelled = true
            clearTimeout(longPressTimer)
            document.removeEventListener('pointermove', onMove)
          }
        } else {
          if (Math.hypot(e.clientX - startX, e.clientY - startY) >= 8) {
            store.cardDragging = true
            activateDrag()
          }
        }
        return
      }

      e.preventDefault()
      ghost.style.left = (e.clientX - offsetX) + 'px'
      ghost.style.top  = (e.clientY - offsetY) + 'px'
      ghost.style.visibility = 'hidden'
      const el = document.elementFromPoint(e.clientX, e.clientY)
      ghost.style.visibility = ''
      const col = el?.closest('.col[data-stage-id]') ?? null
      if (col !== currentCol) {
        currentCol?.classList.remove('drag-over')
        currentCol = col
        currentCol?.classList.add('drag-over')
      }
    }

    function onUp() {
      clearTimeout(longPressTimer)
      document.removeEventListener('pointermove', onMove)
      document.body.style.cursor = ''
      store.cardDragging = false
      if (!isDragging) {
        if (!wasCancelled) emit('click')
        return
      }
      ghost?.remove()
      dragging.value = false
      currentCol?.classList.remove('drag-over')
      document.documentElement.style.removeProperty('--placeholder-h')
      const newStageId = currentCol?.dataset.stageId ?? null
      const oldStageId = stageInfo.value?.id ?? null
      if (newStageId && newStageId !== oldStageId) {
        store.moveStage(props.project.id, null, oldStageId, newStageId).catch(console.error)
      }
    }

    document.addEventListener('pointermove', onMove, { passive: false })
    document.addEventListener('pointerup', onUp, { once: true })
  })
})
</script>
