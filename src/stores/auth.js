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
  // Set to true after a magic-link sign-in so App.vue can prompt passkey registration
  const pendingPasskeySetup = ref(false)

  async function init() {
    try {
      const { data } = await supabase.auth.getSession()
      session.value = data.session
      user.value = data.session?.user ?? null
    } catch (e) {
      console.error('Auth init failed:', e)
    }

    supabase.auth.onAuthStateChange((_, s) => {
      session.value = s
      user.value = s?.user ?? null
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
    await supabase.auth.signOut()
  }

  return { user, session, pendingPasskeySetup, init, signOut }
})
