<template>
  <div class="generation-card" :class="{ selected }">
    <Handle type="target" :position="Position.Left" />
    <div class="card-heading"><NodeTitle v-model="data.title" :placeholder="data.draftType === 'video' ? '视频生成' : '图片生成'" @update:model-value="data.onChange()" /><span>{{ statusLabel }}</span></div>
    <div class="preview">
      <video v-if="data.output?.type === 'video' && data.output.url" class="nodrag nopan nowheel" :src="data.output.url" controls playsinline preload="metadata" />
      <img v-else-if="data.output?.url" :src="data.output.url" alt="节点最新完成的输出" draggable="false" />
      <span v-else>{{ busy ? '生成中…' : '运行后在这里显示输出' }}</span>
    </div>
    <div v-if="selected" class="node-editor nodrag nopan nowheel" @pointerdown.stop @keydown.stop @wheel.stop>
      <fieldset :disabled="locked">
        <label>提示词<textarea v-model="data.prompt" rows="6" maxlength="10000" placeholder="描述要生成的内容" @input="data.onChange()" /></label>
        <GenerationSettings v-if="data.draftType === 'video'" class="in-node" :model-value="videoSettings" include-generation-quote @update:model-value="updateVideoSettings" />
        <template v-else>
          <label>模型<select v-model="data.model" @change="data.onChange()"><option value="" disabled>选择模型</option><option v-for="model in models" :key="model" :value="model">{{ model }}</option></select></label>
          <label>画幅<select v-model="data.aspectRatio" @change="data.onChange()"><option>16:9</option><option>9:16</option><option>1:1</option></select></label>
        </template>
      </fieldset>
      <div class="inputs"><span v-if="!data.inputs?.length">左侧端口连接参考输入（可选）</span><div v-for="input in data.inputs" :key="input.id" class="input-row"><span :title="input.name">{{ input.ready ? '●' : '○' }} {{ input.name }}</span><small>{{ input.usage }}</small><button :disabled="locked" :aria-label="`移除参考 ${input.name}`" @click="data.onRemoveInput(input.id)">×</button></div></div>
      <p v-if="data.upstreamText?.length" class="upstream-hint">上游文本 {{ data.upstreamText.length }} 段将拼在本节点提示词之前</p>
    </div>
    <p v-else class="prompt-summary">{{ data.prompt || '点击节点填写提示词与参数' }}</p>
    <p v-if="data.submitError || data.latest?.error_msg" class="error">{{ data.submitError || data.latest.error_msg }}</p>
    <p v-if="data.pendingRequest" class="pending-hint">请求尚待确认；重试复用原请求，不新建计费请求。</p>
    <div class="actions nodrag nopan" @pointerdown.stop @keydown.stop>
      <button class="run-button" :disabled="data.submitting || (!data.pendingRequest && (busy || !data.effectivePrompt || !data.model))" @click="data.onRun(id)">{{ data.submitting ? '提交中…' : data.pendingRequest ? '确认／重试请求' : busy ? '生成中…' : data.versionCount ? '再次生成' : '生成' }}</button>
      <button v-if="busy && data.draftType === 'video'" @click="data.onCancel(id)">取消任务</button>
      <small v-if="data.versionCount">{{ data.versionCount }} 个版本</small>
    </div>
    <div v-if="data.output" class="output-actions nodrag nopan" @pointerdown.stop>
      <a v-if="data.output.local_path && data.output.url" :href="data.output.url" download @click.stop>下载成果</a>
      <button v-if="data.draftType === 'video'" @click="data.onDelivery(id)">加入合并导出</button>
    </div>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>
