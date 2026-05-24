<template>
  <f7-page name="inbox" class="inbox-page" no-swipeback>
    <div class="inbox-screen">
      <AppSidebar current-page="inbox" />

      <div class="inbox-main">
        <button
          v-if="sidebarCollapsed"
          class="sidebar-expand-btn"
          title="Expand sidebar"
          aria-label="Expand sidebar"
          @click="toggleSidebar"
        >
          <i class="ph ph-sidebar-simple" aria-hidden="true"></i>
        </button>

        <div class="inbox-content">
          <h1 class="settings-page-title">Inbox</h1>

          <div ref="taskListEl" role="list" aria-label="Inbox tasks" @pointerdown="onDragStart">
            <div v-if="!inboxTasks.length" class="triage-empty-list">
              <i class="ph ph-wind" aria-hidden="true"></i>
              Inbox is empty
            </div>
            <template v-for="(task, idx) in inboxTasks" :key="task.id">
              <div v-if="dragId && dropIndex === idx" class="task-drop-indicator" aria-hidden="true" />
              <TaskItem :task="task" :class="{ 'is-dragging': dragId === task.id }" />
            </template>
            <div v-if="dragId && dropIndex === inboxTasks.length" class="task-drop-indicator" aria-hidden="true" />
          </div>

          <!-- Quick-add -->
          <div class="task-quick-add-wrap" :class="{ 'task-quick-add-wrap-sep': inboxTasks.length }">
            <div
              v-if="!addingTask"
              class="task-quick-add-row"
              role="button"
              tabindex="0"
              @click="startAdd"
              @keydown.enter.prevent="startAdd"
              @keydown.space.prevent="startAdd"
            >
              <div class="task-handle-spacer" aria-hidden="true"></div>
              <div class="task-quick-add-btn" aria-hidden="true"><i class="ph ph-plus"></i></div>
              <span class="task-quick-add-label">Add task</span>
            </div>
            <div v-else class="task-quick-add-row task-quick-add-editing">
              <div class="task-handle-spacer" aria-hidden="true"></div>
              <div class="task-quick-add-btn" aria-hidden="true"><i class="ph ph-plus"></i></div>
              <input
                ref="quickAddInputEl"
                v-model="newTaskContent"
                class="quick-add-input"
                type="text"
                placeholder="Task name"
                @keydown.enter.prevent="submitAdd"
                @keydown.escape.stop="cancelAdd"
                @blur="onAddBlur"
              >
            </div>
          </div>
        </div>
      </div>
    </div>

    <AppTabbar current-tab="inbox" />
  </f7-page>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useBoardStore } from '../stores/board.js'
import { useSidebar } from '../composables/useSidebar.js'
import AppSidebar from '../components/AppSidebar.vue'
import AppTabbar from '../components/AppTabbar.vue'
import TaskItem from '../components/TaskItem.vue'

const store = useBoardStore()
const { sidebarCollapsed, toggleSidebar } = useSidebar()

// ── Drag to reorder ──
const taskListEl = ref(null)
const dragId = ref(null)
const dropIndex = ref(-1)

function onDragStart(e) {
  if (!e.target.closest('.task-handle')) return
  const wrap = e.target.closest('.task-item-wrap')
  if (!wrap) return
  const taskEl = wrap.querySelector('[id^="task-"]')
  if (!taskEl) return
  e.preventDefault()
  const id = taskEl.id.replace('task-', '')
  dragId.value = id
  dropIndex.value = inboxTasks.value.findIndex(t => t.id === id)
  document.body.style.userSelect = 'none'
  document.addEventListener('pointermove', onDragMove, { passive: true })
  document.addEventListener('pointerup', onDragEnd, { once: true })
  document.addEventListener('pointercancel', onDragEnd, { once: true })
}

function onDragMove(e) {
  if (!dragId.value || !taskListEl.value) return
  const wraps = [...taskListEl.value.querySelectorAll('.task-item-wrap')]
  let newIndex = wraps.length
  for (let i = 0; i < wraps.length; i++) {
    const rect = wraps[i].getBoundingClientRect()
    if (e.clientY < rect.top + rect.height / 2) { newIndex = i; break }
  }
  dropIndex.value = newIndex
}

async function onDragEnd() {
  document.removeEventListener('pointermove', onDragMove)
  document.body.style.userSelect = ''
  if (!dragId.value) return
  const fromIdx = inboxTasks.value.findIndex(t => t.id === dragId.value)
  let toIdx = dropIndex.value > fromIdx ? dropIndex.value - 1 : dropIndex.value
  toIdx = Math.max(0, Math.min(inboxTasks.value.length - 1, toIdx))
  if (fromIdx !== toIdx) {
    const ordered = [...inboxTasks.value]
    const [moved] = ordered.splice(fromIdx, 1)
    ordered.splice(toIdx, 0, moved)
    await store.reorderTasks(ordered.map(t => t.id)).catch(console.error)
  }
  dragId.value = null
  dropIndex.value = -1
}

// ── Quick-add ──
const addingTask = ref(false)
const newTaskContent = ref('')
const quickAddInputEl = ref(null)

const inboxTasks = computed(() =>
  store.tasks
    .filter(t => t.project_id == null && !t.is_completed)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
)

function startAdd() {
  addingTask.value = true
  nextTick(() => quickAddInputEl.value?.focus())
}

async function submitAdd() {
  const content = newTaskContent.value.trim()
  if (content) {
    await store.quickAddTask(content, null).catch(console.error)
  }
  newTaskContent.value = ''
  addingTask.value = false
}

function cancelAdd() {
  newTaskContent.value = ''
  addingTask.value = false
}

function onAddBlur() {
  setTimeout(() => { if (addingTask.value) cancelAdd() }, 150)
}

onMounted(async () => {
  await store.loadIfStale()
})

onUnmounted(() => {
  document.removeEventListener('pointermove', onDragMove)
})
</script>
