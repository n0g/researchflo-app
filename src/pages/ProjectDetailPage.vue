<template>
  <f7-page name="project-detail" class="project-page">
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

        <!-- Left metadata pane -->
        <section class="project-meta" :class="{ 'project-meta-collapsed': sidebarCollapsed }">
          <button class="back-btn" aria-label="Back" @click="goBack">
            <i class="ph ph-arrow-left" aria-hidden="true"></i>
          </button>

          <div class="project-title-row">
            <h1
              v-if="!editingTitle"
              class="project-title project-title-editable"
              role="button"
              tabindex="0"
              aria-label="Edit project title"
              @click="startEditTitle"
              @keydown.enter.prevent="startEditTitle"
              @keydown.space.prevent="startEditTitle"
            >{{ project?.name ?? 'Loading…' }}</h1>
            <textarea
              v-else
              ref="titleInputEl"
              v-model="titleDraft"
              class="project-title project-title-input"
              rows="2"
              aria-label="Project title"
              @blur="saveTitle"
              @keydown.meta.enter.prevent="titleInputEl?.blur()"
              @keydown.escape.prevent="cancelTitle"
            ></textarea>
            <button
              class="card-energy-btn"
              :class="{ 'energy-low': energyLevel === 1, 'energy-high': energyLevel === 2 }"
              :aria-label="energyLevel === 2 ? 'Full focus — click to clear' : energyLevel === 1 ? 'Some attention — click to increase' : 'No focus — click to set'"
              @click="store.cycleEnergy(projectId)"
            >
              <i :class="energyLevel === 2 ? 'ph ph-battery-charging' : energyLevel === 1 ? 'ph ph-battery-low' : 'ph ph-battery-empty'" aria-hidden="true"></i>
            </button>
          </div>

          <!-- Collaborators (first after title) -->
          <div class="meta-section">
            <div class="meta-label">Collaborators</div>
            <div class="collab-chips">
              <span v-for="member in personLabels" :key="member.id" class="collab-chip">
                <i class="ph ph-user" aria-hidden="true"></i>
                {{ member.display_name }}
                <button v-if="isProjectOwner && !member.isOwner" class="collab-chip-remove" :aria-label="`Remove ${member.display_name}`" @click.stop="removeCollab(member.id)"><i class="ph ph-x" aria-hidden="true"></i></button>
              </span>
              <button v-if="!addingCollab" class="collab-add-pill" aria-label="Add collaborator" @click.stop="startAddCollab"><i class="ph ph-plus" aria-hidden="true"></i></button>
              <div v-else ref="collabWrapperEl" class="collab-combo-wrapper">
                <input
                  ref="collabInputEl"
                  v-model="collabQuery"
                  class="collab-combo-input"
                  placeholder="Name…"
                  aria-label="Collaborator name"
                  aria-autocomplete="list"
                  :aria-expanded="filteredCollabs.length > 0"
                  autocomplete="off"
                  @keydown.enter.prevent="commitCollab(collabQuery)"
                  @keydown.escape.prevent="cancelAddCollab"
                  @keydown.down.prevent="focusCollabOption(0)"
                >
                <div v-if="filteredCollabs.length" class="popup-dropdown" role="listbox" aria-label="Collaborator suggestions">
                  <button
                    v-for="(c, idx) in filteredCollabs"
                    :key="c.id"
                    class="popup-option"
                    role="option"
                    :aria-selected="false"
                    @mousedown.prevent
                    @click="commitCollab(c.display_name)"
                    @keydown.down.prevent="focusCollabOption(idx + 1)"
                    @keydown.up.prevent="idx === 0 ? collabInputEl?.focus() : focusCollabOption(idx - 1)"
                    @keydown.escape.prevent="cancelAddCollab"
                  >{{ c.display_name }}</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Status -->
          <div class="meta-section">
            <div class="meta-label">Status</div>
            <div
              v-if="!editingStatus"
              class="meta-editable"
              :class="{ placeholder: !statusText }"
              role="button"
              tabindex="0"
              aria-label="Edit status"
              @click="startEdit('status')"
              @keydown.enter.prevent="startEdit('status')"
              @keydown.space.prevent="startEdit('status')"
            >{{ statusText || 'Add a status…' }}</div>
            <textarea
              v-else
              ref="statusTextareaEl"
              v-model="statusDraft"
              class="meta-textarea"
              rows="3"
              aria-label="Status"
              @blur="saveStatus"
              @keydown.escape.prevent="cancelStatus"
              @keydown.meta.enter.prevent="statusTextareaEl?.blur()"
            ></textarea>
          </div>

          <!-- Stage -->
          <div class="meta-section">
            <div class="meta-label">Pipeline Stage</div>
            <div ref="stageWrapperEl" class="popup-wrapper">
              <button
                class="popup-btn"
                aria-haspopup="listbox"
                :aria-expanded="stagePopupOpen"
                @click.stop="stagePopupOpen = !stagePopupOpen"
              >
                <i :class="`ph ph-${getStageIcon(stageInfo)}`" class="stage-popup-icon" aria-hidden="true"></i>
                <span>{{ stageInfo?.name ?? 'Unassigned' }}</span>
                <i class="ph ph-caret-down popup-chevron" aria-hidden="true"></i>
              </button>
              <div v-if="stagePopupOpen" class="popup-dropdown" role="listbox" :aria-label="'Pipeline stage: ' + (stageInfo?.name ?? 'Unassigned')">
                <button
                  v-for="stage in store.stages"
                  :key="stage.id"
                  class="popup-option"
                  role="option"
                  :aria-selected="stageInfo?.id === stage.id"
                  :class="{ selected: stageInfo?.id === stage.id }"
                  @click="selectStage(stage)"
                >
                  <i :class="`ph ph-${getStageIcon(stage)}`" aria-hidden="true"></i>
                  {{ stage.name }}
                </button>
              </div>
            </div>
          </div>

          <!-- Venue + Deadline side by side -->
          <div class="meta-row-pair">
            <!-- Venue (left) -->
            <div class="meta-section">
              <div class="meta-label">Venue</div>
              <div
                v-if="!editingVenue"
                class="meta-editable"
                :class="{ placeholder: !venueText }"
                role="button"
                tabindex="0"
                aria-label="Edit venue"
                @click="startEditVenue"
                @keydown.enter.prevent="startEditVenue"
                @keydown.space.prevent="startEditVenue"
              >{{ venueText || 'Add venue…' }}</div>
              <input
                v-else
                ref="venueInputEl"
                v-model="venueDraft"
                class="meta-input"
                type="text"
                placeholder="e.g. PETS 2026"
                aria-label="Venue"
                @blur="saveVenue"
                @keydown.enter.prevent="venueInputEl?.blur()"
                @keydown.escape.prevent="cancelVenue"
              >
            </div>

            <!-- Deadline (right) -->
            <div class="meta-section">
              <div class="meta-label">Deadline</div>
              <template v-if="!editingDeadline">
                <div class="deadline-view-row">
                  <div
                    class="meta-editable"
                    :class="[{ placeholder: !deadlineDateValue }, deadlineDateClass]"
                    role="button"
                    tabindex="0"
                    aria-label="Edit deadline"
                    @click="startEditDeadline"
                    @keydown.enter.prevent="startEditDeadline"
                    @keydown.space.prevent="startEditDeadline"
                  >{{ formattedDeadline || 'Add deadline…' }}</div>
                  <button
                    v-if="deadlineDateValue"
                    class="deadline-clear-btn"
                    aria-label="Remove deadline"
                    @click="store.setDeadlineDate(projectId, '').catch(console.error)"
                  ><i class="ph ph-x" aria-hidden="true"></i></button>
                </div>
              </template>
              <template v-else>
                <div class="deadline-input-row">
                  <input
                    ref="dateInputEl"
                    class="meta-date-visible"
                    type="date"
                    :value="deadlineDateValue"
                    aria-label="Deadline date"
                    @change="onDeadlineChange"
                    @blur="stopEditDeadline"
                    @keydown.escape.prevent="stopEditDeadline"
                    @keydown.enter.prevent="dateInputEl?.blur()"
                  >
                  <button
                    v-if="deadlineDateValue"
                    class="deadline-clear-btn"
                    aria-label="Remove deadline"
                    @mousedown.prevent
                    @click="store.setDeadlineDate(projectId, '').catch(console.error); stopEditDeadline()"
                  ><i class="ph ph-x" aria-hidden="true"></i></button>
                </div>
              </template>
            </div>
          </div>

          <!-- Submission URL + status -->
          <div class="meta-section">
            <div class="meta-label">Submission</div>
            <div class="submission-url-row">
              <div
                v-if="!editingSubmission"
                class="meta-editable submission-url-text"
                :class="{ placeholder: !submissionUrl }"
                role="button"
                tabindex="0"
                aria-label="Edit submission URL"
                @click="startEditSubmission"
                @keydown.enter.prevent="startEditSubmission"
                @keydown.space.prevent="startEditSubmission"
              >{{ submissionUrlDisplay || 'Add submission URL…' }}</div>
              <input
                v-else
                ref="submissionInputEl"
                v-model="submissionDraft"
                class="meta-input"
                type="url"
                placeholder="https://…"
                aria-label="Submission URL"
                @blur="saveSubmission"
                @keydown.enter.prevent="submissionInputEl?.blur()"
                @keydown.escape.prevent="cancelSubmission"
              >
              <a
                v-if="submissionUrl && !editingSubmission"
                :href="submissionUrl"
                class="submission-open-btn external"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open submission in new tab"
              ><i class="ph ph-arrow-square-out" aria-hidden="true"></i></a>
            </div>
            <div v-if="submissionUrl && matchedSite" class="submission-status">
              <div v-if="submissionStatusLoading" class="submission-status-loading">
                <i class="ph ph-arrow-clockwise spin-icon" aria-hidden="true"></i>
                Checking…
              </div>
              <div v-else-if="submissionStatusError" class="submission-status-chips">
                <span class="sub-chip sub-chip-gray" :title="submissionStatusError">
                  <i class="ph ph-question" aria-hidden="true"></i>
                  Status unavailable
                </span>
              </div>
              <div v-else-if="submissionStatusData" class="submission-status-chips">
                <span class="sub-chip" :class="statusChipClass(submissionStatusData.status)">
                  <i :class="`ph ph-${statusChipIcon(submissionStatusData.status)}`" aria-hidden="true"></i>
                  {{ submissionStatusData.status }}
                </span>
              </div>
              <div v-else-if="!paperIdFromUrl" class="submission-status-hint">No paper ID found in URL</div>
            </div>
          </div>

          <!-- Summary -->
          <div class="meta-section">
            <div class="meta-label">Summary</div>
            <div
              v-if="!editingSummary"
              class="meta-editable"
              :class="{ placeholder: !summaryText }"
              role="button"
              tabindex="0"
              aria-label="Edit summary"
              @click="startEdit('summary')"
              @keydown.enter.prevent="startEdit('summary')"
              @keydown.space.prevent="startEdit('summary')"
            >{{ summaryText || 'Add a summary…' }}</div>
            <textarea
              v-else
              ref="summaryTextareaEl"
              v-model="summaryDraft"
              class="meta-textarea"
              rows="4"
              aria-label="Summary"
              @blur="saveSummary"
              @keydown.escape.prevent="cancelSummary"
              @keydown.meta.enter.prevent="summaryTextareaEl?.blur()"
            ></textarea>
          </div>

          <!-- Delete -->
          <div v-if="project" class="project-meta-footer">
            <button class="project-delete-btn" title="Delete project" aria-label="Delete project" @click="confirmDelete">
              <i class="ph ph-trash" aria-hidden="true"></i>
            </button>
          </div>
        </section>

        <!-- Right tasks pane -->
        <section class="project-tasks" aria-label="Project tasks" @keydown="handleTasksKey">
          <transition name="celebration">
            <div v-if="showCelebration" class="tasks-celebration" aria-live="polite">
              <i class="ph ph-confetti" aria-hidden="true"></i>
              <p>All done. On to new adventures.</p>
            </div>
          </transition>
          <div class="tasks-header">
            <div class="tasks-title">Project Tasks</div>
            <div class="tasks-subtitle">{{ tasks.length }} open task{{ tasks.length !== 1 ? 's' : '' }}</div>
          </div>

          <div
            ref="taskListEl"
            role="list"
            aria-label="Project tasks"
            @pointerdown="onDragStart"
          >
            <template v-for="(task, idx) in tasks" :key="task.id">
              <div v-if="dragId && dropIndex === idx" class="task-drop-indicator" aria-hidden="true" />
              <TaskItem :task="task" :class="{ 'is-dragging': dragId === task.id }" />
            </template>
            <div v-if="dragId && dropIndex === tasks.length" class="task-drop-indicator" aria-hidden="true" />
          </div>

          <!-- Quick-add -->
          <div class="task-quick-add-wrap" :class="{ 'task-quick-add-wrap-sep': tasks.length }">
            <div
              v-if="!addingTask"
              class="task-quick-add-row"
              role="button"
              tabindex="0"
              @click="startAddTask"
              @keydown.enter.prevent="startAddTask"
              @keydown.space.prevent="startAddTask"
            >
              <div class="task-handle-spacer" aria-hidden="true"></div>
              <div class="task-quick-add-btn" aria-hidden="true">
                <i class="ph ph-plus"></i>
              </div>
              <span class="task-quick-add-label">Add task</span>
            </div>
            <div v-else class="task-quick-add-row task-quick-add-editing">
              <div class="task-handle-spacer" aria-hidden="true"></div>
              <div class="task-quick-add-btn" aria-hidden="true">
                <i class="ph ph-plus"></i>
              </div>
              <input
                ref="quickAddInputEl"
                v-model="newTaskContent"
                class="quick-add-input"
                type="text"
                placeholder="Task name"
                @keydown.enter.prevent="submitAddTask"
                @keydown.escape.stop="cancelAddTask"
                @blur="onQuickAddBlur"
              >
            </div>
          </div>

        </section>
      </div>
    </div>

  </f7-page>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { f7 } from 'framework7-vue/bundle'
