<template>
  <div
    class="col"
    :class="{ 'drag-over': dragOver }"
    :data-stage="stageIndex"
    :data-stage-id="stage.id"
    @dragover.prevent
  >
    <div class="col-head">
      <i :class="`ph ph-${getStageIcon(stage)}`" class="col-icon" aria-hidden="true"></i>
      <span class="col-name">{{ stage.name }}</span>
    </div>
    <div class="col-body" :id="'col-' + stageIndex" role="list">
      <div v-if="!projects.length" class="empty-col"><i class="ph ph-hand-waving" aria-hidden="true"></i></div>
      <ProjectCard
        v-for="project in projects"
        :key="project.id"
        :project="project"
        :stage="stage"
        @click="$emit('card-click', project)"
      />
      <div class="drop-placeholder" aria-hidden="true"></div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useBoardStore } from '../stores/board.js'
import { getStageIcon } from '../lib/helpers.js'
import ProjectCard from './ProjectCard.vue'

const props = defineProps({
  stage: { type: Object, required: true },
  stageIndex: { type: Number, required: true },
  overrideProjects: { type: Array, default: null },
})

defineEmits(['card-click'])

const store = useBoardStore()
const dragOver = ref(false)

const projects = computed(() => {
  if (props.overrideProjects) return props.overrideProjects
  let list = store.displayProjects.filter(p => {
    const s = store.projectStage(p.id)
    return s && s.id === props.stage.id
  })
  if (store.activeFilter) {
    const { type, value } = store.activeFilter
    list = list.filter(p => {
      if (type === 'person') return (p.collaborators || []).includes(value)
      if (type === 'venue') return p.venue === value
      return true
    })
  }
  return list.sort((a, b) => {
    const da = store.projectDeadline(a.id)
    const db = store.projectDeadline(b.id)
    if (!da && !db) return 0
    if (!da) return 1
    if (!db) return -1
    return da - db
  })
})

defineExpose({ dragOver })
</script>
