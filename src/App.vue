<template>
  <f7-app v-bind="f7params">
    <!-- DEBUG: safe area overlay — REMOVE BEFORE SHIP -->
    <div style="position:fixed;bottom:0;left:0;right:0;z-index:999999;background:rgba(255,0,0,0.5);height:env(safe-area-inset-bottom,0px);pointer-events:none"></div>
    <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:999999;background:rgba(0,0,0,0.8);color:white;font-size:11px;padding:8px 12px;border-radius:8px;font-family:monospace;pointer-events:none" id="debug-overlay"></div>

    <!-- Show nothing until auth is resolved (prevents passkey popup on magic-link load) -->
    <div v-if="!authStore.initialized" class="app-boot" />

    <!-- Not signed in -->
    <f7-view v-else-if="!authStore.user" main url="/login/" />

    <!-- Signed in: tab views -->
    <template v-else>
      <f7-views tabs>
        <f7-view id="view-board"    name="board"    tab tab-active url="/board/"    :browser-history="false" />
        <f7-view id="view-inbox"    name="inbox"    tab url="/inbox/"    :browser-history="false" />
        <f7-view id="view-schedule" name="schedule" tab url="/schedule/" :browser-history="false" />
        <f7-view id="view-settings" name="settings" tab url="/settings/" :browser-history="false" />
      </f7-views>

      <!-- Passkey registration prompt (shown after magic-link login) -->
      <div v-if="authStore.pendingPasskeySetup && passkeySupported" class="passkey-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="passkey-modal-title">
        <div class="passkey-modal">
          <i class="ph ph-fingerprint passkey-modal-icon" aria-hidden="true"></i>
          <h2 id="passkey-modal-title" class="passkey-modal-title">Set up passkey</h2>
          <p class="passkey-modal-body">
            Use Face ID, Touch ID, or your device PIN to sign in next time — no email link needed.
          </p>
          <div v-if="passkeyError" class="error-msg" role="alert">{{ passkeyError }}</div>
          <div class="passkey-modal-actions">
            <button class="btn primary" :disabled="passkeyBusy" @click="setupPasskey">
              {{ passkeyBusy ? 'Setting up…' : 'Set up passkey' }}
            </button>
            <button class="btn" @click="dismissPasskey">Maybe later</button>
          </div>
        </div>
      </div>
    </template>
  </f7-app>
</template>


<script setup>
import { ref, watch, onMounted, nextTick } from 'vue'
import routes from './routes.js'
import { useBoardStore } from './stores/board.js'
import { useAuthStore } from './stores/auth.js'
import { useReviewsStore } from './stores/reviews.js'
import { useCalendarStore } from './stores/calendar.js'
import { useSettingsStore } from './stores/settings.js'
import { useTheme } from './composables/useTheme.js'
import { useAccentColor } from './composables/useAccentColor.js'
import { registerPasskey, isPasskeySupported } from './lib/passkey.js'

useTheme()
useAccentColor()

const authStore = useAuthStore()
const store = useBoardStore()

// Capture synchronously — Supabase's initialize() clears the URL hash before onMounted fires.
// Exclude GCal OAuth callbacks (?code + gcal_csrf in sessionStorage) from triggering passkey setup.
const _searchParams = new URLSearchParams(window.location.search)
const _isGCalCallback = _searchParams.has('code') && !!sessionStorage.getItem('gcal_csrf')
const hadAuthCallback = (!!window.location.hash || _searchParams.has('code')) && !_isGCalCallback
const reviewsStore = useReviewsStore()
const calStore = useCalendarStore()
const settingsStore = useSettingsStore()

const passkeySupported = isPasskeySupported()
const passkeyBusy = ref(false)
const passkeyError = ref('')

// Guard: prevent watchers from re-saving settings that were just loaded
const settingsLoaded = ref(false)

