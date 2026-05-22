<template>
  <aside class="board-sidebar" :class="{ collapsed: sidebarCollapsed }">
    <!-- Brand header -->
    <div class="sidebar-brand">
      <button
        class="sidebar-collapse-btn"
        :title="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="toggleSidebar"
      >
        <i class="ph ph-sidebar-simple" aria-hidden="true"></i>
      </button>
    </div>

    <!-- Nav items -->
    <nav class="sidebar-nav">
      <button
        class="sidebar-nav-item"
        :class="currentPage === 'inbox' ? 'sidebar-nav-active' : ''"
        :aria-current="currentPage === 'inbox' ? 'page' : undefined"
        title="Inbox"
        @click="currentPage !== 'inbox' && goInbox()"
      >
        <i class="ph ph-tray" aria-hidden="true"></i>
        <span class="sidebar-label">Inbox</span>
      </button>

      <button
        class="sidebar-nav-item"
        :class="currentPage === 'board' ? 'sidebar-nav-active' : ''"
        :aria-current="currentPage === 'board' ? 'page' : undefined"
        title="Board"
        @click="currentPage !== 'board' && goBoard()"
      >
        <i class="ph ph-kanban" aria-hidden="true"></i>
        <span class="sidebar-label">Board</span>
      </button>

      <button
        class="sidebar-nav-item"
        :class="currentPage === 'schedule' ? 'sidebar-nav-active' : ''"
        title="Schedule"
        @click="currentPage !== 'schedule' && goSchedule()"
      >
        <i class="ph ph-calendar-dots" aria-hidden="true"></i>
        <span class="sidebar-label">Schedule</span>
      </button>
    </nav>

    <!-- Scrollable middle: filters slot + collaborators + venues -->
    <div class="sidebar-scroll">
      <slot name="filters" />

      <!-- Collaborators section -->
      <template v-if="!$slots.filters && store.allCollaborators.length">
        <button
          class="sidebar-section-header"
          :aria-expanded="collabOpen"
          @click="collabOpen = !collabOpen"
        >
          <span class="sidebar-section-label">Collaborators</span>
          <i
            class="ph ph-caret-down sidebar-section-chevron"
            :class="{ open: collabOpen }"
            aria-hidden="true"
          ></i>
        </button>
        <template v-if="collabOpen">
          <button
            v-for="person in store.allCollaborators"
            :key="person"
            class="sidebar-nav-item"
            :class="{ 'sidebar-filter-active': store.activeFilter?.type === 'person' && store.activeFilter?.value === person }"
            :title="person"
            @click="store.setFilter('person', person)"
          >
            <span class="sidebar-avatar" aria-hidden="true">{{ person.slice(0, 2).toUpperCase() }}</span>
            <span class="sidebar-label">{{ person }}</span>
          </button>
        </template>
      </template>

      <!-- Venues section -->
      <template v-if="!$slots.filters && store.allVenues.length">
        <button
          class="sidebar-section-header"
          :aria-expanded="venuesOpen"
          @click="venuesOpen = !venuesOpen"
        >
          <span class="sidebar-section-label">Venues</span>
          <i
            class="ph ph-caret-down sidebar-section-chevron"
            :class="{ open: venuesOpen }"
            aria-hidden="true"
          ></i>
        </button>
        <template v-if="venuesOpen">
          <button
            v-for="venue in store.allVenues"
            :key="venue"
            class="sidebar-nav-item"
            :class="{ 'sidebar-filter-active': store.activeFilter?.type === 'venue' && store.activeFilter?.value === venue }"
            :title="venue"
            @click="store.setFilter('venue', venue)"
          >
            <span class="sidebar-venue-dot" aria-hidden="true"></span>
            <span class="sidebar-label">{{ venue }}</span>
          </button>
        </template>
      </template>
    </div>

    <!-- Footer -->
    <div class="sidebar-footer">
      <button
        class="sidebar-nav-item"
        :class="currentPage === 'settings' ? 'sidebar-nav-active' : ''"
        title="Settings"
        @click="currentPage !== 'settings' && goSettings()"
      >
        <i class="ph ph-gear" aria-hidden="true"></i>
        <span class="sidebar-label">Settings</span>
      </button>
    </div>
  </aside>
</template>

<script setup>
import { ref, computed } from 'vue'
import { f7 } from 'framework7-vue/bundle'
import { useBoardStore } from '../stores/board.js'
import { useSidebar } from '../composables/useSidebar.js'

const props = defineProps({
  currentPage: { type: String, default: 'board' },
})
defineEmits([])

const store = useBoardStore()
const { sidebarCollapsed, toggleSidebar } = useSidebar()

const collabOpen = ref(true)
const venuesOpen = ref(true)


function goBoard()    { f7.tab.show('#view-board') }
function goInbox()    { f7.tab.show('#view-inbox') }
function goSchedule() { f7.tab.show('#view-schedule') }
function goSettings() { f7.tab.show('#view-settings') }
</script>
