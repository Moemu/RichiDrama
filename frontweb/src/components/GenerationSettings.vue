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
        <el-option label="请选择视频模型" value="" disabled />
        <el-option v-for="item in videoModels" :key="item.model" :label="item.is_default ? `${item.model}（默认）` : item.model" :value="item.model" />
      </el-select>
    </label>
    <label class="duration-setting">时长（秒）
      <el-select :model-value="duration" size="small" aria-label="视频时长" @update:model-value="set('duration', $event)">
        <el-option v-for="second in durationOptions" :key="second" :label="`${second} 秒`" :value="second" />
      </el-select>
    </label>
    <label>分辨率
      <el-select :model-value="value.resolution || '720p'" size="small" @update:model-value="set('resolution', $event)">
        <el-option label="480p" value="480p" /><el-option label="720p" value="720p" /><el-option label="1080p" value="1080p" />
      </el-select>
    </label>
    <label>宽高比
      <el-select :model-value="value.aspect_ratio || '16:9'" size="small" @update:model-value="set('aspect_ratio', $event)">
        <el-option label="16:9" value="16:9" /><el-option label="9:16" value="9:16" /><el-option label="1:1" value="1:1" /><el-option label="3:4" value="3:4" /><el-option label="4:3" value="4:3" /><el-option label="21:9" value="21:9" />
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
let modelOptionsCache = null
let modelOptionsPromise = null
const value = computed(() => props.modelValue || {})
const duration = computed(() => Math.min(props.maxDuration, Math.max(4, Number(value.value.duration) || 15)))
const durationOptions = computed(() => Array.from({ length: Math.max(0, props.maxDuration - 3) }, (_, index) => index + 4))
function set(key, next) { emit('update:modelValue', { ...value.value, [key]: key === 'duration' ? Math.min(props.maxDuration, Math.max(4, Number(next) || 15)) : next }) }
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
.generation-settings{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 12px;width:100%;padding:10px 12px;border:1px solid var(--el-border-color-lighter);border-radius:8px;background:var(--el-fill-color-light)}.generation-settings label{display:grid;gap:5px;font-size:14px;color:var(--el-text-color-regular)}.generation-settings :deep(.el-select),.generation-settings :deep(.el-input-number){width:100%}.duration-setting{grid-column:span 1}.duration-controls{display:grid;gap:6px}.duration-controls :deep(.el-button-group){display:flex}.duration-controls :deep(.el-button){flex:1;padding-inline:7px}.duration-controls :deep(.el-input-number){max-width:130px}
/* 右侧或左侧窄栏的宽度不足以承载三列，必须按容器而非按屏幕宽度折行。 */
:global(.creation-panel .generation-settings){grid-template-columns:1fr;gap:12px;padding:10px}
:global(.creation-panel .generation-settings .duration-setting){grid-column:1}
:global(.creation-panel .generation-settings .duration-controls){grid-template-columns:minmax(0,1fr) 88px;align-items:center}
:global(.creation-panel .generation-settings .duration-controls .el-input-number){max-width:none}
:global(.creation-panel .generation-settings .duration-controls .el-button){padding-inline:4px;font-size:12px}
@media(max-width:700px){.generation-settings{grid-template-columns:1fr 1fr}}@media(max-width:420px){.generation-settings{grid-template-columns:1fr}}
</style>
