<template>
  <!-- Show nothing while resolving auth session -->
  <div v-if="authStore.loading" class="app-boot" />

  <f7-app v-else v-bind="f7params">
    <!-- Not signed in to Supabase -->
    <f7-view v-if="!authStore.user" main url="/login/" />

    <!-- Signed in but no Todoist token yet -->
    <f7-view v-else-if="!store.token" main url="/token/" />

    <!-- Fully authenticated: tab views -->
    <template v-else>
      <f7-views tabs>
        <f7-view id="view-board"    name="board"    tab tab-active url="/board/"    :browser-history="false" />
        <f7-view id="view-inbox"   name="inbox"   tab url="/inbox/"    :browser-history="false" />
        <f7-view id="view-schedule" name="schedule" tab url="/schedule/" :browser-history="false" />
        <f7-view id="view-settings" name="settings" tab url="/settings/" :browser-history="false" />
      </f7-views>
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

useTheme()
useAccentColor()

const authStore = useAuthStore()
const store = useBoardStore()
const reviewsStore = useReviewsStore()
const calStore = useCalendarStore()
const settingsStore = useSettingsStore()

// Guard: watches only fire for user-made changes, not the initial settings load
const settingsLoaded = ref(false)

watch(() => store.stages, (stages) => {
  if (!settingsLoaded.value || !store.token || !stages) return
  settingsStore.save(store.token, 'stages', stages)
}, { deep: true })

watch(() => reviewsStore.sites, (sites) => {
  if (!settingsLoaded.value || !store.token) return
  settingsStore.save(store.token, 'hotcrp_sites', sites)
}, { deep: true })

watch(() => reviewsStore.proxyUrl, (url) => {
  if (!settingsLoaded.value || !store.token) return
  settingsStore.save(store.token, 'hotcrp_proxy', url)
})

watch(() => calStore.selectedCalendarId, (id) => {
  if (!settingsLoaded.value || !store.token) return
  settingsStore.save(store.token, 'gcal_calendar_id', id)
})

onMounted(async () => {
  await authStore.init()
  if (!store.token) { settingsLoaded.value = true; return }

  const settings = await settingsStore.load(store.token)

  if (settings.stages?.length)      store.saveStages(settings.stages)
  if (settings.hotcrp_sites)        reviewsStore.setSites(settings.hotcrp_sites)
  if (settings.hotcrp_proxy)        reviewsStore.saveProxy(settings.hotcrp_proxy)
  if (settings.gcal_calendar_id)    calStore.saveCalendarId(settings.gcal_calendar_id)

  // Let Vue flush reactive updates so watch callbacks fire while settingsLoaded=false
  await nextTick()
  settingsLoaded.value = true

  // Backfill: write any settings not yet in Todoist (e.g. first run of sync feature)
  if (!settings.stages && store.stages?.length)
    settingsStore.save(store.token, 'stages', store.stages)
  if (!settings.hotcrp_sites && reviewsStore.sites.length)
    settingsStore.save(store.token, 'hotcrp_sites', reviewsStore.sites)
  if (!settings.hotcrp_proxy && reviewsStore.proxyUrl)
    settingsStore.save(store.token, 'hotcrp_proxy', reviewsStore.proxyUrl)
  if (!settings.gcal_calendar_id && calStore.selectedCalendarId && calStore.selectedCalendarId !== 'primary')
    settingsStore.save(store.token, 'gcal_calendar_id', calStore.selectedCalendarId)
})

const f7params = {
  name: 'Research Board',
  theme: 'ios',
  darkMode: false,
  routes,
  touch: {
    iosTouchRipple: false,
    mdTouchRipple: false,
  },
}
</script>