// After passkey/OTP sign-in, calStore.init() ran before auth completed.
// Re-check GCal connection once the user is confirmed authenticated.
// Also claim any pending invite — the onMounted check handles the already-signed-in case,
// but this watcher handles sign-in that happens after mount (e.g. passkey redirect).
watch(() => authStore.user, async (user, prev) => {
  if (user && !prev) {
    calStore.checkConnection()
    const pendingInvite = localStorage.getItem('pending_invite_token')
    if (pendingInvite) {
      localStorage.removeItem('pending_invite_token')
      localStorage.removeItem('pending_invite_email')
      await store.claimInvite(pendingInvite).catch(console.error)
    }
  }
})

watch(() => reviewsStore.sites, (sites) => {
  if (!settingsLoaded.value) return
  settingsStore.save('hotcrp_sites', sites)
}, { deep: true })

watch(() => calStore.selectedCalendarId, (id) => {
  if (!settingsLoaded.value) return
  settingsStore.save('gcal_calendar_id', id)
})

async function setupPasskey() {
  passkeyError.value = ''
  passkeyBusy.value = true
  try {
    await registerPasskey()
    authStore.pendingPasskeySetup = false
  } catch (err) {
    if (err.message === 'cancelled') {
      authStore.pendingPasskeySetup = false
    } else {
      passkeyError.value = err.message || 'Passkey setup failed.'
    }
  } finally {
    passkeyBusy.value = false
  }
}

function dismissPasskey() {
  authStore.pendingPasskeySetup = false
}

onMounted(async () => {
  // DEBUG: show viewport/safe-area info — REMOVE BEFORE SHIP
  const el = document.getElementById('debug-overlay')
  if (el) {
    const update = () => {
      const sab = getComputedStyle(document.documentElement).getPropertyValue('--sab').trim()
      el.textContent = `innerH=${window.innerHeight} screenH=${screen.height} sab=${sab}`
    }
    document.documentElement.style.setProperty('--sab', 'env(safe-area-inset-bottom)')
    update()
    window.addEventListener('resize', update)
  }

  // Capture ?invite=TOKEN and ?email= from URL before F7 boots
  const _inviteParams = new URLSearchParams(window.location.search)
  const urlInvite = _inviteParams.get('invite')
  if (urlInvite) {
    localStorage.setItem('pending_invite_token', urlInvite)
    const urlInviteEmail = _inviteParams.get('email')
    if (urlInviteEmail) localStorage.setItem('pending_invite_email', urlInviteEmail)
    window.history.replaceState({}, '', window.location.pathname)
  }

  await authStore.init()

  // Claim pending invite if user is signed in
  const pendingInvite = localStorage.getItem('pending_invite_token')
  if (pendingInvite && authStore.user) {
    localStorage.removeItem('pending_invite_token')
    localStorage.removeItem('pending_invite_email')
    await store.claimInvite(pendingInvite).catch(console.error)
  }

  // Prompt passkey registration after any auth callback sign-in
  if (hadAuthCallback && authStore.user && passkeySupported) {
    authStore.pendingPasskeySetup = true
  }

  calStore.init().catch(() => {})

  const settings = await settingsStore.load()

  if (settings.hotcrp_sites)        reviewsStore.setSites(settings.hotcrp_sites)
  if (settings.gcal_calendar_id)    calStore.saveCalendarId(settings.gcal_calendar_id)

  // Let Vue flush reactive updates so watch callbacks fire while settingsLoaded=false
  await nextTick()
  settingsLoaded.value = true

  // Backfill: write any settings not yet in Supabase
  if (!settings.hotcrp_sites && reviewsStore.sites.length)
    settingsStore.save('hotcrp_sites', reviewsStore.sites)
  if (!settings.gcal_calendar_id && calStore.selectedCalendarId && calStore.selectedCalendarId !== 'primary')
    settingsStore.save('gcal_calendar_id', calStore.selectedCalendarId)
})

const f7params = {
  name: 'researchflo',
  theme: 'ios',
  darkMode: false,
  routes,
  touch: {
    iosTouchRipple: false,
    mdTouchRipple: false,
  },
}
</script>
