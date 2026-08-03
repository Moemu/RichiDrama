<template>
  <section class="generation-settings" aria-label="生成参数">
    <label v-if="showTextModel">文本模型
      <el-select :model-value="value.text_model || 'auto'" size="small" @update:model-value="set('text_model', $event)">
        <el-option label="自动 / 默认文本模型" value="auto" />
        <el-option v-for="item in textModels" :key="item" :label="item" :value="item" />
      </el-select>
    </label>
    <label>视频模型
      <el-select :model-value="value.video_model || 'auto'" size="small" @update:model-value="set('video_model', $event)">
        <el-option label="自动匹配" value="auto" />
        <el-option v-for="item in videoModels" :key="item.model" :label="item.is_default ? `${item.model}（默认）` : item.model" :value="item.model" />
      </el-select>
    </label>
    <label>时长（秒）
      <el-input-number :model-value="duration" :min="1" :max="maxDuration" :step="1" size="small" @update:model-value="set('duration', $event)" />
    </label>
    <label>分辨率
      <el-select :model-value="value.resolution || '720p'" size="small" @update:model-value="set('resolution', $event)">
        <el-option label="480p" value="480p" /><el-option label="720p" value="720p" /><el-option label="1080p" value="1080p" />
      </el-select>
    </label>
    <label>宽高比
      <el-select :model-value="value.aspect_ratio || '16:9'" size="small" @update:model-value="set('aspect_ratio', $event)">
        <el-option label="16:9" value="16:9" /><el-option label="9:16" value="9:16" /><el-option label="1:1" value="1:1" />
      </el-select>
    </label>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { aiAPI } from '@/api/ai'
import { omniVideoAPI } from '@/api/omniVideo'

const props = defineProps({ modelValue: { type: Object, default: () => ({}) }, showTextModel: { type: Boolean, default: false }, maxDuration: { type: Number, default: 60 } })
const emit = defineEmits(['update:modelValue'])
const textModels = ref([]), videoModels = ref([])
const value = computed(() => props.modelValue || {})
const duration = computed(() => Math.min(props.maxDuration, Math.max(1, Number(value.value.duration) || 5)))
function set(key, next) { emit('update:modelValue', { ...value.value, [key]: key === 'duration' ? Math.min(props.maxDuration, Math.max(1, Number(next) || 5)) : next }) }
function configModels(configs) { return [...new Set((configs || []).filter((item) => item.is_active !== false).flatMap((item) => Array.isArray(item.model) ? item.model : item.model ? [item.model] : []).filter(Boolean))] }
onMounted(async () => {
  const [text, video] = await Promise.allSettled([aiAPI.list('text'), omniVideoAPI.capabilities()])
  if (text.status === 'fulfilled') textModels.value = configModels(text.value)
  if (video.status === 'fulfilled') videoModels.value = Array.isArray(video.value) ? video.value : []
})
</script>

<style scoped>
.generation-settings{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 12px;width:100%;padding:10px 12px;border:1px solid var(--el-border-color-lighter);border-radius:8px;background:var(--el-fill-color-light)}.generation-settings label{display:grid;gap:5px;font-size:12px;color:var(--el-text-color-regular)}.generation-settings :deep(.el-select),.generation-settings :deep(.el-input-number){width:100%}@media(max-width:700px){.generation-settings{grid-template-columns:1fr 1fr}}@media(max-width:420px){.generation-settings{grid-template-columns:1fr}}
</style>
