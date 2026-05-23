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

// Guard: prevent watchers from re-saving settings that were just loaded
const settingsLoaded = ref(false)

watch(() => store.stages, (stages) => {
  if (!settingsLoaded.value || !stages) return
  settingsStore.save('stages', stages)
}, { deep: true })

watch(() => reviewsStore.sites, (sites) => {
  if (!settingsLoaded.value) return
  settingsStore.save('hotcrp_sites', sites)
}, { deep: true })

watch(() => calStore.selectedCalendarId, (id) => {
  if (!settingsLoaded.value) return
  settingsStore.save('gcal_calendar_id', id)
})

onMounted(async () => {
  await authStore.init()
  calStore.init().catch(() => {})

  const settings = await settingsStore.load()

  if (settings.stages?.length)      store.saveStages(settings.stages)
  if (settings.hotcrp_sites)        reviewsStore.setSites(settings.hotcrp_sites)
  if (settings.gcal_calendar_id)    calStore.saveCalendarId(settings.gcal_calendar_id)

  // Let Vue flush reactive updates so watch callbacks fire while settingsLoaded=false
  await nextTick()
  settingsLoaded.value = true

  // Backfill: write any settings not yet in Supabase
  if (!settings.stages && store.stages?.length)
    settingsStore.save('stages', store.stages)
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
