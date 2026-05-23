<template>
  <f7-page name="login" class="login-page" no-navbar>
    <div class="login-screen">
      <div class="login-box">
        <div class="login-logo">
          <i class="ph ph-strategy login-logo-icon" aria-hidden="true"></i>
          <span class="login-logo-name">researchflo</span>
        </div>
        <p class="login-subtitle">Sign in to your account</p>

        <div class="login-fields">
          <input
            type="email"
            v-model="email"
            placeholder="Email"
            aria-label="Email"
            autocomplete="email"
            :disabled="busy"
            @keydown.enter="focusPassword"
          >
          <input
            ref="passwordEl"
            type="password"
            v-model="password"
            placeholder="Password"
            aria-label="Password"
            autocomplete="current-password"
            :disabled="busy"
            @keydown.enter="submit"
          >
        </div>

        <div v-if="error" class="error-msg" role="alert">{{ error }}</div>

        <button class="btn primary login-btn" @click="submit" :disabled="busy">
          {{ busy ? 'Signing in…' : 'Sign in' }}
        </button>
      </div>
    </div>
  </f7-page>
</template>

<script setup>
import { ref, nextTick } from 'vue'
import { useAuthStore } from '../stores/auth.js'

const authStore = useAuthStore()
const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)
const passwordEl = ref(null)

function focusPassword() {
  passwordEl.value?.focus()
}

async function submit() {
  const e = email.value.trim()
  const p = password.value
  if (!e || !p) return
  error.value = ''
  busy.value = true
  try {
    await authStore.signIn(e, p)
  } catch (err) {
    error.value = err.message || 'Sign in failed — check your email and password.'
  } finally {
    busy.value = false
  }
}
</script>