import { useBoardStore } from '../stores/board.js'
import { useAuthStore } from '../stores/auth.js'
import { useReviewsStore } from '../stores/reviews.js'
import { useSidebar } from '../composables/useSidebar.js'
import { getStageIcon } from '../lib/helpers.js'
import { fetchPaperStatus, extractPaperId, matchSiteForUrl } from '../lib/hotcrp.js'

import AppSidebar from '../components/AppSidebar.vue'
import TaskItem from '../components/TaskItem.vue'

const props = defineProps({
  f7route: { type: Object, required: true },
})

const store = useBoardStore()
const authStore = useAuthStore()
const reviewsStore = useReviewsStore()
const { sidebarCollapsed, toggleSidebar } = useSidebar()
const newTaskContent = ref('')
const addingTask = ref(false)
const quickAddInputEl = ref(null)

const projectId = computed(() => props.f7route.params.id)
const project = computed(() => store.displayProjects.find(p => p.id === projectId.value) ?? null)
const energyLevel = computed(() => store.projectEnergy(projectId.value))

function _getMonday(d) {
  const day = new Date(d); const dow = day.getDay()
  day.setDate(day.getDate() + (dow === 0 ? -6 : 1 - dow)); day.setHours(0,0,0,0); return day
}

const stageInfo = computed(() => store.projectStage(projectId.value))
const meta = computed(() => store.projectMeta(projectId.value))
const tasks = computed(() => store.projectTasks(projectId.value))

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
  dropIndex.value = tasks.value.findIndex(t => t.id === id)
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
  const fromIdx = tasks.value.findIndex(t => t.id === dragId.value)
  let toIdx = dropIndex.value > fromIdx ? dropIndex.value - 1 : dropIndex.value
  toIdx = Math.max(0, Math.min(tasks.value.length - 1, toIdx))
  if (fromIdx !== toIdx) {
    const ordered = [...tasks.value]
    const [moved] = ordered.splice(fromIdx, 1)
    ordered.splice(toIdx, 0, moved)
    await store.reorderTasks(ordered.map(t => t.id)).catch(console.error)
  }
  dragId.value = null
  dropIndex.value = -1
}
const deadlineTask = computed(() => store.projectDeadlineTaskBase(projectId.value))
const deadline = computed(() => store.projectDeadline(projectId.value))

