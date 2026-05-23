<template>
  <f7-app v-bind="f7params">
    <!-- Not signed in -->
    <f7-view v-if="!authStore.user" main url="/login/" />

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
const reviewsStore = useReviewsStore()
const calStore = useCalendarStore()
const settingsStore = useSettingsStore()

const passkeySupported = isPasskeySupported()
const passkeyBusy = ref(false)
const passkeyError = ref('')

// Guard: prevent watchers from re-saving settings that were just loaded
const settingsLoaded = ref(false)

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
  // Capture ?invite=TOKEN from URL before F7 boots (deep links don't work with browser-history: false)
  const urlInvite = new URLSearchParams(window.location.search).get('invite')
  if (urlInvite) {
    localStorage.setItem('pending_invite_token', urlInvite)
    window.history.replaceState({}, '', window.location.pathname)
  }

  // Detect magic-link callback (hash contains access_token from Supabase redirect)
  const hashParams = new URLSearchParams(window.location.hash.slice(1))
  const fromMagicLink = hashParams.get('type') === 'magiclink' || hashParams.get('type') === 'email'
  if (window.location.hash) {
    window.history.replaceState({}, '', window.location.pathname + window.location.search)
  }

  await authStore.init()

  // Claim pending invite if user is already signed in
  const pendingInvite = localStorage.getItem('pending_invite_token')
  if (pendingInvite && authStore.user) {
    localStorage.removeItem('pending_invite_token')
    await store.claimInvite(pendingInvite).catch(console.error)
  }

  // Prompt passkey registration after magic-link sign-in
  if (fromMagicLink && authStore.user && passkeySupported) {
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
