<template>
  <f7-page name="inbox" class="inbox-page" no-swipeback>
    <div class="inbox-screen">
      <AppSidebar current-page="inbox">
        <template #filters>
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

        <div class="inbox-top-bar">
          <div class="inbox-search-pill">
            <i class="ph ph-magnifying-glass inbox-search-icon" aria-hidden="true"></i>
            <input
              ref="searchInputEl"
              v-model="searchQuery"
              class="inbox-search-input"
              type="search"
              placeholder="Search or #tag…"
              @keydown.escape="searchQuery = ''"
            />
            <button v-if="searchQuery" class="inbox-search-clear" aria-label="Clear" @click="searchQuery = ''">
              <i class="ph ph-x"></i>
            </button>
          </div>
        </div>

        <div class="inbox-body">
        <div class="inbox-content">
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

          <!-- Completed tasks section -->
          <div v-if="completedCount > 0" class="task-section-header task-section-private" @click="toggleArchive">
            <span class="task-section-caret" :class="{ expanded: showArchive }"><i class="ph ph-caret-right" aria-hidden="true"></i></span>
            <i class="ph ph-archive task-section-icon" aria-hidden="true"></i>
            <span class="task-section-label">Completed</span>
            <span v-if="!loadingArchive" class="task-section-count">· {{ completedCount }}</span>
            <i v-else class="ph ph-arrow-clockwise spin-icon task-section-loading" aria-hidden="true"></i>
          </div>
          <div v-if="completedCount > 0 && showArchive" class="task-section-body">
            <div role="list" aria-label="Completed inbox tasks">
              <TaskItem
                v-for="task in completedTasks"
                :key="task.id"
                :task="task"
                :archived="true"
                :on-restore="restoreTask"
              />
            </div>
          </div>
        </div>
        </div><!-- inbox-body -->
      </div>
    </div>

    <AppTabbar current-tab="inbox" />
  </f7-page>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useBoardStore } from '../stores/board.js'
import { useSidebar } from '../composables/useSidebar.js'
import AppSidebar from '../components/AppSidebar.vue'
import AppTabbar from '../components/AppTabbar.vue'
import TaskItem from '../components/TaskItem.vue'

const store = useBoardStore()
const { sidebarCollapsed, toggleSidebar } = useSidebar()

const tagsOpen = ref(true)
const searchQuery = ref('')
const searchInputEl = ref(null)

function toggleHashtag(tag) {
  const token = '#' + tag
  if (searchQuery.value === token) {
    searchQuery.value = ''
  } else {
    searchQuery.value = token
    nextTick(() => searchInputEl.value?.focus())
  }
}

const activeHashtag = computed(() => {
  const m = searchQuery.value.trim().match(/^#(\w+)$/)
  return m ? m[1] : null
})

// ── Drag to reorder ──
const taskListEl = ref(null)
const dragId = ref(null)
const dropIndex = ref(-1)

function onDragStart(e) {
  if (searchQuery.value.trim()) return
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

const inboxTasks = computed(() => {
  let tasks = store.tasks
    .filter(t => t.project_id == null && !t.is_completed)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const q = searchQuery.value.trim().toLowerCase()
  if (q) tasks = tasks.filter(t => (t.content || '').toLowerCase().includes(q))
  return tasks
})

const showArchive = ref(false)
const loadingArchive = ref(false)
const completedTasks = computed(() => store.completedInboxTasks())
const completedCount = computed(() => store.completedProjectTaskCount(null))

async function toggleArchive() {
  showArchive.value = !showArchive.value
  if (showArchive.value && completedTasks.value.length === 0) {
    loadingArchive.value = true
    await store.fetchCompletedTasks(null).catch(console.error)
    loadingArchive.value = false
  }
}

async function restoreTask(taskId) {
  await store.uncompleteTask(taskId, null).catch(console.error)
}

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
  store.fetchCompletedCount(null).catch(console.error)
})

onUnmounted(() => {
  document.removeEventListener('pointermove', onDragMove)
})
</script>