const isProjectOwner = computed(() => project.value?.owner_id === authStore.user?.id)

const personLabels = computed(() => {
  const myId = store.myPeopleId
  const seen = new Set()
  const items = []
  const op = project.value?.owner_person
  if (op && op.id !== myId) {
    seen.add(op.id)
    items.push({ ...op, isOwner: true })
  }
  for (const m of (project.value?.members || [])) {
    if (!m.person || m.person.id === myId || seen.has(m.person.id)) continue
    seen.add(m.person.id)
    items.push({ ...m.person, isOwner: false })
  }
  return items
})

// ── Deadline ──
const editingDeadline = ref(false)
const dateInputEl = ref(null)

async function startEditDeadline() {
  editingDeadline.value = true
  await nextTick()
  dateInputEl.value?.focus()
  dateInputEl.value?.showPicker?.()
}

function stopEditDeadline() { editingDeadline.value = false }

const formattedDeadline = computed(() => {
  if (!deadlineDateValue.value) return ''
  const [y, m, d] = deadlineDateValue.value.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
})

const deadlineDateValue = computed(() => {
  if (!deadline.value) return ''
  const d = deadline.value
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})

const deadlineDateClass = computed(() => {
  if (!deadline.value) return ''
  const diff = deadline.value.getTime() - Date.now()
  if (diff < 0) return 'overdue-text'
  if (diff < 7 * 86400000) return 'due-soon-text'
  return ''
})

