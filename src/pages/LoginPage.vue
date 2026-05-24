<template>
  <f7-page name="login" class="login-page" no-navbar>
    <div class="login-wrap">
      <div class="login-box">
        <div class="login-logo">
          <i class="ph ph-strategy login-logo-icon" aria-hidden="true"></i>
          <span class="login-logo-name">researchflo</span>
        </div>

        <!-- Attempting discoverable passkey -->
        <template v-if="phase === 'init'">
          <p class="login-subtitle">Signing you in…</p>
          <div class="login-spinner" aria-label="Signing in" role="status">
            <i class="ph ph-circle-notch ph-spin" aria-hidden="true"></i>
          </div>
        </template>

        <!-- Email form -->
        <template v-else-if="phase === 'form'">
          <p class="login-subtitle">
            {{ hasInvite ? 'Create your account to accept the invitation.' : 'Sign in to your account.' }}
          </p>
          <div v-if="!hasInvite && passkeyAvailable" class="login-passkey-section">
            <button class="btn primary login-btn" :disabled="busy" @click="signInWithPasskey">
              <i class="ph ph-fingerprint" aria-hidden="true"></i>
              {{ busy ? 'Please wait…' : 'Sign in with passkey' }}
            </button>
            <div class="login-divider"><span>or use email</span></div>
          </div>
          <div class="login-fields">
            <input
              ref="emailEl"
              type="email"
              v-model="email"
              placeholder="Email"
              aria-label="Email"
              autocomplete="email webauthn"
              :disabled="busy"
              @keydown.enter="submit"
            >
          </div>
          <div v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</div>
          <div class="login-actions">
            <button class="btn primary login-btn" :disabled="busy" @click="submit">
              {{ busy ? 'Please wait…' : hasInvite ? 'Create account' : 'Sign in' }}
            </button>
          </div>
        </template>

        <!-- Magic link sent -->
        <template v-else-if="phase === 'sent'">
          <div class="login-sent-icon" aria-hidden="true">
            <i class="ph ph-paper-plane-tilt"></i>
          </div>
          <p class="login-subtitle">
            Check your email for a sign-in link.<br>
            <span class="login-sent-email">{{ email }}</span>
          </p>
          <button class="btn sm login-back-btn" @click="phase = 'form'">Back</button>
        </template>
      </div>
    </div>
  </f7-page>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { useAuthStore } from '../stores/auth.js'
import { supabase } from '../lib/supabase.js'
import { tryDiscoverableAuth, authenticateWithPasskey, isPasskeySupported } from '../lib/passkey.js'

const authStore = useAuthStore()
const phase = ref('init')  // 'init' | 'form' | 'sent'
const email = ref('')
const busy = ref(false)
const errorMsg = ref('')
const emailEl = ref(null)
const passkeyAvailable = ref(isPasskeySupported())

const hasInvite = computed(() => !!localStorage.getItem('pending_invite_token'))

onMounted(async () => {
  if (!isPasskeySupported()) {
    phase.value = 'form'
    return
  }

  try {
    const result = await tryDiscoverableAuth()
    if (!result) phase.value = 'form'
  } catch (err) {
    phase.value = 'form'
    errorMsg.value = err.message || 'Passkey sign-in failed.'
  }

  await nextTick()
  if (phase.value === 'form') emailEl.value?.focus()
})

async function signInWithPasskey() {
  errorMsg.value = ''
  busy.value = true
  try {
    const result = await tryDiscoverableAuth()
    if (!result) errorMsg.value = 'No passkey found — enter your email below and click Sign in.'
  } catch (err) {
    errorMsg.value = err.message || 'Passkey sign-in failed — try entering your email below.'
  } finally {
    busy.value = false
  }
}

async function submit() {
  const e = email.value.trim()
  if (!e) { errorMsg.value = 'Enter your email address.'; return }
  errorMsg.value = ''
  busy.value = true

  try {
    if (!hasInvite.value && isPasskeySupported()) {
      // Check for passkey first; fall through to magic link if none exists
      const result = await authenticateWithPasskey(e)
      if (result?.hasPasskey === false) {
        // No passkey — send magic link (only to existing accounts)
        await sendMagicLink(e, false)
        return
      }
      // result.hasPasskey = true → setSession already called → done
    } else {
      // Invite flow or passkeys not supported → create account via magic link
      await sendMagicLink(e, hasInvite.value)
    }
  } catch (err) {
    if (err.message === 'cancelled') {
      // User dismissed passkey prompt — offer magic link as fallback
      const ok = confirm('Passkey sign-in cancelled. Send a magic link to ' + e + '?')
      if (ok) await sendMagicLink(e, false)
    } else {
      errorMsg.value = err.message || 'Sign in failed.'
    }
  } finally {
    busy.value = false
  }
}

async function sendMagicLink(emailAddr, createUser) {
  const { error } = await supabase.auth.signInWithOtp({
    email: emailAddr,
    options: { shouldCreateUser: createUser },
  })
  if (error) throw error
  phase.value = 'sent'
}
</script>
