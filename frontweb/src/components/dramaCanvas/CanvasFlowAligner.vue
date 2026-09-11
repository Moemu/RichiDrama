<template>
  <span class="canvas-flow-aligner" aria-hidden="true" />
</template>

<script setup>
import { nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useNodesInitialized, useVueFlow } from '@vue-flow/core'
import { useCanvasContext } from '@/composables/useCanvasContext'

const props = defineProps({ episodeId: { type: Number, default: null } })
const { fitView, getViewport, getNodes } = useVueFlow()
const nodesInitialized = useNodesInitialized()
const ctx = useCanvasContext()
let fittedEpisodeId = null

watch([() => props.episodeId, nodesInitialized, getNodes], async ([episodeId, initialized]) => {
  if (!initialized || episodeId === fittedEpisodeId) return
  const scripts = getNodes.value.filter(node => node.type === 'canvasScript')
  // Wait for the selected episode's graph, not the previous all-episode graph.
  if (episodeId != null && (scripts.length !== 1 || scripts[0].id !== `script:${episodeId}`)) return
  await nextTick()
  if (props.episodeId !== episodeId || episodeId === fittedEpisodeId) return
  fittedEpisodeId = episodeId
  await fitView({
    ...(episodeId != null ? { nodes: [`script:${episodeId}`, `episode:${episodeId}`] } : {}),
    padding: 0.2,
    maxZoom: 1,
    duration: 250,
  })
}, { flush: 'post' })

onMounted(() => {
  ctx?.registerCanvasFlowApi?.({ fitView, getViewport })
})

onUnmounted(() => {
  ctx?.registerCanvasFlowApi?.(null)
})
</script>

<style scoped>
.canvas-flow-aligner {
  display: none;
}
</style>
