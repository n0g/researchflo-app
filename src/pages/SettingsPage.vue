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
              <p class="settings-hint">Map Todoist labels to pipeline stages. Order = column order on the board.</p>

              <template v-if="boardStore.labels.some(l => l.name.startsWith('stage::'))">
                <div class="settings-subsection-label">Your Todoist labels</div>
                <div class="label-chips" role="list">
                  <span
                    v-for="l in boardStore.labels.filter(l => l.name.startsWith('stage::'))"
                    :key="l.id"
                    class="chip"
                    tabindex="0"
                    role="button"
                    :aria-label="'Use label ' + l.name"
                    @click="fillLabel(l.name)"
                    @keydown.enter.prevent="fillLabel(l.name)"
                  >{{ l.name }}</span>
                </div>
              </template>

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
                    placeholder="Display name"
                    aria-label="Stage display name"
                    v-model="row.name"
                    class="stage-name-input"
                  >
                  <input
                    type="text"
                    placeholder="Todoist label"
                    aria-label="Todoist label name"
                    v-model="row.label"
                    class="stage-label-input"
                  >
                  <button class="del" :aria-label="'Remove stage ' + row.name" @click="stageRows.splice(i, 1)"><i class="ph ph-x" aria-hidden="true"></i></button>
                </div>
              </div>

              <div v-if="stageError" class="error-msg" role="alert">{{ stageError }}</div>
              <div class="settings-actions">
                <button class="btn sm" @click="addStageRow">+ Add stage</button>
                <button class="btn sm primary" @click="saveStages">Save stages</button>
              </div>
            </div>
          </div>

          <!-- ── Review Sites ── -->
          <div class="settings-section">
            <div class="settings-section-title">Review Sites</div>
            <div class="settings-card">
              <div class="settings-subsection-label">CORS Proxy</div>
              <p class="settings-hint">
                Browsers block direct HotCRP requests. Route them through a proxy.<br>
                Use <code class="inline-code">https://corsproxy.io/?url=</code> for zero-setup.
              </p>
              <input
                type="url"
                v-model="proxyDraft"
                placeholder="https://corsproxy.io/?url="
                aria-label="Proxy URL"
                @keydown.enter.prevent="saveProxy"
              >
              <div class="settings-actions" style="margin-top: 8px">
                <button v-if="reviewsStore.proxyUrl" class="btn sm" @click="clearProxy">Clear</button>
                <button class="btn sm primary" @click="saveProxy">Save</button>
              </div>
              <p v-if="reviewsStore.proxyUrl" class="settings-hint" style="margin-top: 8px; margin-bottom: 0">
                Active: <code class="inline-code">{{ reviewsStore.proxyUrl }}</code>
              </p>
              <p v-else class="settings-hint warn" style="margin-top: 8px; margin-bottom: 0">No proxy set — fetches will fail due to CORS.</p>

              <div class="settings-subsection-label" style="margin-top: 24px">Configured Sites</div>
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
                <span class="settings-row-label">Todoist connection</span>
                <button class="btn sm danger" @click="disconnect">Disconnect</button>
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
import { useReviewsStore } from '../stores/reviews.js'
import { useCalendarStore } from '../stores/calendar.js'
import { useSidebar } from '../composables/useSidebar.js'
import { useTheme } from '../composables/useTheme.js'
import { useAccentColor } from '../composables/useAccentColor.js'
import { DEFAULT_STAGES, getStageIcon } from '../lib/helpers.js'
import { apiAll } from '../lib/todoist.js'
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
  'flag', 'star', 'bookmark', 'archive', 'folder', 'kanban',
]

const rowsEl = ref(null)
let keyCounter = 0
const stageRows = ref((boardStore.stages || DEFAULT_STAGES).map(s => ({ ...s, icon: getStageIcon(s), key: keyCounter++ })))
const stageError = ref('')
const openIconPickerKey = ref(null)

function addStageRow(labelVal = '', nameVal = '') {
  stageRows.value.push({ name: nameVal, label: labelVal, icon: 'kanban', key: keyCounter++ })
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

function fillLabel(name) {
  const empty = stageRows.value.find(r => !r.label)
  if (empty) { empty.label = name; return }
  addStageRow(name)
}

function saveStages() {
  const stages = stageRows.value
    .map(r => ({ name: r.name.trim(), label: r.label.trim(), icon: r.icon || 'kanban' }))
    .filter(r => r.name && r.label)
  if (!stages.length) { stageError.value = 'Add at least one stage.'; return }
  stageError.value = ''
  boardStore.saveStages(stages)
}

// ── Proxy ──
const proxyDraft = ref(reviewsStore.proxyUrl)
watch(() => reviewsStore.proxyUrl, val => { proxyDraft.value = val })

function saveProxy() { reviewsStore.saveProxy(proxyDraft.value) }
function clearProxy() { proxyDraft.value = ''; reviewsStore.saveProxy('') }

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

// ── Account ──
function disconnect() {
  boardStore.resetToken()
}



onMounted(async () => {
  proxyDraft.value = reviewsStore.proxyUrl
  if (rowsEl.value) initSortable(rowsEl.value, stageRows)
  document.addEventListener('click', closeIconPicker)
  try {
    boardStore.labels = await apiAll(boardStore.token, '/labels')
  } catch { boardStore.labels = [] }
})

onUnmounted(() => {
  document.removeEventListener('click', closeIconPicker)
})
</script>