async function onDeadlineChange(e) {
  await store.setDeadlineDate(projectId.value, e.target.value).catch(console.error)
  editingDeadline.value = false
}

// ── Venue ──
const venueText = computed(() => deadlineTask.value?.content ?? '')
const editingVenue = ref(false)
const venueDraft = ref('')
const venueInputEl = ref(null)

async function startEditVenue() {
  venueDraft.value = venueText.value
  editingVenue.value = true
  await nextTick()
  venueInputEl.value?.focus()
  venueInputEl.value?.select()
}

async function saveVenue() {
  editingVenue.value = false
  const val = venueDraft.value.trim()
  if (val !== venueText.value) {
    await store.updateVenue(projectId.value, val).catch(console.error)
  }
}

function cancelVenue() { editingVenue.value = false }

// ── Title ──
const editingTitle = ref(false)
const titleDraft = ref('')
const titleInputEl = ref(null)

async function startEditTitle() {
  if (!project.value) return
  titleDraft.value = project.value.name
  editingTitle.value = true
  await nextTick()
  titleInputEl.value?.focus()
  titleInputEl.value?.select()
}

async function saveTitle() {
  editingTitle.value = false
  const val = titleDraft.value.trim()
  if (val && val !== project.value?.name) {
    await store.renameProject(projectId.value, val).catch(console.error)
  }
}

