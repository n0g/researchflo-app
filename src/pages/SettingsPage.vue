<template>
  <f7-page name="settings" class="settings-page" no-swipeback>
    <div class="settings-screen">
      <AppSidebar current-page="settings">
        <template #filters>
          <div class="sidebar-section-header" style="cursor:default; pointer-events:none">
            <span class="sidebar-section-label">Jump to</span>
          </div>
          <button class="sidebar-nav-item" title="Appearance" @click="scrollTo('settings-appearance')">
            <i class="ph ph-palette" aria-hidden="true"></i>
            <span class="sidebar-label">Appearance</span>
          </button>
          <button class="sidebar-nav-item" title="Collaborators" @click="scrollTo('settings-collaborators')">
            <i class="ph ph-users" aria-hidden="true"></i>
            <span class="sidebar-label">Collaborators</span>
          </button>
          <button class="sidebar-nav-item" title="HotCRP / Review Sites" @click="scrollTo('settings-reviews')">
            <i class="ph ph-article" aria-hidden="true"></i>
            <span class="sidebar-label">HotCRP</span>
          </button>
          <button class="sidebar-nav-item" title="Google Calendar" @click="scrollTo('settings-calendar')">
            <i class="ph ph-calendar-dots" aria-hidden="true"></i>
            <span class="sidebar-label">Calendar</span>
          </button>
          <button class="sidebar-nav-item" title="MCP Server" @click="scrollTo('settings-mcp')">
            <i class="ph ph-plugs" aria-hidden="true"></i>
            <span class="sidebar-label">MCP Server</span>
          </button>
          <button class="sidebar-nav-item" title="Account" @click="scrollTo('settings-account')">
            <i class="ph ph-user-circle" aria-hidden="true"></i>
            <span class="sidebar-label">Account</span>
          </button>
        </template>
      </AppSidebar>

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
          <div id="settings-appearance" class="settings-section">
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
              <div class="settings-row">
                <span class="settings-row-label">Week starts on</span>
                <div class="theme-segmented" role="group" aria-label="Week starts on">
                  <button
                    class="theme-seg-btn"
                    :class="{ active: weekStartDay === 'monday' }"
                    :aria-pressed="weekStartDay === 'monday'"
                    @click="setWeekStartDay('monday')"
                  >Monday</button>
                  <button
                    class="theme-seg-btn"
                    :class="{ active: weekStartDay === 'sunday' }"
                    :aria-pressed="weekStartDay === 'sunday'"
                    @click="setWeekStartDay('sunday')"
                  >Sunday</button>
                </div>
              </div>
              <div class="settings-row">
                <span class="settings-row-label">Time format</span>
                <div class="theme-segmented" role="group" aria-label="Time format">
                  <button
                    class="theme-seg-btn"
                    :class="{ active: timeFormat === '12h' }"
                    :aria-pressed="timeFormat === '12h'"
                    @click="setTimeFormat('12h')"
                  >12-hour</button>
                  <button
                    class="theme-seg-btn"
                    :class="{ active: timeFormat === '24h' }"
                    :aria-pressed="timeFormat === '24h'"
                    @click="setTimeFormat('24h')"
                  >24-hour</button>
                </div>
              </div>
            </div>
          </div>

          <!-- ── Collaborators ── -->
          <div id="settings-collaborators" class="settings-section">
            <div class="settings-section-title">Collaborators</div>
            <div class="settings-card">
              <p class="settings-hint">People in your projects who haven't joined yet. Add their email address and send them an invite.</p>
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
                    class="btn sm"
                    :disabled="inviteSending === person.id || !person.email"
                    :title="inviteSent === person.id ? 'Invite sent!' : 'Send invite email'"
                    @click="sendInvite(person)"
                  >
                    <i :class="inviteSent === person.id ? 'ph ph-check' : 'ph ph-paper-plane-tilt'" aria-hidden="true"></i>
                    {{ inviteSent === person.id ? 'Sent' : inviteSending === person.id ? '…' : 'Invite' }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- ── Review Sites ── -->
          <div id="settings-reviews" class="settings-section">
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

          <!-- ── Calendar ── -->
          <div id="settings-calendar" class="settings-section">
            <div class="settings-section-title">Calendar</div>
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

          <!-- ── MCP Server ── -->
          <div id="settings-mcp" class="settings-section">
            <div class="settings-section-title">MCP Server</div>
            <div class="settings-card">
              <div class="settings-row-group" style="margin-bottom: 16px">
                <div class="settings-row" style="padding: 13px 16px; margin: 0">
                  <span class="settings-row-label">Endpoint</span>
                  <div class="settings-row-right">
                    <code class="mcp-token-code" style="max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ mcpConfigUrl }}</code>
                    <button class="btn icon" :title="mcpEndpointCopied ? 'Copied!' : 'Copy endpoint URL'" @click="copyToClipboard(mcpConfigUrl, mcpEndpointCopied)">
                      <i :class="mcpEndpointCopied ? 'ph ph-check' : 'ph ph-copy'" aria-hidden="true"></i>
                    </button>
                  </div>
                </div>
                <div class="settings-row" style="padding: 13px 16px; margin: 0; border-top: 1px solid var(--border)">
                  <span class="settings-row-label">Authorization token</span>
                  <div class="settings-row-right">
                    <code class="mcp-token-code">{{ mcpToken ? mcpToken.slice(0, 8) + '…' : '…' }}</code>
                    <button class="btn icon" :title="mcpTokenCopied ? 'Copied!' : 'Copy token'" @click="copyToClipboard(mcpToken, mcpTokenCopied)">
                      <i :class="mcpTokenCopied ? 'ph ph-check' : 'ph ph-copy'" aria-hidden="true"></i>
                    </button>
                    <button class="btn sm danger" :disabled="mcpRegenerating" title="Invalidates the current token — update your config after regenerating" @click="regenerateMcpToken">
                      {{ mcpRegenerating ? '…' : 'Regenerate' }}
                    </button>
                  </div>
                </div>
              </div>

              <div class="mcp-steps">
                <div class="mcp-step">
                  <span class="mcp-step-num">1</span>
                  <span>Select your Claude client and copy the config snippet below.</span>
                </div>
                <div class="mcp-step">
                  <span class="mcp-step-num">2</span>
                  <span>
                    Merge it into your config file:<br>
                    <template v-if="mcpTarget === 'code'">
                      <strong>Claude Code</strong> — <code class="inline-code">~/.claude.json</code> → <code class="inline-code">mcpServers</code>
                    </template>
                    <template v-else>
                      <strong>Claude Desktop</strong> — <code class="inline-code">~/Library/Application Support/Claude/claude_desktop_config.json</code><br>
                      <span style="font-size:0.85em;opacity:0.7">Requires Node.js. <code class="inline-code">mcp-remote</code> is downloaded automatically via npx.</span>
                    </template>
                  </span>
                </div>
                <div class="mcp-step">
                  <span class="mcp-step-num">3</span>
                  <span>
                    Ask Claude things like:<br>
                    <em>"Give me a status overview of all my projects."</em><br>
                    <em>"What tasks are overdue?"</em><br>
                    <em>"Move the UIST paper to Revision and set the deadline to September 15."</em>
                  </span>
                </div>
              </div>

              <div v-if="mcpToken" class="mcp-target-toggle">
                <div class="theme-segmented" role="group" aria-label="Claude client">
                  <button class="theme-seg-btn" :class="{ active: mcpTarget === 'code' }" @click="mcpTarget = 'code'">Claude Code</button>
                  <button class="theme-seg-btn" :class="{ active: mcpTarget === 'desktop' }" @click="mcpTarget = 'desktop'">Claude Desktop</button>
                </div>
              </div>

              <pre v-if="mcpToken" class="settings-code-block" style="margin-top: 8px">{{ mcpConfigSnippet }}</pre>
              <div v-if="!mcpToken" class="settings-hint" style="margin-top: 8px">Loading…</div>

              <div v-if="mcpToken" class="settings-actions" style="margin-top: 0">
                <span v-if="mcpCopied" class="settings-inline-msg">Copied!</span>
                <button class="btn sm" @click="copyMcpConfig">
                  <i :class="mcpCopied ? 'ph ph-check' : 'ph ph-copy'" aria-hidden="true"></i>
                  {{ mcpCopied ? 'Copied' : 'Copy config' }}
                </button>
              </div>
            </div>
          </div>

          <!-- ── Account ── -->
          <div id="settings-account" class="settings-section">
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
                <span class="settings-row-label">Email</span>
                <div class="settings-row-right">
                  <span v-if="emailMsg" class="settings-inline-msg">{{ emailMsg }}</span>
                  <input
                    type="email"
                    class="settings-inline-input"
                    :value="emailDraft"
                    :disabled="emailBusy"
                    placeholder="Email address"
                    @change="saveEmail($event.target.value)"
                    @keydown.enter.prevent="$event.target.blur()"
                  />
                </div>
              </div>
              <template v-if="passkeySupported">
                <div class="settings-row settings-row--passkey-header">
                  <span class="settings-row-label">Passkeys</span>
                  <div class="settings-row-right">
                    <span v-if="passkeyMsg" class="settings-inline-msg">{{ passkeyMsg }}</span>
                    <button class="btn sm" :disabled="passkeyBusy" @click="addPasskey">
                      {{ passkeyBusy ? 'Adding…' : 'Add passkey' }}
                    </button>
                  </div>
                </div>
                <div class="passkey-list-card">
                  <div v-if="passkeys.length === 0" class="passkey-empty" style="padding: 10px 12px; margin: 0">
                    No passkeys registered.
                  </div>
                  <div v-for="pk in passkeys" :key="pk.id" class="passkey-row" style="padding: 8px 12px">
                    <div class="passkey-row-info">
                      <span class="passkey-row-label">{{ pk.device_label || 'Unknown device' }}</span>
                      <span class="passkey-row-meta">Added {{ formatPasskeyDate(pk.created_at) }} · Last used {{ formatPasskeyDate(pk.last_used_at) }}</span>
                    </div>
                    <button
                      class="btn-icon-x"
                      :disabled="deletingPasskeyId === pk.id"
                      :aria-label="'Remove passkey: ' + (pk.device_label || 'Unknown device')"
                      @click="removePasskey(pk.id)"
                    >
                      <i :class="deletingPasskeyId === pk.id ? 'ph ph-circle-notch ph-spin' : 'ph ph-x-circle'" aria-hidden="true"></i>
                    </button>
                  </div>
                </div>
              </template>
              <div class="settings-row">
                <span class="settings-row-label">Signed in</span>
                <button class="btn sm danger" @click="signOut">Sign out</button>
              </div>
            </div>
          </div>

          <!-- ── Danger zone ── -->
          <div class="settings-section">
            <div class="settings-section-title">Danger zone</div>
            <div class="settings-row-group">
              <div class="settings-row">
                <div>
                  <span class="settings-row-label">Delete account</span>
                  <p class="settings-hint">Permanently removes your account and all data. This cannot be undone.</p>
                </div>
                <div v-if="!deleteConfirm" class="settings-row-right">
                  <button class="btn sm danger" @click="deleteConfirm = true">Delete</button>
                </div>
                <div v-else class="settings-row-right">
                  <button class="btn sm" @click="deleteConfirm = false">Cancel</button>
                  <button class="btn sm danger" :disabled="deleteBusy" @click="deleteAccount">
                    {{ deleteBusy ? 'Deleting…' : 'Confirm delete' }}
                  </button>
                </div>
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
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { f7 } from 'framework7-vue/bundle'
import { useBoardStore } from '../stores/board.js'
import { useAuthStore } from '../stores/auth.js'
import { supabase } from '../lib/supabase.js'
import { useReviewsStore } from '../stores/reviews.js'
import { useCalendarStore } from '../stores/calendar.js'
import { useSidebar } from '../composables/useSidebar.js'
import { useTheme } from '../composables/useTheme.js'
import { useAccentColor } from '../composables/useAccentColor.js'
import { useSchedulePrefs } from '../composables/useSchedulePrefs.js'
import { registerPasskey, listPasskeys, deletePasskey, isPasskeySupported } from '../lib/passkey.js'
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
const { weekStartDay, timeFormat, setWeekStartDay, setTimeFormat } = useSchedulePrefs()

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
const inviteSending = ref(null)
const inviteSent = ref(null)

async function loadPending() {
  pendingCollaborators.value = await boardStore.loadPendingCollaborators().catch(() => [])
}

async function sendInvite(person) {
  if (!person.email) return
  inviteSending.value = person.id
  try {
    await boardStore.sendInviteEmail(person.id, person.email)
    inviteSent.value = person.id
    setTimeout(() => { inviteSent.value = null }, 3000)
  } catch (err) {
    alert(err.message || 'Failed to send invite.')
  } finally {
    inviteSending.value = null
  }
}

async function onEmailChange(person, value) {
  await boardStore.savePersonEmail(person.id, value).catch(console.error)
  person.email = value.trim() || null
}

// ── Account ──
const authStore = useAuthStore()
const displayName = ref('')
const emailDraft = ref(authStore.user?.email || '')
const emailMsg = ref('')
const emailBusy = ref(false)
const deleteConfirm = ref(false)
const deleteBusy = ref(false)
const passkeySupported = isPasskeySupported()
const passkeyBusy = ref(false)
const passkeyMsg = ref('')
const passkeys = ref([])
const deletingPasskeyId = ref(null)

async function loadPasskeys() {
  if (!passkeySupported) return
  passkeys.value = await listPasskeys().catch(() => [])
}

function formatPasskeyDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

async function addPasskey() {
  passkeyMsg.value = ''
  passkeyBusy.value = true
  try {
    await registerPasskey()
    await loadPasskeys()
    passkeyMsg.value = 'Passkey added.'
    setTimeout(() => { passkeyMsg.value = '' }, 3000)
  } catch (err) {
    if (err.message !== 'cancelled') passkeyMsg.value = err.message || 'Failed to add passkey.'
  } finally {
    passkeyBusy.value = false
  }
}

async function removePasskey(id) {
  deletingPasskeyId.value = id
  try {
    await deletePasskey(id)
    passkeys.value = passkeys.value.filter(p => p.id !== id)
  } catch (err) {
    passkeyMsg.value = err.message || 'Failed to remove passkey.'
  } finally {
    deletingPasskeyId.value = null
  }
}

async function loadDisplayName() {
  const profile = await boardStore.loadMyProfile().catch(() => null)
  if (profile) displayName.value = profile.display_name || ''
  // Sync email draft from live session in case it wasn't set at init
  if (!emailDraft.value && authStore.user?.email) emailDraft.value = authStore.user.email
}

async function saveEmail(value) {
  const trimmed = (value ?? emailDraft.value).trim()
  emailDraft.value = trimmed
  if (!trimmed || trimmed === authStore.user?.email) return
  emailBusy.value = true
  emailMsg.value = ''
  try {
    const { error } = await supabase.auth.updateUser({ email: trimmed })
    if (error) throw error
    emailMsg.value = 'Confirmation sent — check your inbox.'
  } catch (err) {
    emailMsg.value = err.message || 'Failed to update email.'
  } finally {
    emailBusy.value = false
    setTimeout(() => { emailMsg.value = '' }, 5000)
  }
}

async function deleteAccount() {
  deleteBusy.value = true
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/account-delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error || 'Delete failed')
    }
    await authStore.signOut()
  } catch (err) {
    deleteBusy.value = false
    deleteConfirm.value = false
    passkeyMsg.value = err.message || 'Failed to delete account.'
  }
}

