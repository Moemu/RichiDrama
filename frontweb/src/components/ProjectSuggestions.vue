<template>
  <details v-if="items.length" class="suggestions">
    <summary>有 {{ items.length }} 项生成内容待确认，原内容已保留</summary>
    <article v-for="item in items" :key="item.id">
      <b>{{ labels[item.entity_kind] || '制作内容' }} {{ item.entity_id }} · {{ fieldLabels[item.field] || '文本内容' }}</b>
      <pre>{{ display(item.proposed_text, item.field) }}</pre>
      <el-button v-if="projectSession.canEdit" @click="compare(item)">比较并应用</el-button>
    </article>
    <el-dialog v-model="visible" title="应用生成内容" width="min(720px, 92vw)">
      <p>当前内容</p><pre>{{ display(currentText, selected?.field) }}</pre><p>生成内容</p><pre>{{ display(selected?.proposed_text, selected?.field) }}</pre>
      <template #footer><el-button @click="visible = false">取消</el-button><el-button type="primary" @click="apply">应用生成内容</el-button></template>
    </el-dialog>
  </details>
</template>
<script setup>
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'
import { projectSession } from '@/composables/useProjectCollaboration'
const props = defineProps({ dramaId: { type: [Number,String], required: true } })
const items = ref([]); const visible = ref(false); const selected = ref(null); const currentText = ref('')
const labels = { dramas: '项目', episodes: '分集', storyboards: '分镜', characters: '角色', scenes: '场景', props: '道具' }
const fieldLabels = { description: '描述', script_content: '剧本', prompt: '提示词', universal_segment_text: '镜头提示词', storyboard_generation: '分镜方案', dialogue: '对白', narration: '旁白', appearance: '外貌' }
function display(value, field) {
  if (field !== 'storyboard_generation') return value
  try { const parsed = JSON.parse(value); return (Array.isArray(parsed) ? parsed : parsed.storyboards || []).map((shot,index) => `镜头 ${index + 1} · ${shot.title || ''}\n${shot.description || shot.action || shot.universal_segment_text || ''}${shot.dialogue ? `\n对白：${shot.dialogue}` : ''}`).join('\n\n') }
  catch { return value }
}
async function load() { try { items.value = await request.get(`/dramas/${props.dramaId}/collaboration/suggestions`) } catch(error) { ElMessage.error(error.message) } }
async function compare(item) {
  try { const result = await request.get(`/dramas/${props.dramaId}/collaboration/suggestions/${item.id}`); currentText.value = result.current_text; selected.value = item; visible.value = true }
  catch(error) { ElMessage.error(error.message) }
}
async function apply() { try { await request.post(`/dramas/${props.dramaId}/collaboration/suggestions/${selected.value.id}/apply`, { expected_text: currentText.value }); visible.value = false; await load() } catch(error) { ElMessage.error(error.message) } }
watch(() => [props.dramaId, projectSession.revision], load, { immediate: true })
</script>
<style scoped>
.suggestions{width:100%;color:var(--text-primary)}article{padding:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:280px;overflow:auto;font:inherit}
</style>
