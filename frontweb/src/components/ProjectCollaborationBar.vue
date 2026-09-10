<template>
  <div v-if="projectSession.enabled" class="project-collaboration-bar" role="status">
    <span :class="{ offline: !projectSession.connected }">{{ projectSession.connected ? (projectSession.pending ? '正在保存…' : '协作已连接') : '连接已断开 · 文本修改保留在此页面' }}</span>
    <span class="participants">{{ names || '当前仅你在线' }}</span>
    <span v-if="!projectSession.canEdit">只读成员</span>
    <span v-if="projectSession.error" class="collaboration-error">{{ projectSession.error }}</span>
    <button v-if="projectSession.error && projectSession.connected" type="button" @click="retryPendingProjectText">重试保存</button>
    <details v-if="projectSession.drafts.length"><summary>恢复草稿（{{ projectSession.drafts.length }}）</summary><article v-for="(draft,index) in projectSession.drafts" :key="index"><b>{{ draft.key }}</b><textarea readonly :value="draft.text" aria-label="未确认的草稿" /></article></details>
    <ProjectSuggestions :drama-id="dramaId" />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, watch } from 'vue'
import ProjectSuggestions from './ProjectSuggestions.vue'
import { closeProjectSession, openProjectSession, projectSession, retryPendingProjectText } from '@/composables/useProjectCollaboration'
const props = defineProps({ dramaId: { type: [Number, String], required: true } })
const emit = defineEmits(['refresh'])
function editingLabel(location) {
  if (!location) return ''
  const [kind, id, field] = location.split(':')
  const entity = ({ dramas: '项目', episodes: '分集', storyboards: '分镜', characters: '角色', scenes: '场景', props: '道具', assets: '素材' })[kind] || '内容'
  const label = ({ description: '简介', script_content: '剧本', universal_segment_text: '提示词', image_prompt: '图片提示词', video_prompt: '视频提示词', prompt: '提示词' })[field] || '文本'
  return ` · 正在编辑${entity} ${id || ''} 的${label}`
}
const names = computed(() => [...new Map(projectSession.participants.map(person => [person.id, person])).values()].map(person => person.name + editingLabel(person.editing)).join('、'))
let deferred
const refresh = () => {
  clearTimeout(deferred)
  if (document.activeElement?.matches('input,textarea,[contenteditable="true"]') || document.querySelector('.el-dialog[aria-modal="true"]')) {
    deferred = setTimeout(refresh, 1000)
    return
  }
  emit('refresh')
}
watch(() => props.dramaId, async id => {
  if (!id) return
  try { await openProjectSession(id, refresh) }
  catch (error) { projectSession.error = error.message }
}, { immediate: true })
onBeforeUnmount(() => { clearTimeout(deferred); closeProjectSession() })
</script>

<style scoped>
.project-collaboration-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 20px;padding:10px 16px;border:1px solid var(--border-subtle);border-radius:12px;background:var(--bg-surface);font-size:12px;color:var(--text-muted)}
.project-collaboration-bar>span:first-child{color:var(--accent)}.project-collaboration-bar .offline,.collaboration-error{color:var(--el-color-warning)}.participants{flex:1;min-width:0;overflow-wrap:anywhere}details{width:100%}textarea{width:100%;min-height:120px;box-sizing:border-box}
</style>
