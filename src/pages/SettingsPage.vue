<template>
  <f7-page name="settings" class="settings-page" no-swipeback>
    <div class="settings-screen">
      <AppSidebar current-page="settings" />

      <div class="settings-main">
        <button
          v-if="sidebarCollapsed"
          class="sidebar-expand-btn"
          title="Expand sidebar"
          aria-label="Expand sidebar"
          @click="toggleSidebar"
        >
          <i class="ph ph-sidebar-simple" aria-hidden="true"></i>
        </button>

        <div class="settings-content">
          <h1 class="settings-page-title">Settings</h1>

          <!-- ── Appearance ── -->
          <div class="settings-section">
            <div class="settings-section-title">Appearance</div>
            <div class="settings-row-group">
              <div class="settings-row">
                <span class="settings-row-label">Accent color</span>
                <input
                  type="color"
                  class="venue-color-picker"
                  :value="accentColor"
                  @input="setAccentColor($event.target.value)"
                >
              </div>
              <div class="settings-row">
                <span class="settings-row-label">Theme</span>
                <div class="theme-segmented" role="group" aria-label="Theme">
                  <button
                    class="theme-seg-btn"
                    :class="{ active: themePref === 'auto' }"
                    :aria-pressed="themePref === 'auto'"
                    @click="setTheme('auto')"
                  >Auto</button>
                  <button
                    class="theme-seg-btn"
                    :class="{ active: themePref === 'light' }"
                    :aria-pressed="themePref === 'light'"
                    @click="setTheme('light')"
                  >Light</button>
                  <button
                    class="theme-seg-btn"
                    :class="{ active: themePref === 'dark' }"
                    :aria-pressed="themePref === 'dark'"
                    @click="setTheme('dark')"
                  >Dark</button>
                </div>
              </div>
            </div>
          </div>

          <!-- ── Pipeline Stages ── -->
          <div class="settings-section">
            <div class="settings-section-title">Pipeline Stages</div>
            <div class="settings-card">
              <p class="settings-hint">Drag to reorder. Order determines column order on the board.</p>

              <div ref="rowsEl" class="stage-rows">
                <div
                  v-for="(row, i) in stageRows"
                  :key="row.key"
                  class="stage-row"
                  :data-index="i"
                >
                  <span class="handle" aria-hidden="true" title="drag to reorder">⠿</span>
                  <div class="icon-picker-wrap" @click.stop>
                    <button
                      class="icon-picker-btn"
                      :aria-label="'Stage icon: ' + (row.icon || 'kanban')"
                      :title="'Choose icon'"
                      @click="toggleIconPicker(row.key)"
                    ><i :class="`ph ph-${row.icon || 'kanban'}`" aria-hidden="true"></i></button>
                    <div v-if="openIconPickerKey === row.key" class="icon-picker-dropdown">
                      <button
                        v-for="icon in STAGE_ICONS"
                        :key="icon"
                        class="icon-option"
                        :class="{ selected: row.icon === icon }"
                        :aria-label="icon"
                        :title="icon"
                        @click="selectIcon(row, icon)"
                      ><i :class="`ph ph-${icon}`" aria-hidden="true"></i></button>
                    </div>
                  </div>
                  <input
                    type="text"
                    placeholder="Stage name"
                    aria-label="Stage name"
                    v-model="row.name"
                    class="stage-name-input"
                  >
                  <button class="del" :aria-label="'Remove stage ' + row.name" @click="stageRows.splice(i, 1)"><i class="ph ph-x" aria-hidden="true"></i></button>
                </div>
              </div>

              <div v-if="stageError" class="error-msg" role="alert">{{ stageError }}</div>
              <div class="settings-actions">
                <button class="btn sm" @click="addStageRow">+ Add stage</button>
                <button class="btn sm primary" :disabled="savingStages" @click="saveStages">
                  {{ savingStages ? 'Saving…' : 'Save stages' }}
                </button>
              </div>
            </div>
          </div>

          <!-- ── Collaborators ── -->
          <div class="settings-section">
            <div class="settings-section-title">Collaborators</div>
            <div class="settings-card">
              <p class="settings-hint">People in your projects who haven't joined yet. Add their email and copy the invite link to send them.</p>
              <div v-if="!pendingCollaborators.length" class="settings-empty">Everyone is already on the platform.</div>
              <div v-else class="collab-invite-rows">
                <div v-for="person in pendingCollaborators" :key="person.id" class="collab-invite-row">
                  <span class="collab-invite-name">{{ person.display_name }}</span>
                  <input
                    class="collab-invite-email"
                    type="email"
                    :value="person.email || ''"
                    placeholder="email address"
                    @change="onEmailChange(person, $event.target.value)"
                    @keydown.enter.prevent="$event.target.blur()"
                  />
                  <button
                    class="collab-invite-copy"
                    :title="inviteCopied === person.id ? 'Copied!' : 'Copy invite link'"
                    :aria-label="inviteCopied === person.id ? 'Copied!' : 'Copy invite link'"
                    @click="copyInviteLink(person)"
                  >
                    <i :class="inviteCopied === person.id ? 'ph ph-check' : 'ph ph-link-simple'" aria-hidden="true"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- ── Review Sites ── -->
          <div class="settings-section">
            <div class="settings-section-title">Review Sites</div>
            <div class="settings-card">
              <div class="settings-subsection-label">Configured Sites</div>
              <div v-if="!reviewsStore.sites.length" class="settings-empty">No sites configured yet.</div>
              <div v-else class="site-rows">
                <div v-for="site in reviewsStore.sites" :key="site.id" class="site-row">
                  <div class="site-info">
                    <div class="site-name-text">{{ site.name }}</div>
                    <div class="site-url-text">{{ site.url }}</div>
                  </div>
                  <button class="del" :aria-label="'Remove ' + site.name" @click="reviewsStore.removeSite(site.id)"><i class="ph ph-x" aria-hidden="true"></i></button>
                </div>
              </div>

              <div class="settings-subsection-label" style="margin-top: 24px">Add Site</div>
              <input
                type="url"
                v-model="newSiteUrl"
                placeholder="https://hotcrp.example.org"
                aria-label="Site URL"
                @keydown.enter.prevent="newSiteTokenEl?.focus()"
              >
              <input
                ref="newSiteTokenEl"
                type="text"
                v-model="newSiteToken"
                placeholder="API key (Profile → API tokens in HotCRP)"
                aria-label="API key"
                style="margin-top: 8px"
                @keydown.enter.prevent="newSiteNameEl?.focus()"
              >
              <input
                ref="newSiteNameEl"
                type="text"
                v-model="newSiteName"
                placeholder="Display name (optional)"
                aria-label="Display name"
                style="margin-top: 8px"
                @keydown.enter.prevent="addSite"
              >
              <div v-if="siteError" class="error-msg" role="alert" style="margin-top: 10px">{{ siteError }}</div>
              <div class="settings-actions" style="margin-top: 12px">
                <button class="btn sm primary" @click="addSite">Add site</button>
              </div>
            </div>
          </div>

          <!-- ── Google Calendar ── -->
          <div class="settings-section">
            <div class="settings-section-title">Google Calendar</div>
            <template v-if="!calStore.isConnected">
              <div class="settings-card">
                <p class="settings-hint">Connect to schedule tasks to your Google Calendar from the Schedule page.</p>
                <template v-if="!hasBakedClientId">
                  <p class="settings-hint">
                    No Client ID configured — set <code class="inline-code">VITE_GCAL_CLIENT_ID</code> at build time,
                    or enter one manually below.
                  </p>
                  <input
                    type="text"
                    v-model="gcalClientIdDraft"
                    placeholder="Paste your Google Client ID (…apps.googleusercontent.com)"
                    aria-label="Google OAuth Client ID"
                    @keydown.enter.prevent="saveGcalClientId"
                  >
                  <div class="settings-actions" style="margin-top: 8px">
                    <button class="btn sm" @click="saveGcalClientId">Save ID</button>
                  </div>
                </template>
                <div v-if="calStore.connectError" class="error-msg" role="alert" style="margin-top: 8px">{{ calStore.connectError }}</div>
                <div class="settings-actions" style="margin-top: 8px">
                  <button class="btn sm primary" :disabled="!calStore.clientId" @click="calStore.connect()">Connect Google Calendar</button>
                </div>
              </div>
            </template>
            <template v-else>
              <div class="settings-row-group">
                <div class="settings-row">
                  <span class="settings-row-label">
                    <span class="gcal-connected-dot"></span>
                    Connected to Google Calendar
                  </span>
                  <button class="btn sm danger" @click="calStore.disconnect()">Disconnect</button>
                </div>
                <div class="settings-row">
                  <span class="settings-row-label">Calendar</span>
                  <select
                    class="cal-select"
                    :value="calStore.selectedCalendarId"
                    @change="calStore.saveCalendarId($event.target.value)"
                    @focus="calStore.fetchCalendarList()"
                  >
                    <option
                      v-if="!calStore.writableCalendars.length"
                      :value="calStore.selectedCalendarId"
                    >{{ calStore.selectedCalendarId }}</option>
                    <option
                      v-for="cal in calStore.writableCalendars"
                      :key="cal.id"
                      :value="cal.id"
                    >{{ cal.summary }}</option>
                  </select>
                </div>
              </div>
            </template>
          </div>

          <!-- ── Account ── -->
          <div class="settings-section">
            <div class="settings-section-title">Account</div>
            <div class="settings-row-group">
              <div class="settings-row">
                <span class="settings-row-label">Display name</span>
                <input
                  type="text"
                  class="settings-inline-input"
                  :value="displayName"
                  placeholder="Your name"
                  @change="onDisplayNameChange($event.target.value)"
                  @keydown.enter.prevent="$event.target.blur()"
                />
              </div>
              <div class="settings-row">
                <span class="settings-row-label">Signed in</span>
                <button class="btn sm danger" @click="signOut">Sign out</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <AppTabbar current-tab="settings" />
  </f7-page>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useBoardStore } from '../stores/board.js'