function cancelTitle() { editingTitle.value = false }

// ── Status ──
const statusText = computed(() => project.value?.status_text ?? '')
const editingStatus = ref(false)
const statusDraft = ref('')
const statusTextareaEl = ref(null)

async function startEdit(field) {
  if (field === 'status') {
    statusDraft.value = statusText.value
    editingStatus.value = true
    await nextTick()
    statusTextareaEl.value?.focus()
    statusTextareaEl.value?.select()
  } else {
    summaryDraft.value = summaryText.value
    editingSummary.value = true
    await nextTick()
    summaryTextareaEl.value?.focus()
    summaryTextareaEl.value?.select()
  }
}

async function saveStatus() {
  editingStatus.value = false
  const val = statusDraft.value.trim() || statusText.value
  if (val !== statusText.value && project.value) {
    await store.updateStatusText(projectId.value, val).catch(console.error)
  }
}
function cancelStatus() { editingStatus.value = false }

// ── Summary (Todoist 📌 Summary section) ──
const summaryText = computed(() => store.projectSummaryTask(projectId.value)?.content ?? '')
const editingSummary = ref(false)
const summaryDraft = ref('')
const summaryTextareaEl = ref(null)

async function saveSummary() {
  editingSummary.value = false
  const val = summaryDraft.value.trim()
  if (val !== summaryText.value) {
    await store.updateSummary(projectId.value, val).catch(console.error)
  }
}
function cancelSummary() { editingSummary.value = false }

