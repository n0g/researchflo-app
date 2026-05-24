<template>
  <f7-page name="new-project" class="project-page">
    <div class="project-screen">
      <AppSidebar current-page="board" />

      <div class="project-main">
        <button
          v-if="sidebarCollapsed"
          class="sidebar-expand-btn"
          title="Expand sidebar"
          aria-label="Expand sidebar"
          @click="toggleSidebar"
        >
          <i class="ph ph-sidebar-simple" aria-hidden="true"></i>
        </button>

        <section class="project-meta">
          <button class="back-btn" aria-label="Back" @click="goBack">
            <i class="ph ph-arrow-left" aria-hidden="true"></i>
          </button>

          <textarea
            ref="titleInputEl"
            v-model="titleDraft"
            class="project-title project-title-input"
            rows="2"
            placeholder="Project title…"
            :disabled="creating"
            @keydown.enter.prevent="create"
            @keydown.meta.enter.prevent="create"
            @keydown.escape.prevent="goBack"
          ></textarea>

          <!-- Stage selector -->
          <div v-if="store.stages?.length" class="meta-section">
            <div class="meta-label">Stage</div>
            <div class="new-project-stages">
              <button
                v-for="stage in store.stages"
                :key="stage.id"
                class="new-project-stage-btn"
                :class="{ selected: selectedStageId === stage.id }"
                :disabled="creating"
                @click="selectedStageId = stage.id"
              >
                <i :class="`ph ph-${getStageIcon(stage)}`" aria-hidden="true"></i>
                {{ stage.name }}
              </button>
            </div>
          </div>

          <div class="new-project-actions">
            <p v-if="errorMsg" class="new-project-error">{{ errorMsg }}</p>
            <button class="btn-create-project" :disabled="!titleDraft.trim() || creating" @click="create">
              <span v-if="creating">Creating…</span>
              <span v-else><i class="ph ph-plus" aria-hidden="true"></i> Create project</span>
            </button>
          </div>
        </section>

        <section class="project-tasks">
          <div class="no-tasks" style="color: var(--text3); font-size: 14px; padding: 32px 24px;">
            Fill in the title and hit Create.
          </div>
        </section>
      </div>
    </div>
  </f7-page>
</template>

<script setup>
import { ref, nextTick, onMounted } from 'vue'
import { f7 } from 'framework7-vue/bundle'
import { useBoardStore } from '../stores/board.js'
import { useSidebar } from '../composables/useSidebar.js'
import { getStageIcon } from '../lib/helpers.js'
import AppSidebar from '../components/AppSidebar.vue'

const store = useBoardStore()
const { sidebarCollapsed, toggleSidebar } = useSidebar()

const titleInputEl = ref(null)
const titleDraft = ref('')
const selectedStageId = ref(null)
const creating = ref(false)
const errorMsg = ref('')

onMounted(async () => {
  store.initStages()
  await store.loadIfStale()
  selectedStageId.value = store.stages?.[0]?.id ?? null
  await nextTick()
  titleInputEl.value?.focus()
})

async function create() {
  const name = titleDraft.value.trim()
  if (!name || creating.value) return
  creating.value = true
  errorMsg.value = ''
  try {
    const project = await store.createProject(name, selectedStageId.value)
    f7.view.current.router.navigate(`/project/${project.id}/`)
  } catch (e) {
    console.error('[NewProject] create failed:', e)
    errorMsg.value = e.message || 'Failed to create project.'
    creating.value = false
  }
}

function goBack() { f7.view.current.router.back() }
</script>