import { useAuthStore } from '../stores/auth.js'
import { useReviewsStore } from '../stores/reviews.js'
import { useCalendarStore } from '../stores/calendar.js'
import { useSidebar } from '../composables/useSidebar.js'
import { useTheme } from '../composables/useTheme.js'
import { useAccentColor } from '../composables/useAccentColor.js'
import { DEFAULT_STAGES, getStageIcon } from '../lib/helpers.js'
import { initSortable } from '../lib/sortable.js'
import AppSidebar from '../components/AppSidebar.vue'
import AppTabbar from '../components/AppTabbar.vue'

const boardStore = useBoardStore()
const reviewsStore = useReviewsStore()
const calStore = useCalendarStore()

// ── Google Calendar ──
const hasBakedClientId = !!import.meta.env.VITE_GCAL_CLIENT_ID
const gcalClientIdDraft = ref(calStore.clientId)
function saveGcalClientId() { calStore.saveClientId(gcalClientIdDraft.value) }
const { sidebarCollapsed, toggleSidebar } = useSidebar()
const { setTheme, themePref } = useTheme()
const { accentColor, setColor: setAccentColor } = useAccentColor()

// ── Stages ──
const STAGE_ICONS = [
  'compass', 'flask', 'pencil-line', 'eraser', 'paper-plane-tilt', 'snowflake',
  'lightbulb', 'ghost', 'target', 'clock', 'hourglass', 'check-circle',
  'flag', 'star', 'bookmark', 'archive', 'folder', 'kanban', 'potted-plant',
]