<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import NodeTitle from './NodeTitle.vue'
import GenerationSettings from '@/components/GenerationSettings.vue'
import { videoSettingsFor } from '@/utils/creativeBoardWorkflow'
const videoSettings = computed(() => videoSettingsFor(props.data))
function updateVideoSettings(value) {
  if (locked.value) return
  Object.assign(props.data, { model: value.video_model, duration: value.duration, resolution: value.resolution, aspectRatio: value.aspect_ratio, upscale_resolution: value.upscale_resolution, target_fps: value.target_fps })
  props.data.onChange()
}
const props = defineProps({ id: { type: String, required: true }, data: { type: Object, required: true }, selected: Boolean })
const busy = computed(() => ['pending', 'processing', 'sd2_waiting'].includes(props.data.latest?.status))
const locked = computed(() => props.data.submitting || !!props.data.pendingRequest)
const models = computed(() => props.data.draftType === 'image' ? props.data.imageModels || [] : (props.data.capabilities || []).map((item) => item.model))
const statusLabel = computed(() => ({ completed: '已完成', failed: '失败', pending: '排队中', processing: '生成中', sd2_waiting: '等待中', cancelled: '已取消' }[props.data.latest?.status] || '待运行'))
</script>
<style scoped>
.generation-card{width:300px;border:1px solid #40516a;border-radius:12px;background:#171f2b;color:#f0f4fa;box-shadow:0 9px 28px #0004}.generation-card.selected{border-color:#a3b4ff;box-shadow:0 0 0 2px #829dff40}.card-heading{display:flex;justify-content:space-between;gap:8px;padding:12px;font-size:12px}.card-heading span{color:#97aac2}.preview{display:grid;place-items:center;height:168px;background:#0c1119;color:#8798ab;font-size:12px}.preview img,.preview video{width:100%;height:100%;object-fit:contain;max-height:168px}.node-editor{padding:12px;overscroll-behavior:contain}.node-editor fieldset{display:grid;gap:10px;border:0;padding:0;margin:0;min-width:0}.node-editor label{display:grid;gap:5px;color:#aab9ce;font-size:11px}.node-editor textarea,.node-editor select,.node-editor input[type=number]{box-sizing:border-box;width:100%;min-width:0;border:1px solid #394960;border-radius:6px;background:#101824;color:#edf2f9;padding:8px;font:inherit}.node-editor textarea{resize:vertical;min-height:96px;line-height:1.55;font-size:12px}
/* The storyboard settings component is designed for full-width panels; shrink it to fit the node editor. */
.node-editor :deep(.generation-settings){grid-template-columns:minmax(0,1fr);gap:8px;padding:8px;border-radius:8px;min-width:0}
.node-editor :deep(.generation-settings .ui-choice-field){position:relative;min-width:0}
.node-editor :deep(.generation-settings .ui-choice-field__label){overflow:hidden;font-size:10px;text-overflow:ellipsis;white-space:nowrap}
.node-editor :deep(.generation-settings .ui-choice-field__trigger){min-height:28px;padding:4px 8px;font-size:11px}
.node-editor :deep(.generation-settings .ui-choice-field__value){font-size:11px}
.node-editor :deep(.generation-settings .ui-choice-field__chevron){font-size:14px}
.node-editor :deep(.generation-settings .ui-choice-field__panel){position:absolute;bottom:calc(100% + 4px);left:0;right:0;z-index:30;box-sizing:border-box;width:auto;max-height:200px;padding:3px;min-width:0;overflow:auto}
.node-editor :deep(.generation-settings .ui-choice-field__option){min-height:0;padding:6px 8px}
.node-editor :deep(.generation-settings .ui-choice-field__option-copy){min-width:0;max-width:100%}
.node-editor :deep(.generation-settings .ui-choice-field__option-copy b){font-size:11px;font-weight:550;line-height:1.3;overflow-wrap:anywhere}
.node-editor :deep(.generation-settings .ui-choice-field__option-copy small){font-size:10px;line-height:1.3;overflow-wrap:anywhere}
.node-editor :deep(.generation-settings .ui-choice-field__check){font-size:11px}
.node-editor :deep(.generation-settings .postprocess-quote){padding:6px 8px;font-size:10px;line-height:1.45}.parameter-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}.node-editor .checkbox{display:flex;align-items:center}.inputs{margin-top:12px;color:#96a9bf;font-size:11px}.input-row{display:flex;align-items:center;gap:5px;padding:5px 0}.input-row>span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.input-row small{white-space:nowrap}.prompt-summary{padding:0 12px;white-space:pre-wrap;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;font-size:12px;line-height:1.5}.actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px}.actions small{color:#96a9bf;font-size:10px}.output-actions{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 12px}button{border:1px solid #41516b;border-radius:6px;padding:6px 8px;background:#223047;color:#dce5f4;font-size:11px;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}.run-button{background:#6556c7;border-color:#8574e5;color:white;flex:1}.error,.pending-hint{padding:0 12px;color:#f2a5a5;font-size:11px;overflow-wrap:anywhere}.pending-hint{color:#e5c888}.upstream-hint{margin:8px 0 0;padding:0 12px;color:#a9b6e8;font-size:11px}:focus-visible{outline:2px solid #b6c3ff;outline-offset:2px}
</style>
