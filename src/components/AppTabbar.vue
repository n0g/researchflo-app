<template>
  <f7-toolbar no-hairline position="bottom" class="bottom-tabbar">
    <button class="tab-btn" :class="{ 'tab-btn-active': currentTab === 'inbox' }" @click="showTab('inbox')">
      <i class="ph ph-tray" aria-hidden="true"></i>Inbox
    </button>
    <button class="tab-btn" :class="{ 'tab-btn-active': currentTab === 'board' }" @click="showTab('board')">
      <i class="ph ph-kanban" aria-hidden="true"></i>Board
    </button>
    <button class="tab-btn" :class="{ 'tab-btn-active': currentTab === 'schedule' }" @click="showTab('schedule')">
      <i class="ph ph-calendar-dots" aria-hidden="true"></i>Schedule
    </button>
    <button class="tab-btn" :class="{ 'tab-btn-active': currentTab === 'settings' }" @click="showTab('settings')">
      <i class="ph ph-gear" aria-hidden="true"></i>Settings
    </button>
  </f7-toolbar>
</template>

<script setup>
import { f7 } from 'framework7-vue/bundle'

defineProps({ currentTab: { type: String, required: true } })

function showTab(name) { f7.tab.show('#view-' + name) }
</script>
