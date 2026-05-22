<template>
  <div class="task-item-wrap" role="listitem">
    <div class="task-swipe-zone" aria-hidden="true">
      <button class="task-swipe-btn" :style="dueBtnStyle" @click.stop="startDueEdit">
        <span class="task-swipe-pill"><i class="ph ph-flag" aria-hidden="true"></i></span>
        <span class="task-swipe-label">Due</span>
      </button>
      <button class="task-swipe-btn task-swipe-del" :style="delBtnStyle" @click.stop="doDelete">
        <span class="task-swipe-pill"><i class="ph ph-trash" aria-hidden="true"></i></span>
        <span class="task-swipe-label">Remove</span>
      </button>
    </div>
    <div
      ref="taskItemEl"
      class="task-item"
      :class="[priorityClass, { 'swipe-open': swipeOpen }]"
      :id="'task-' + task.id"
      :style="swipeStyle"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @click="onItemClick"
    >
      <div class="task-handle" aria-hidden="true">
        <i class="ph ph-dots-six-vertical"></i>
      </div>
      <div
        class="task-check"
        :class="{ done: completing }"
        role="button"
        tabindex="0"
        aria-label="Complete task"
        @click.stop="complete"
        @keydown.enter.prevent="complete"
        @keydown.space.prevent="complete"
      ></div>
      <div class="task-content">
        <div v-if="!editingTitle" class="task-name" :class="{ 'task-name-done': striking }" role="button" tabindex="0" @click.stop="startTitleEdit" @keydown.enter.prevent="startTitleEdit">
          <span v-if="priorityLabel" class="sr-only">{{ priorityLabel }}: </span>
          <template v-for="seg in contentSegments" :key="seg.i">
            <a v-if="seg.href" :href="seg.href" target="_blank" rel="noopener noreferrer" class="task-link" @click.stop>{{ seg.text }}</a>
            <template v-else>{{ seg.text }}</template>
          </template>
          <i v-if="(task.labels || []).includes('scheduled')" class="ph ph-calendar-check task-cal-badge" aria-hidden="true"></i>
        </div>
        <input
          v-if="editingTitle"
          ref="titleInputEl"
          class="task-title-edit"
          :value="task.content"
          @blur="saveTitle"
          @keydown.enter.prevent="titleInputEl?.blur()"
          @keydown.escape.stop="editingTitle = false"
          @click.stop
        >
      </div>
      <div
        v-if="task.due"
        class="task-due-right"
        :class="dueClass"
        role="button"
        tabindex="0"
        aria-label="Edit due date"
        @click.stop="startDueEdit"
        @keydown.enter.prevent="startDueEdit"
        @keydown.space.prevent="startDueEdit"
      >
        <i class="ph ph-flag" aria-hidden="true"></i>
        {{ formattedDue }}
      </div>
      <div class="task-hover-actions">
        <button v-if="!task.due" class="task-action-btn task-action-due" aria-label="Add due date" @click.stop="startDueEdit">
          <i class="ph ph-flag" aria-hidden="true"></i>
          <span class="task-action-label">Due</span>
        </button>
        <button class="task-action-btn task-action-delete" aria-label="Delete task" @click.stop="doDelete">
          <i class="ph ph-trash" aria-hidden="true"></i>
          <span class="task-action-label">Remove</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { f7 } from 'framework7-vue/bundle'
import { useBoardStore } from '../stores/board.js'
import { dueStatus, formatDate, parseTaskContent } from '../lib/helpers.js'

const props = defineProps({
  task: { type: Object, required: true },
})

const store = useBoardStore()
const taskItemEl = ref(null)
const titleInputEl = ref(null)
const editingTitle = ref(false)
const completing = ref(false)
const striking = ref(false)
let calendarInstance = null

// ── Swipe state ──
const swipeX = ref(0)
const swipeOpen = ref(false)
const isSwiping = ref(false)
let startX = 0, startY = 0, dirLocked = false, isHoriz = false

const GAP = 12
const BTN_W = 56
const SNAP = BTN_W * 2 + GAP  // 124px; widths track swipe linearly so no clipping

function easeOut(t) { return 1 - (1 - t) * (1 - t) }

const delBtnStyle = computed(() => {
  const x = Math.abs(swipeX.value)
  const w = Math.min(BTN_W, x)
  const p = easeOut(Math.min(1, x / BTN_W))
  const tr = isSwiping.value ? 'none' : 'width 0.25s ease, opacity 0.25s ease, transform 0.25s ease'
  return {
    width: w + 'px',
    opacity: Math.min(1, p * 1.8),
    transform: `scaleY(${p.toFixed(3)})`,
    transformOrigin: 'right center',
    transition: tr,
  }
})

const dueBtnStyle = computed(() => {
  const x = Math.abs(swipeX.value)
  const w = Math.max(0, Math.min(BTN_W, x - BTN_W - GAP))
  const p = easeOut(Math.max(0, Math.min(1, (x - BTN_W - GAP) / BTN_W)))
  const tr = isSwiping.value ? 'none' : 'width 0.25s ease, opacity 0.25s ease, transform 0.25s ease'
  return {
    width: w + 'px',
    opacity: Math.min(1, p * 1.8),
    transform: `scaleY(${p.toFixed(3)})`,
    transformOrigin: 'right center',
    transition: tr,
  }
})

