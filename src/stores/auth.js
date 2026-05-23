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

  // Validate/refresh session in the background after mount
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
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return { user, session, init, signIn, signOut }
})
