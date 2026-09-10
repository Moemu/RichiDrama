<template>
  <section class="project-results" v-loading="loading">
    <header><h2>项目成果</h2><el-select v-model="episodeId" clearable placeholder="全部分集" aria-label="筛选成果分集"><el-option v-for="episode in episodes" :key="episode.id" :value="episode.id" :label="episode.title || `第 ${episode.episode_number} 集`"/></el-select></header>
    <p v-if="!groups.length" class="empty">暂无成果。开始制作后，图片、视频和成片会在这里按分集整理。</p>
    <section v-for="group in groups" :key="group.id" class="result-group" :aria-label="group.title">
      <header class="group-heading"><h3>{{ group.title }}</h3><span>{{ group.items.length }} 项成果</span></header>
      <div class="results-grid">
        <article v-for="item in group.items" :key="`${item.type}-${item.id}`">
          <img v-if="item.type === 'image' && item.local_path" :src="url(item)" :alt="resultTitle(item)" loading="lazy" />
          <video v-else-if="item.local_path" :src="url(item)" controls preload="metadata" />
          <div v-else class="result-placeholder">{{ statusLabel(item.status) }}</div>
          <div class="result-copy"><b>{{ resultTitle(item) }}</b><span>{{ item.storyboard_number != null ? `分镜 ${item.storyboard_number} · ` : '' }}{{ typeLabels[item.type] }} · {{ statusLabel(item.status) }}</span><small v-if="item.creator_name">{{ item.creator_name }}</small></div>
        </article>
      </div>
    </section>
  </section>
</template>
<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'
import { projectSession } from '@/composables/useProjectCollaboration'
import { groupProjectResults, resultTitle } from '@/utils/projectResults'
const props = defineProps({ dramaId: { type: [Number, String], required: true }, episodes: { type: Array, default: () => [] } })
const results = ref([]); const episodeId = ref(null); const loading = ref(false)
const groups = computed(() => groupProjectResults(results.value, props.episodes, episodeId.value))
const typeLabels = { image: '图片', video: '视频', final: '成片' }
const statusLabel = status => ({ completed: '已完成', processing: '制作中', pending: '排队中', failed: '失败', sd2_waiting: '准备中' }[status] || status)
const url = item => `/static/${item.local_path.replace(/^\/+/, '')}`
watch(() => [props.dramaId, projectSession.revision], async ([id], _, onCleanup) => {
  let current = true
  onCleanup(() => { current = false })
  loading.value = true
  try { const rows = await request.get(`/dramas/${id}/collaboration/results`); if (current) results.value = rows }
  catch (error) { if (current) ElMessage.error(error.message) }
  finally { if (current) loading.value = false }
}, { immediate: true })
</script>
<style scoped>
.project-results{margin-top:20px}header{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}header .el-select{width:200px}h2{font-size:18px}.empty{padding:32px;color:var(--text-muted)}.results-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}.results-grid article{border:1px solid var(--border-subtle);border-radius:12px;overflow:hidden;background:var(--bg-surface)}img,video,.result-placeholder{width:100%;height:180px;object-fit:contain;background:#111}.result-placeholder{display:grid;place-items:center;color:#ccc}.result-copy{padding:12px;display:grid;gap:6px;overflow-wrap:anywhere}.result-copy span,.result-copy small{color:var(--text-muted)}
.result-group{margin-top:28px}.group-heading{padding-bottom:12px;border-bottom:1px solid var(--border-subtle);margin-bottom:16px}.group-heading h3{margin:0;font-size:16px;overflow-wrap:anywhere}.group-heading span{font-size:13px;color:var(--text-muted)}.results-grid{grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr))}.results-grid article{min-width:0}
</style>