const swipeStyle = computed(() => ({
  transform: `translateX(${swipeX.value}px)`,
  transition: isSwiping.value ? 'none' : 'transform 0.25s ease',
}))

function onPointerDown(e) {
  if (e.pointerType === 'mouse') return
  startX = e.clientX; startY = e.clientY
  dirLocked = false; isHoriz = false
  isSwiping.value = true
}

function onPointerMove(e) {
  if (!isSwiping.value) return
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  if (!dirLocked && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
    isHoriz = Math.abs(dx) > Math.abs(dy) * 1.5
    dirLocked = true
  }
  if (!dirLocked || !isHoriz) return
  e.preventDefault()
  const base = swipeOpen.value ? -SNAP : 0
  swipeX.value = Math.min(0, Math.max(-SNAP, base + dx))
}

function onPointerUp() {
  if (!isSwiping.value) return
  isSwiping.value = false
  if (!isHoriz) return
  if (swipeX.value < -SNAP / 2) {
    swipeX.value = -SNAP; swipeOpen.value = true
  } else {
    swipeX.value = 0; swipeOpen.value = false
  }
}

function onPointerCancel() {
  isSwiping.value = false
  swipeX.value = swipeOpen.value ? -SNAP : 0
}

function onItemClick() {
  if (swipeOpen.value) { swipeX.value = 0; swipeOpen.value = false }
}

// ── Link rendering ──
const contentSegments = computed(() => parseTaskContent(props.task.content))

// ── Priority ──
const priorityClass = computed(() => {
  if (props.task.priority === 4) return 'p1'
  if (props.task.priority === 3) return 'p2'
  if (props.task.priority === 2) return 'p3'
  return ''
})

const priorityLabel = computed(() => {
  if (props.task.priority === 4) return 'Priority 1'
  if (props.task.priority === 3) return 'Priority 2'
  if (props.task.priority === 2) return 'Priority 3'
  return ''
})

// ── Due date ──
const dueClass = computed(() => {
  if (!props.task.due) return ''
  return dueStatus(new Date(props.task.due.date).getTime())
})

const formattedDue = computed(() => formatDate(props.task.due?.date ?? ''))

async function complete() {
  completing.value = true
  striking.value = true
  await new Promise(r => setTimeout(r, 350))
  await store.completeTask(props.task.id).catch(console.error)
}

function startDueEdit(e) {
  if (swipeOpen.value) { swipeX.value = 0; swipeOpen.value = false }
  const targetEl = taskItemEl.value ?? e?.currentTarget ?? null
  const initial = props.task.due?.date
    ? [new Date(props.task.due.date + 'T12:00:00')]
    : []

  calendarInstance?.destroy()
  calendarInstance = f7.calendar.create({
    openIn: 'auto',
    inputEl: targetEl,
    value: initial,
    closeOnSelect: true,
    toolbar: true,
    renderToolbar() {
      return `<div class="toolbar toolbar-top no-shadow">
        <div class="toolbar-inner">
          <div class="left">
            <button type="button" class="link cal-clear">Clear</button>
          </div>
          <div class="right" style="gap:4px">
            <button type="button" class="link cal-today">Today</button>
            <button type="button" class="link cal-tomorrow">Tomorrow</button>
            <button type="button" class="link cal-nextweek">Next week</button>
          </div>
        </div>
      </div>`
    },
    on: {
      open(cal) {
        function handler(ev) {
          const t = ev.target.closest('.cal-clear,.cal-today,.cal-tomorrow,.cal-nextweek')
          if (!t) return
          ev.preventDefault()
          ev.stopPropagation()
          if (t.classList.contains('cal-clear')) {
            store.updateTaskDue(props.task.id, '').catch(console.error)
            cal.close()
          } else if (t.classList.contains('cal-today')) { pickQuick(cal, 0) }
          else if (t.classList.contains('cal-tomorrow')) { pickQuick(cal, 1) }
          else if (t.classList.contains('cal-nextweek')) { pickQuick(cal, 7) }
        }
        document.addEventListener('click', handler, true)
        cal._toolbarHandler = handler
      },
      change(cal, value) {
        if (!value.length) return
        store.updateTaskDue(props.task.id, isoDate(value[0])).catch(console.error)
      },
      closed(cal) {
        if (cal._toolbarHandler) document.removeEventListener('click', cal._toolbarHandler, true)
        cal.destroy()
        calendarInstance = null
      },
    },
  })
  calendarInstance.open()
}

function pickQuick(cal, daysOffset) {
  const d = new Date()
  d.setDate(d.getDate() + daysOffset)
  store.updateTaskDue(props.task.id, isoDate(d)).catch(console.error)
  cal.close()
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

onBeforeUnmount(() => { calendarInstance?.destroy() })

function startTitleEdit() {
  editingTitle.value = true
  setTimeout(() => titleInputEl.value?.select(), 0)
}

async function saveTitle() {
  editingTitle.value = false
  const val = titleInputEl.value?.value?.trim()
  if (val && val !== props.task.content) {
    await store.updateStatusText(props.task.id, val).catch(console.error)
  }
}

async function doDelete() {
  await store.deleteTask(props.task.id).catch(console.error)
}
</script>
