<template>
  <div
    class="col"
    :class="{ 'drag-over': dragOver }"
    :data-stage="stageIndex"
    :data-stage-label="stage.label"
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
import { getProjectDeadline, stripPersonPrefix, getStageIcon } from '../lib/helpers.js'
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
  const stageSet = new Set(store.stageLabels)
  let list = store.displayProjects.filter(p => {
    const s = store.projectStage(p.id)
    return s && s.label === props.stage.label
  })
  if (store.activeFilter) {
    const { type, value } = store.activeFilter
    list = list.filter(p => {
      if (type === 'person') {
        const stage = store.projectStage(p.id)
        return stage && (stage.task.labels || []).some(l => stripPersonPrefix(l) === value)
      }
      if (type === 'venue') {
        const meta = store.projectMeta(p.id)
        return meta.venue === value
      }
      return true
    })
  }
  return list.sort((a, b) => {
    const da = getProjectDeadline(store.tasks, store.deadlineSectionIds, a.id)
    const db = getProjectDeadline(store.tasks, store.deadlineSectionIds, b.id)
    if (!da && !db) return 0
    if (!da) return 1
    if (!db) return -1
    return da - db
  })
})

defineExpose({ dragOver })
</script>
