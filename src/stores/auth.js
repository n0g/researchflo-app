import { ref } from 'vue'
import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase.js'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const session = ref(null)
  const loading = ref(true)

  async function init() {
    try {
      const { data } = await supabase.auth.getSession()
      session.value = data.session
      user.value = data.session?.user ?? null
    } catch (e) {
      console.error('Auth init failed:', e)
    } finally {
      loading.value = false
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

  return { user, session, loading, init, signIn, signOut }
})
