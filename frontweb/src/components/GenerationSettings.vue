<template>
  <section class="generation-settings" aria-label="生成参数">
    <UiChoiceField v-if="showTextModel" label="文本模型" :model-value="value.text_model || 'auto'" :options="textModelOptions" @update:model-value="set('text_model', $event)" />
    <UiChoiceField label="视频模型" :model-value="value.video_model || ''" :options="videoModelOptions" @update:model-value="set('video_model', $event)" />
    <UiChoiceField class="duration-setting" label="时长（秒）" :model-value="duration" :options="durationOptions.map((second) => ({ label: `${second} 秒`, value: second }))" @update:model-value="set('duration', $event)" />
    <UiChoiceField label="分辨率" :model-value="value.resolution || '720p'" :options="resolutionOptions" @update:model-value="set('resolution', $event)" />
    <UiChoiceField label="AI 超分（新镜头默认 1080p）" :model-value="value.upscale_resolution || ''" :options="upscaleOptions" @update:model-value="set('upscale_resolution', $event || null)" />
    <UiChoiceField label="智能插帧（按需）" :model-value="value.target_fps || ''" :options="fpsOptions" @update:model-value="set('target_fps', $event || null)" />
    <UiChoiceField label="宽高比" :model-value="value.aspect_ratio || '16:9'" :options="aspectRatioOptions" @update:model-value="set('aspect_ratio', $event)" />
    <div class="postprocess-quote" role="status" aria-live="polite" :aria-busy="quoteLoading">
      <b>产出链路：</b>{{ quote?.chain || localChain }}
      <span v-if="quoteLoading"> · 正在核算</span>
      <span v-else-if="quote"> · 预计 {{ formatPoints(quote.estimated_total_points) }} 积分</span>
      <small>最终按本地成片实测时长、分辨率和帧率结算；未选择的阶段不预授权、不调用、不扣费。</small>
    </div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { aiAPI } from '@/api/ai'
import { omniVideoAPI } from '@/api/omniVideo'
import { videosAPI } from '@/api/videos'
import UiChoiceField from '@/components/ui/UiChoiceField.vue'