// ── Submission URL (Todoist 📌 Submission section) ──
const submissionUrl = computed(() => {
  const t = store.projectSubmissionTask(projectId.value)
  const raw = t?.content?.trim() || ''
  // Todoist may auto-format the URL as a markdown link: [title](url)
  const mdMatch = raw.match(/\[.*?\]\((https?:\/\/[^)]+)\)/)
  return mdMatch ? mdMatch[1] : raw
})
const submissionUrlDisplay = computed(() =>
  submissionUrl.value.replace(/^https?:\/\/(www\.)?/, '')
)

const editingSubmission = ref(false)
const submissionDraft = ref('')
const submissionInputEl = ref(null)

async function startEditSubmission() {
  submissionDraft.value = submissionUrl.value
  editingSubmission.value = true
  await nextTick()
  submissionInputEl.value?.focus()
  submissionInputEl.value?.select()
}

async function saveSubmission() {
  editingSubmission.value = false
  const val = submissionDraft.value.trim()
  if (val !== submissionUrl.value) {
    await store.updateSubmissionUrl(projectId.value, val).catch(console.error)
  }
}
function cancelSubmission() { editingSubmission.value = false }

// ── Submission status (HotCRP) ──
const paperIdFromUrl = computed(() => submissionUrl.value ? extractPaperId(submissionUrl.value) : null)
const matchedSite = computed(() => matchSiteForUrl(reviewsStore.sites, submissionUrl.value))

const submissionStatusLoading = ref(false)
const submissionStatusError = ref(null)
const submissionStatusData = ref(null)

async function loadSubmissionStatus() {
  const site = matchedSite.value
  const pid = paperIdFromUrl.value
  if (!site || !pid) { submissionStatusData.value = null; return }
  submissionStatusLoading.value = true
  submissionStatusError.value = null
  submissionStatusData.value = null
  try {
    const paper = await fetchPaperStatus(site.url, pid, site.token)
    if (!paper) { submissionStatusError.value = 'Paper not found'; return }
    submissionStatusData.value = {
      status: paper.status || (paper.submitted ? 'submitted' : 'not submitted'),
    }
  } catch (e) {
    submissionStatusError.value = e.message || 'Failed to fetch status'
  } finally {
    submissionStatusLoading.value = false
  }
}

function statusChipClass(status) {
  if (!status) return 'sub-chip-gray'
  const s = status.toLowerCase()
  if (s.includes('accept')) return 'sub-chip-green'
  if (s.includes('reject')) return 'sub-chip-red'
  if (s.includes('submit')) return 'sub-chip-blue'
  return 'sub-chip-gray'
}

function statusChipIcon(status) {
  if (!status) return 'circle'
  const s = status.toLowerCase()
  if (s.includes('accept')) return 'check-circle'
  if (s.includes('reject')) return 'x-circle'
  if (s.includes('submit')) return 'file-arrow-up'
  return 'circle'
}

watch([submissionUrl, matchedSite], ([url, site]) => {
  if (url && site && extractPaperId(url)) loadSubmissionStatus()
  else { submissionStatusData.value = null; submissionStatusError.value = null }
})

// ── Stage popup ──
const stageWrapperEl = ref(null)
const stagePopupOpen = ref(false)

async function selectStage(stage) {
  stagePopupOpen.value = false
  if (stageInfo.value?.id === stage.id) return
  await store.moveStage(projectId.value, null, stageInfo.value?.id ?? null, stage.id).catch(console.error)
}

// ── Collaborator combo ──
const addingCollab = ref(false)
const collabQuery = ref('')
const collabInputEl = ref(null)
const collabWrapperEl = ref(null)

