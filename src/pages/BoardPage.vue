<template>
  <f7-page name="board" class="board-page" no-swipeback>
    <div class="board-screen">
      <AppSidebar current-page="board" />

      <!-- Board main area -->
      <div ref="screenEl" class="board-main">
        <button
          v-if="sidebarCollapsed"
          class="sidebar-expand-btn"
          title="Expand sidebar"
          aria-label="Expand sidebar"
          @click="toggleSidebar"
        >
          <i class="ph ph-sidebar-simple" aria-hidden="true"></i>
        </button>
        <div ref="ptrIndicator" class="ptr-indicator" aria-hidden="true"></div>

        <div v-if="store.loading && !boardReady" class="board-loading" role="status">
          <span class="sr-only">Loading board</span>
          <div class="board-spinner"></div>
        </div>

        <div class="board" role="main" :aria-busy="store.loading">
          <BoardColumn
            v-for="(stage, idx) in store.stages"
            :key="stage.id || stage.name"
            :stage="stage"
            :stage-index="idx"
            @card-click="openProject"
          />
          <BoardColumn
            v-if="unassignedProjects.length"
            :stage="{ name: 'Unassigned', id: null }"
            :stage-index="99"
            :override-projects="unassignedProjects"
            @card-click="openProject"
          />
        </div>

        <button class="fab-new-project" title="New project" aria-label="New project" @click="openNewProject">
          <i class="ph ph-plus" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <AppTabbar current-tab="board" />
  </f7-page>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { f7 } from 'framework7-vue/bundle'
import { useBoardStore } from '../stores/board.js'
import { useReviewsStore } from '../stores/reviews.js'
import { usePullToRefresh } from '../composables/usePullToRefresh.js'
import { useSidebar } from '../composables/useSidebar.js'
import BoardColumn from '../components/BoardColumn.vue'
import AppSidebar from '../components/AppSidebar.vue'
import AppTabbar from '../components/AppTabbar.vue'

const store = useBoardStore()
const reviewsStore = useReviewsStore()
const { sidebarCollapsed, toggleSidebar } = useSidebar()
const screenEl = ref(null)
const ptrIndicator = ref(null)
const boardReady = ref(false)

const unassignedProjects = computed(() =>
  store.displayProjects.filter(p => !store.projectStage(p.id))
)

function openProject(project) {
  f7.view.current.router.navigate('/project/' + project.id + '/')
}

function openNewProject() {
  f7.view.current.router.navigate('/project/new/')
}

usePullToRefresh(
  () => screenEl.value,
  () => ptrIndicator.value,
  () => store.loadData(),
  () => store.cardDragging
)

function onKeyDown(e) {
  if (e.key === 'r' && !e.metaKey && !e.ctrlKey && document.activeElement.tagName !== 'INPUT') {
    store.loadData()
  }
}

function triggerSubmissionStatuses() {
  const items = store.displayProjects.map(p => ({
    id: p.id,
    submissionUrl: store.projectSubmissionTask(p.id)?.content?.trim() || '',
  }))
  reviewsStore.loadSubmissionStatuses(items)
}

onMounted(async () => {
  store.initStages()
  await store.loadIfStale()
  boardReady.value = true
  triggerSubmissionStatuses()
  const projectId = new URLSearchParams(location.search).get('project')
  if (projectId) f7.view.current.router.navigate(`/project/${projectId}/`)
  const stageId = new URLSearchParams(location.search).get('stage')
  if (stageId && store.stages) {
    const idx = store.stages.findIndex(s => s.id === stageId)
    if (idx !== -1) {
      const col = document.querySelector(`.col[data-stage="${idx}"]`)
      if (col) col.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' })
    }
  }
  document.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown)
})
</script>
