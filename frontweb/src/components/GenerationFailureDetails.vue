<template>
  <div class="generation-failure-details">
    <b>{{ failure.title }}</b>
    <p>{{ failure.message }}</p>
    <small>{{ failure.action }}</small>
    <div v-if="failure.requestId" class="generation-failure-trace"><span>火山响应 ID</span><code :title="failure.requestId">{{ failure.shortRequestId }}</code><el-button text size="small" @click="copyRequestId">复制响应 ID</el-button></div>
    <details><summary>查看技术详情</summary><div class="generation-failure-raw"><code>{{ failure.rawReason }}</code><el-button size="small" plain @click="copyFullDetails">复制完整失败信息</el-button></div></details>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { generationFailureCopyText, presentGenerationFailure } from '@/utils/generationFailure'
const props = defineProps({ job: { type: Object, required: true } })
const failure = computed(() => presentGenerationFailure(props.job))
async function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value)
  const input = document.createElement('textarea'); input.value = value; input.style.position = 'fixed'; input.style.opacity = '0'; document.body.appendChild(input); input.select(); document.execCommand('copy'); input.remove()
}
async function copyRequestId() { try { await copyText(failure.value.requestId); ElMessage.success('已复制完整响应 ID') } catch { ElMessage.error('复制失败，请在技术详情中手动复制') } }
async function copyFullDetails() { try { await copyText(generationFailureCopyText(props.job)); ElMessage.success('已复制完整失败信息') } catch { ElMessage.error('复制失败，请手动复制技术详情') } }
</script>

<style scoped>
.generation-failure-details{display:grid;min-width:0;gap:4px}.generation-failure-details>b{color:var(--text-primary);font-size:14px}.generation-failure-details p{margin:0;color:var(--text-regular);font-size:13px;line-height:1.55}.generation-failure-details>small{color:var(--text-muted);font-size:12px;line-height:1.55}.generation-failure-trace{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin-top:5px;color:var(--text-muted);font-size:11px}.generation-failure-trace code{max-width:100%;padding:3px 6px;border:1px solid var(--border-subtle);border-radius:5px;background:var(--bg-raised);color:var(--text-regular);font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.generation-failure-details details{margin-top:3px}.generation-failure-details summary{width:max-content;max-width:100%;color:var(--text-muted);font-size:11px;cursor:pointer}.generation-failure-raw{display:grid;gap:8px;margin-top:7px;padding:9px;border:1px solid var(--border-subtle);border-radius:7px;background:color-mix(in srgb,var(--bg-page) 45%,transparent)}.generation-failure-raw code{max-height:120px;overflow:auto;color:var(--text-muted);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;line-height:1.5;overflow-wrap:anywhere;white-space:pre-wrap}.generation-failure-raw .el-button{justify-self:start}
</style>