const filteredCollabs = computed(() => {
  const q = collabQuery.value.toLowerCase()
  const myId = store.myPeopleId
  const existingIds = new Set(personLabels.value.map(p => p.id))
  return store.allPeople
    .filter(p => !existingIds.has(p.id) && p.id !== myId && (!q || p.display_name.toLowerCase().includes(q)))
    .slice(0, 8)
})

function focusCollabOption(idx) {
  const opts = collabWrapperEl.value?.querySelectorAll('.popup-option')
  if (opts && idx >= 0 && idx < opts.length) opts[idx].focus()
}

async function startAddCollab() {
  addingCollab.value = true
  collabQuery.value = ''
  await nextTick()
  collabInputEl.value?.focus()
}

async function commitCollab(name) {
  const trimmed = typeof name === 'string' ? name.trim() : name?.display_name?.trim() ?? ''
  const alreadyAdded = personLabels.value.some(p => p.display_name.toLowerCase() === trimmed.toLowerCase())
  if (trimmed && !alreadyAdded) {
    await store.addCollaborator(projectId.value, trimmed).catch(console.error)
  }
  cancelAddCollab()
}

function cancelAddCollab() {
  addingCollab.value = false
  collabQuery.value = ''
}

async function removeCollab(personId) {
  await store.removeCollaborator(projectId.value, personId).catch(console.error)
}

// Close popups on outside click
function onDocClick(e) {
  if (!stageWrapperEl.value?.contains(e.target)) stagePopupOpen.value = false
  if (!collabWrapperEl.value?.contains(e.target)) cancelAddCollab()
}

// ── Task keyboard navigation ──
function handleTasksKey(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return
  const taskEl = e.target.closest('.task-item')
  if (!taskEl) return
  const allItems = [...document.querySelectorAll('.project-tasks .task-item')]
  const idx = allItems.indexOf(taskEl)
  if (idx === -1) return
  if (e.key === 'ArrowDown' && idx < allItems.length - 1) {
    e.preventDefault()
    allItems[idx + 1].querySelector('[tabindex="0"]')?.focus()
  } else if (e.key === 'ArrowUp' && idx > 0) {
    e.preventDefault()
    allItems[idx - 1].querySelector('[tabindex="0"]')?.focus()
  }
}

// ── Celebration ──
const showCelebration = ref(false)
const prevTaskCount = ref(-1)
let celebrationTimer = null

watch(tasks, (newVal) => {
  const prev = prevTaskCount.value
  prevTaskCount.value = newVal.length
  if (prev > 0 && newVal.length === 0) {
    showCelebration.value = true
    clearTimeout(celebrationTimer)
    celebrationTimer = setTimeout(() => { showCelebration.value = false }, 2500)
  }
})

// ── Tasks ──
function startAddTask() {
  addingTask.value = true
  nextTick(() => quickAddInputEl.value?.focus())
}

function cancelAddTask() {
  addingTask.value = false
  newTaskContent.value = ''
}

async function submitAddTask() {
  const content = newTaskContent.value.trim()
  if (!content) { cancelAddTask(); return }
  if (!project.value) return
  newTaskContent.value = ''
  await store.quickAddTask(content, project.value.id).catch(console.error)
  nextTick(() => quickAddInputEl.value?.focus())
}

function onQuickAddBlur() {
  const content = newTaskContent.value.trim()
  if (content && project.value) store.quickAddTask(content, project.value.id).catch(console.error)
  newTaskContent.value = ''
  addingTask.value = false
}

// ── Delete project ──
async function confirmDelete() {
  if (!project.value) return
  if (!window.confirm(`Delete "${project.value.name}"? This cannot be undone.`)) return
  await store.deleteProject(projectId.value).catch(console.error)
  f7.view.current.router.back()
}

// ── Navigation ──
function goBack() { f7.view.current.router.back() }

onMounted(async () => {
  document.addEventListener('click', onDocClick)
  store.initStages()
  await store.loadIfStale()
  if (submissionUrl.value && matchedSite.value && paperIdFromUrl.value) loadSubmissionStatus()
})

onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  clearTimeout(celebrationTimer)
})
</script>