const rowsEl = ref(null)
let keyCounter = 0
const stageRows = ref((boardStore.stages || DEFAULT_STAGES).map(s => ({ ...s, icon: getStageIcon(s), key: keyCounter++ })))
const stageError = ref('')
const savingStages = ref(false)
const openIconPickerKey = ref(null)

function addStageRow() {
  stageRows.value.push({ name: '', icon: 'kanban', key: keyCounter++ })
}

function toggleIconPicker(key) {
  openIconPickerKey.value = openIconPickerKey.value === key ? null : key
}

function selectIcon(row, icon) {
  row.icon = icon
  openIconPickerKey.value = null
}

function closeIconPicker(e) {
  if (!e.target.closest('.icon-picker-wrap')) openIconPickerKey.value = null
}

async function saveStages() {
  const stages = stageRows.value
    .map(r => ({ id: r.id ?? null, name: r.name.trim(), icon: r.icon || 'kanban' }))
    .filter(r => r.name)
  if (!stages.length) { stageError.value = 'Add at least one stage.'; return }
  stageError.value = ''
  savingStages.value = true
  try {
    await boardStore.saveStages(stages)
    // Refresh rows from store so new IDs are picked up
    stageRows.value = (boardStore.stages || []).map(s => ({ ...s, icon: getStageIcon(s), key: keyCounter++ }))
  } finally {
    savingStages.value = false
  }
}

// ── Sites ──
const newSiteUrl = ref('')
const newSiteToken = ref('')
const newSiteName = ref('')
const newSiteTokenEl = ref(null)
const newSiteNameEl = ref(null)
const siteError = ref('')

function addSite() {
  siteError.value = ''
  const url = newSiteUrl.value.trim()
  const token = newSiteToken.value.trim()
  if (!url) { siteError.value = 'Enter a site URL.'; return }
  if (!token) { siteError.value = 'Enter an API key.'; return }
  try { new URL(url) } catch { siteError.value = 'Invalid URL — include https://'; return }
  reviewsStore.addSite(url, token, newSiteName.value)
  newSiteUrl.value = ''
  newSiteToken.value = ''
  newSiteName.value = ''
}

// ── Collaborators ──
const pendingCollaborators = ref([])
const inviteCopied = ref(null)

async function loadPending() {
  pendingCollaborators.value = await boardStore.loadPendingCollaborators().catch(() => [])
}

function copyInviteLink(person) {
  const base = window.location.origin + window.location.pathname
  const url = `${base}?invite=${person.invite_token}`
  navigator.clipboard.writeText(url)
  inviteCopied.value = person.id
  setTimeout(() => { inviteCopied.value = null }, 2000)
}

async function onEmailChange(person, value) {
  await boardStore.savePersonEmail(person.id, value).catch(console.error)
  person.email = value.trim() || null
}

// ── Account ──
const authStore = useAuthStore()
const displayName = ref('')

async function loadDisplayName() {
  const profile = await boardStore.loadMyProfile().catch(() => null)
  if (profile) displayName.value = profile.display_name || ''
}

async function onDisplayNameChange(value) {
  const trimmed = value.trim()
  if (!trimmed) return
  displayName.value = trimmed
  await boardStore.saveMyDisplayName(trimmed).catch(console.error)
}

function signOut() { authStore.signOut() }



onMounted(async () => {
  if (rowsEl.value) initSortable(rowsEl.value, stageRows)
  document.addEventListener('click', closeIconPicker)
  loadPending()
  loadDisplayName()
})

onUnmounted(() => {
  document.removeEventListener('click', closeIconPicker)
})
</script>
