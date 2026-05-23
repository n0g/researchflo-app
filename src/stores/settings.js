import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase.js'

export const useSettingsStore = defineStore('settings', () => {
  async function load() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return {}
      const { data } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', user.id)
        .single()
      return data || {}
    } catch (e) {
      console.warn('[settings] load failed:', e.message)
      return {}
    }
  }

  async function save(key, value) {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, [key]: value }, { onConflict: 'user_id' })
    } catch (e) {
      console.warn('[settings] save failed:', e.message)
    }
  }

  return { load, save }
})
