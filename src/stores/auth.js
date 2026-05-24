import { ref } from 'vue'
import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase.js'

function readStoredSession() {
  try {
    const projectRef = import.meta.env.VITE_SUPABASE_URL.split('//')[1].split('.')[0]
    const raw = localStorage.getItem(`sb-${projectRef}-auth-token`)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export const useAuthStore = defineStore('auth', () => {
  const stored = readStoredSession()
  const user = ref(stored?.user ?? null)
  const session = ref(stored ?? null)
  const initialized = ref(false)
  // Set to true after a magic-link sign-in so App.vue can prompt passkey registration
  const pendingPasskeySetup = ref(false)

  async function init() {
    // Wait for INITIAL_SESSION — Supabase fires this only after processing any URL hash tokens
    // (invite links, magic links). Gating initialized on this event prevents the login page from
    // flashing before a hash-based session is extracted.
    await new Promise((resolve) => {
      supabase.auth.onAuthStateChange((event, s) => {
        session.value = s
        user.value = s?.user ?? null
        if (event === 'INITIAL_SESSION') {
          initialized.value = true
          resolve()
        }
      })
    })

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        supabase.auth.getSession().then(({ data }) => {
          session.value = data.session
          user.value = data.session?.user ?? null
        })
      }
    })
  }

  async function signOut() {
    await supabase.auth.signOut({ scope: 'local' })
  }

  return { user, session, initialized, pendingPasskeySetup, init, signOut }
})