const props = defineProps({ modelValue: { type: Object, default: () => ({}) }, showTextModel: { type: Boolean, default: false }, maxDuration: { type: Number, default: 60 } })
const emit = defineEmits(['update:modelValue'])
const textModels = ref([]), videoModels = ref([])
let modelOptionsCache = null
let modelOptionsPromise = null
const value = computed(() => props.modelValue || {})
const duration = computed(() => Math.min(props.maxDuration, Math.max(4, Number(value.value.duration) || 15)))
const durationOptions = computed(() => Array.from({ length: Math.max(0, props.maxDuration - 3) }, (_, index) => index + 4))
const textModelOptions = computed(() => [{ label: '自动选择', description: '使用当前默认文本模型', value: 'auto' }, ...textModels.value.map((item) => ({ label: displayModelName(item), value: item }))])
const videoModelOptions = computed(() => videoModels.value.map((item) => ({ label: displayModelName(item.model), description: item.is_default ? '默认模型' : '', value: item.model })))
const resolutionOptions = [{ label: '480p', value: '480p' }, { label: '720p', value: '720p' }, { label: '1080p', value: '1080p' }]
const fpsOptions = [{ label: '不插帧', description: '保持原始帧率', value: '' }, { label: '60 fps', value: 60 }, { label: '120 fps', value: 120 }]
const aspectRatioOptions = ['16:9', '9:16', '1:1', '3:4', '4:3', '3:2', '2:3', '21:9'].map((item) => ({ label: item, value: item }))
const upscaleOptions = computed(() => {
  const resolution = String(value.value.resolution || '720p').toLowerCase()
  const items = [{ label: '不超分（保持原分辨率）', value: '' }]
  if (resolution === '480p') items.push({ label: '超分至 720p', value: '720p' }, { label: '超分至 1080p', value: '1080p' })
  else if (resolution === '720p') items.push({ label: '超分至 1080p', value: '1080p' })
  return items
})
const localChain = computed(() => ['生成原片', value.value.upscale_resolution ? `AI 超分 ${value.value.upscale_resolution}` : '', value.value.target_fps ? `AI 插帧 ${value.value.target_fps}fps` : '', `本地规范 ${value.value.aspect_ratio || '16:9'}`, '最终成片'].filter(Boolean).join(' → '))
const quote = ref(null), quoteLoading = ref(false)
let quoteTimer = null, quoteRevision = 0
function formatPoints(value) { return Number(value || 0).toFixed(4).replace(/\.?(?:0+)$/, '') }
function displayModelName(model) {
  return String(model || '') || '未选择'
}
function set(key, next) {
  const nextValue = { ...value.value, [key]: key === 'duration' ? Math.min(props.maxDuration, Math.max(4, Number(next) || 15)) : next }
  if (key === 'resolution') {
    const allowed = next === '480p' ? ['720p', '1080p'] : next === '720p' ? ['1080p'] : []
    if (!allowed.includes(nextValue.upscale_resolution)) nextValue.upscale_resolution = null
  }
  emit('update:modelValue', nextValue)
}
function scheduleQuote() {
  clearTimeout(quoteTimer)
  const upscale = value.value.upscale_resolution || null
  const fps = value.value.target_fps || null
  if (!upscale && !fps) {
    quote.value = { chain: localChain.value, estimated_total_points: 0, stages: [] }
    quoteLoading.value = false
    return
  }
  const revision = ++quoteRevision
  quoteLoading.value = true
  quoteTimer = setTimeout(async () => {
    try {
      const result = await videosAPI.postprocessQuote({ duration: duration.value, resolution: value.value.resolution || '720p', aspect_ratio: value.value.aspect_ratio || '16:9', upscale_resolution: upscale, target_fps: fps, source_fps: 30 })
      if (revision === quoteRevision) quote.value = result
    } catch (_) {
      if (revision === quoteRevision) quote.value = null
    } finally { if (revision === quoteRevision) quoteLoading.value = false }
  }, 250)
}
watch(() => [value.value.duration, value.value.resolution, value.value.aspect_ratio, value.value.upscale_resolution, value.value.target_fps], scheduleQuote, { immediate: true })
onBeforeUnmount(() => clearTimeout(quoteTimer))
function configModels(configs) { return [...new Set((configs || []).filter((item) => item.is_active !== false).flatMap((item) => Array.isArray(item.model) ? item.model : item.model ? [item.model] : []).filter(Boolean))] }
onMounted(async () => {
  if (!modelOptionsPromise) {
    modelOptionsPromise = Promise.allSettled([aiAPI.list('text'), omniVideoAPI.capabilities()]).then(([text, video]) => ({
      text: text.status === 'fulfilled' ? configModels(text.value) : [],
      video: video.status === 'fulfilled' && Array.isArray(video.value) ? video.value : [],
    })).then((result) => { modelOptionsCache = result; return result })
  }
  const options = modelOptionsCache || await modelOptionsPromise
  textModels.value = options.text
  videoModels.value = options.video
})
</script>

<style scoped>
.generation-settings{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:12px;width:100%;padding:14px;border:1px solid var(--ui-line-1);border-radius:var(--ui-radius-panel);background:var(--ui-surface-1)}.duration-setting{grid-column:span 1}.postprocess-quote{grid-column:1/-1;padding:10px 12px;border:1px solid color-mix(in srgb,var(--ui-accent) 24%,var(--ui-line-1));border-radius:var(--ui-radius-control);background:color-mix(in srgb,var(--ui-accent) 9%,var(--ui-surface-2));color:var(--ui-text-2);font-size:13px;line-height:1.55}.postprocess-quote b{color:var(--ui-text-1)}.postprocess-quote small{display:block;margin-top:5px;color:var(--ui-text-3);line-height:1.5}
/* 窄容器（AI 工具箱控制栏、创作面板）里一律单列，避免选择器被压成 72px。 */
:global(.creation-panel .generation-settings),:global(.control-panel .generation-settings){grid-template-columns:1fr;gap:12px;padding:14px}
:global(.creation-panel .generation-settings .duration-setting){grid-column:1}
:global(.creation-panel .generation-settings .duration-controls){grid-template-columns:minmax(0,1fr) 88px;align-items:center}
:global(.creation-panel .generation-settings .duration-controls .el-input-number){max-width:none}
:global(.creation-panel .generation-settings .duration-controls .el-button){padding-inline:4px;font-size:12px}
@media(max-width:700px){.generation-settings{grid-template-columns:1fr 1fr}}@media(max-width:420px){.generation-settings{grid-template-columns:1fr}}
</style>
