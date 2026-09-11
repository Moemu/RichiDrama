<template>
  <div class="project-media-resources">
    <div class="project-media-toolbar">
      <el-radio-group v-model="mediaType" aria-label="项目素材类型" @change="resetAndLoad">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="image">图片</el-radio-button>
        <el-radio-button value="video">视频</el-radio-button>
        <el-radio-button value="audio">音频</el-radio-button>
      </el-radio-group>
      <el-input v-model="keyword" clearable placeholder="搜索项目素材" aria-label="搜索项目素材" @input="scheduleSearch" />
      <el-button @click="loadMedia">刷新</el-button>
      <el-button type="primary" plain @click="openLibrary">管理 / 上传素材</el-button>
    </div>
    <p class="project-media-note">当前项目的图片、视频和音频。上传或生成的素材可在此预览。</p>
    <div v-if="error" class="project-media-error" role="alert">
      <span>{{ error }}</span><el-button size="small" @click="loadMedia">重试</el-button>
    </div>
    <div v-loading="loading" class="project-media-grid">
      <button v-for="item in items" :key="item.id" type="button" class="project-media-card" :aria-label="`预览${typeLabel(item.type)}：${item.name || '未命名素材'}`" @click="previewItem = item">
        <img v-if="item.type === 'image'" :src="mediaUrl(item)" :alt="item.name || '图片素材'" loading="lazy" />
        <img v-else-if="item.type === 'video' && item.thumbnail_local_path" :src="staticUrl(item.thumbnail_local_path)" :alt="item.name || '视频素材'" loading="lazy" />
        <span v-else class="project-media-placeholder">{{ typeLabel(item.type) }}</span>
        <span class="project-media-name">{{ item.name || '未命名素材' }}</span>
        <small>项目素材 · {{ typeLabel(item.type) }}</small>
        <small v-if="item.project_source">由 {{ item.project_source.added_by_name || '成员' }} 加入的独立副本</small>
        <small v-for="(usage, index) in item.usages" :key="index">{{ usage.episode_title || '制作资源' }} · {{ usage.storyboard_id ? `分镜 ${usage.storyboard_id}` : `${usage.resource_type} ${usage.resource_id}` }}</small>
      </button>
      <p v-if="!loading && !error && !items.length" class="project-media-empty">{{ keyword || mediaType !== 'all' ? '没有匹配的项目素材，请调整筛选条件。' : '本项目暂无媒体素材，可上传图片、视频或音频。' }}</p>
    </div>
    <div class="project-media-pagination">
      <el-pagination v-model:current-page="page" :page-size="pageSize" :total="total" layout="total, prev, pager, next" :pager-count="5" @current-change="loadMedia" />
    </div>
    <el-dialog :model-value="!!previewItem" :title="previewItem?.name || '素材预览'" width="min(900px, 94vw)" append-to-body destroy-on-close @update:model-value="value => { if (!value) previewItem = null }">
      <div v-if="previewItem" class="project-media-preview">
        <video v-if="previewItem.type === 'video'" :src="mediaUrl(previewItem)" controls preload="metadata" />
        <audio v-else-if="previewItem.type === 'audio'" :src="mediaUrl(previewItem)" controls preload="metadata" />
        <img v-else :src="mediaUrl(previewItem)" :alt="previewItem.name || '图片素材'" />
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import request from '@/utils/request'
import { projectSession } from '@/composables/useProjectCollaboration'

const props = defineProps({ dramaId: { type: Number, required: true } })
const router = useRouter()
const items = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 24
const mediaType = ref('all')
const keyword = ref('')
const loading = ref(false)
const error = ref('')
const previewItem = ref(null)
let searchTimer
let requestVersion = 0

function staticUrl(path) { return `/static/${String(path).replace(/^\/+/, '')}` }
function mediaUrl(item) { return item.local_path ? staticUrl(item.local_path) : item.url || '' }
function typeLabel(type) { return ({ image: '图片', video: '视频', audio: '音频' })[type] || '素材' }

async function loadMedia() {
  clearTimeout(searchTimer)
  const version = ++requestVersion
  loading.value = true
  error.value = ''
  try {
    const result = await request.get('/assets', { params: {
      scope: 'project', drama_id: props.dramaId, page: page.value, page_size: pageSize,
      type: mediaType.value === 'all' ? undefined : mediaType.value,
      keyword: keyword.value.trim() || undefined,
    } })
    if (version !== requestVersion) return
    items.value = result.items || []
    total.value = Number(result.pagination?.total || 0)
    const lastPage = Math.max(1, Math.ceil(total.value / pageSize))
    if (page.value > lastPage) {
      page.value = lastPage
      return loadMedia()
    }
  } catch (err) {
    if (version === requestVersion) error.value = err.message || '项目素材加载失败，请重试'
  } finally {
    if (version === requestVersion) loading.value = false
  }
}
function resetAndLoad() { page.value = 1; return loadMedia() }
function scheduleSearch() {
  clearTimeout(searchTimer)
  ++requestVersion
  searchTimer = setTimeout(resetAndLoad, 300)
}
function openLibrary() {
  router.push({ path: '/media-library', query: {
    drama_id: props.dramaId,
    return_to: `/drama/${props.dramaId}?tab=resources&resource=media`,
  } })
}
watch(() => props.dramaId, () => { items.value = []; previewItem.value = null; resetAndLoad() }, { immediate: true })
watch(() => projectSession.revision, () => { if (Number(projectSession.id) === Number(props.dramaId)) loadMedia() })
onBeforeUnmount(() => { clearTimeout(searchTimer); ++requestVersion })
</script>

<style scoped>
.project-media-resources{min-width:0;padding:20px 0}
.project-media-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:10px}
.project-media-toolbar .el-input{flex:1;min-width:180px;max-width:320px}
.project-media-toolbar :deep(.el-button + .el-button){margin-left:0}
.project-media-note,.project-media-card small{font-size:12px;color:var(--text-muted)}
.project-media-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;min-height:100px}
.project-media-card{display:flex;flex-direction:column;gap:7px;min-width:0;padding:10px;border:1px solid var(--border-subtle);border-radius:10px;background:var(--bg-raised);color:var(--text-primary);font:inherit;text-align:left;cursor:pointer}
.project-media-card:hover,.project-media-card:focus-visible{border-color:var(--accent)}
.project-media-card img,.project-media-placeholder{width:100%;height:140px;object-fit:contain;border-radius:6px;background:var(--bg-page)}
.project-media-placeholder{display:grid;place-items:center;color:var(--text-muted)}
.project-media-name{overflow-wrap:anywhere;font-size:14px;line-height:1.5}
.project-media-empty{grid-column:1/-1;text-align:center;padding:32px 0;color:var(--text-muted)}
.project-media-error{display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:12px 0;color:var(--el-color-danger)}
.project-media-pagination{display:flex;justify-content:center;max-width:100%;padding-top:24px}
.project-media-pagination :deep(.el-pagination){flex-wrap:wrap;justify-content:center;gap:4px}
.project-media-preview{display:flex;justify-content:center;min-width:0}
.project-media-preview img,.project-media-preview video{max-width:100%;max-height:65vh;object-fit:contain}
.project-media-preview audio{width:100%;max-width:600px}
@media(max-width:600px){.project-media-toolbar .el-input{flex-basis:100%;max-width:none}.project-media-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.project-media-card img,.project-media-placeholder{height:100px}}
</style>
