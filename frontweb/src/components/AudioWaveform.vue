<template><canvas ref="canvas" class="audio-waveform" aria-label="音频波形预览"></canvas></template>

<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({ src: { type: String, default: '' } })
const canvas = ref(null)
let context = null

function paintFallback(target) {
  const ctx = target.getContext('2d')
  const width = Math.max(280, target.clientWidth || 560), height = 64
  target.width = width * devicePixelRatio; target.height = height * devicePixelRatio
  target.style.height = `${height}px`; ctx.scale(devicePixelRatio, devicePixelRatio)
  ctx.fillStyle = '#111821'; ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = '#587d9f'; ctx.lineWidth = 1
  for (let x = 3; x < width; x += 5) { const h = 10 + ((x * 17) % 34); ctx.beginPath(); ctx.moveTo(x, (height - h) / 2); ctx.lineTo(x, (height + h) / 2); ctx.stroke() }
}

async function renderWaveform() {
  await nextTick()
  const target = canvas.value
  if (!target) return
  paintFallback(target)
  if (!props.src) return
  try {
    context ||= new (window.AudioContext || window.webkitAudioContext)()
    const response = await fetch(props.src)
    if (!response.ok) throw new Error('audio fetch failed')
    const decoded = await context.decodeAudioData((await response.arrayBuffer()).slice(0))
    const data = decoded.getChannelData(0), ctx = target.getContext('2d')
    const width = target.width / devicePixelRatio, height = target.height / devicePixelRatio, step = Math.max(1, Math.floor(data.length / width))
    ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#111821'; ctx.fillRect(0, 0, width, height); ctx.strokeStyle = '#6fa9d3'; ctx.lineWidth = 1
    for (let x = 0; x < width; x++) { let peak = 0; const start = x * step; for (let i = start; i < Math.min(data.length, start + step); i++) peak = Math.max(peak, Math.abs(data[i])); const h = Math.max(2, peak * height * .9); ctx.beginPath(); ctx.moveTo(x + .5, (height - h) / 2); ctx.lineTo(x + .5, (height + h) / 2); ctx.stroke() }
  } catch (_) { /* 远程跨域媒体无法解码时保留可读的试听占位。 */ }
}

watch(() => props.src, renderWaveform, { immediate: true })
onBeforeUnmount(() => context?.close().catch(() => {}))
</script>

<style scoped>.audio-waveform{display:block;width:100%;border:1px solid #334050;border-radius:6px;background:#111821}</style>