async function onDisplayNameChange(value) {
  const trimmed = value.trim()
  if (!trimmed) return
  displayName.value = trimmed
  await boardStore.saveMyDisplayName(trimmed).catch(console.error)
}

function signOut() { authStore.signOut() }

function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// ── MCP Server ──
const mcpToken = ref(null)
const mcpCopied = ref(false)
const mcpEndpointCopied = ref(false)
const mcpTokenCopied = ref(false)
const mcpRegenerating = ref(false)

const mcpConfigUrl = computed(() => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mcp`)

const mcpConfigSnippetCode = computed(() => {
  return JSON.stringify({
    mcpServers: {
      researchflo: {
        url: mcpConfigUrl.value,
        headers: { Authorization: `Bearer ${mcpToken.value ?? ''}` },
      },
    },
  }, null, 2)
})

const mcpConfigSnippetDesktop = computed(() => {
  return JSON.stringify({
    mcpServers: {
      researchflo: {
        command: 'npx',
        args: ['-y', 'mcp-remote', mcpConfigUrl.value, '--header', `Authorization: Bearer ${mcpToken.value ?? ''}`],
      },
    },
  }, null, 2)
})

const mcpTarget = ref('code')

const mcpConfigSnippet = computed(() =>
  mcpTarget.value === 'desktop' ? mcpConfigSnippetDesktop.value : mcpConfigSnippetCode.value
)

async function loadMcpToken() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  // Ensure a user_settings row exists (DB default generates the token on INSERT)
  await supabase.from('user_settings')
    .upsert({ user_id: user.id }, { onConflict: 'user_id', ignoreDuplicates: true })
  const { data } = await supabase.from('user_settings').select('mcp_token').eq('user_id', user.id).single()
  mcpToken.value = data?.mcp_token ?? null
}

async function copyToClipboard(text, flag) {
  await navigator.clipboard.writeText(text).catch(() => {})
  flag.value = true
  setTimeout(() => { flag.value = false }, 2000)
}

async function copyMcpConfig() {
  await copyToClipboard(mcpConfigSnippet.value, mcpCopied)
}

async function regenerateMcpToken() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  mcpRegenerating.value = true
  const newToken = crypto.randomUUID()
  await supabase.from('user_settings').update({ mcp_token: newToken }).eq('user_id', user.id)
  mcpToken.value = newToken
  mcpRegenerating.value = false
}

function onSettingsTabShow(tabEl) {
  if (tabEl?.id === 'view-settings') loadPending()
}

onMounted(async () => {
  f7.on('tabShow', onSettingsTabShow)
  loadPending()
  loadDisplayName()
  loadPasskeys()
  loadMcpToken()
})

onUnmounted(() => {
  document.removeEventListener('click', closeIconPicker)
  f7.off('tabShow', onSettingsTabShow)
})
</script>
