<template>
  <div class="media-library-page">
    <div v-if="canConcatSelected" class="concat-bar"><el-button @click="concatSelectedVideos">拼接选中的视频</el-button></div>
    <div class="page-header">
      <div class="header-left">
        <el-button text @click="$router.push('/')">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
        <h2 class="page-title">媒体素材库</h2>
      </div>
      <div class="header-actions">
        <el-button type="danger" plain :disabled="!total" @click="clearLibrary">一键清空素材库</el-button>
        <el-button type="primary" plain @click="triggerUpload">
          <el-icon><Upload /></el-icon>
          上传素材
        </el-button>
        <input ref="uploadInput" type="file" accept="image/*,video/*,audio/*" multiple style="display:none" @change="onUpload" />
      </div>
    </div>

    <div class="upload-limits">上传限制：图片 ≤30MB（JPG/PNG/GIF/WebP） · 视频 ≤50MB（MP4/WebM/MOV/M4V） · 音频 ≤15MB（MP3/WAV/M4A/OGG/WebM）</div>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <el-radio-group v-model="mediaType" class="type-filter" @change="resetAndLoad">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="image">图片</el-radio-button>
        <el-radio-button value="video">视频</el-radio-button>
        <el-radio-button value="audio">音频</el-radio-button>
      </el-radio-group>
      <el-input
        v-model="keyword"
        placeholder="搜索素材..."
        class="search-input"
        clearable
        @input="debouncedLoad"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-checkbox v-model="favoriteOnly" class="favorite-filter" @change="resetAndLoad">只看收藏</el-checkbox>
    </div>

    <!-- 上传进度 -->
    <div v-if="uploading" class="upload-progress">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>正在上传 {{ uploadProgress.current }}/{{ uploadProgress.total }}...</span>
    </div>

    <!-- 媒体网格 -->
    <div v-loading="loading" class="media-grid">
      <div
        v-for="item in mediaItems"
        :key="item.id"
        class="media-card"
        :class="{ selected: selectedIds.has(item.id) }"
        @click="toggleSelect(item)"
      >
        <div class="media-thumb">
          <img v-if="item.type === 'video' && item.thumbnail_local_path" :src="thumbnailUrl(item)" class="thumb-img" />
          <div v-else-if="item.type === 'video'" class="thumb-video thumb-video-placeholder"><el-icon><VideoCamera /></el-icon><span>视频素材</span></div>
          <div v-else-if="item.type === 'audio'" class="audio-thumb">🎵</div>
          <img v-else :src="itemUrl(item)" class="thumb-img" />
          <div class="media-overlay">
            <el-icon v-if="selectedIds.has(item.id)" class="check-icon"><CircleCheck /></el-icon>
            <div class="overlay-actions" @click.stop>
              <el-button
                size="small"
                plain
                class="preview-btn"
                @click.stop="openPreview(item)"
              >
                <el-icon><ZoomIn /></el-icon>
              </el-button>
              <el-button size="small" plain title="重命名素材" @click.stop="renameItem(item)"><el-icon><Edit /></el-icon></el-button>
              <el-button size="small" plain :type="item.is_favorite ? 'warning' : 'info'" :title="item.is_favorite ? '取消收藏' : '收藏素材'" @click.stop="toggleFavorite(item)"><el-icon><StarFilled v-if="item.is_favorite" /><Star v-else /></el-icon></el-button>
              <el-button
                size="small"
                type="danger"
                plain
                @click.stop="deleteItem(item)"
              >
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
          </div>
        </div>
        <div class="media-info">
          <span class="media-name" :title="item.name" @dblclick.stop="renameItem(item)">{{ item.name || '未命名' }}</span>
          <div class="media-meta-row"><span class="media-meta">{{ formatSize(item.size) }}</span><span v-if="item.type === 'image' && item.requires_sd2_identity" class="identity-state">含真人</span></div>
          <div v-if="item.tags?.length" class="media-tags"><el-tag v-for="tag in item.tags.slice(0, 3)" :key="tag" size="small" effect="plain">{{ tag }}</el-tag></div>
        </div>
      </div>

      <div v-if="!loading && mediaItems.length === 0" class="empty-media">
        <el-icon class="empty-icon"><Files /></el-icon>
        <div><b>素材库还是空的</b><p>上传图片、视频或音频后，可在自由创作和项目分镜中直接复用。</p></div>
        <div class="empty-media-actions"><el-button type="primary" @click="triggerUpload"><el-icon><Upload /></el-icon>上传首个素材</el-button><el-button @click="$router.push('/free-create')">先去自由创作</el-button></div>
      </div>
    </div>

    <!-- 分页 -->
    <div v-if="total > pageSize" class="pagination">
      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="prev, pager, next"
        @current-change="loadMedia"
      />
    </div>

    <!-- 批量操作 -->
    <div v-if="selectedIds.size > 0" class="batch-bar">
      <span>已选 {{ selectedIds.size }} 项</span>
      <el-button size="small" @click="selectCurrentPage">全选当前页图片</el-button>
      <el-button size="small" @click="selectedIds.clear()">取消选择</el-button>
      <el-button size="small" type="primary" plain @click="batchCertifyRealPeople">批量标记含真人并认证</el-button>
      <el-button size="small" type="danger" plain @click="batchDelete">批量删除</el-button>
      <el-button size="small" type="primary" @click="createWithSelected">用选中素材创作</el-button>
    </div>

    <!-- 预览弹窗 -->
    <el-dialog v-model="showPreview" title="素材预览" width="800px" destroy-on-close>
      <div class="preview-content">
        <video
          v-if="previewItem?.type === 'video'"
          :src="itemUrl(previewItem)"
          controls
          class="preview-video"
          autoplay
        />
        <div v-if="previewItem?.type === 'video'" class="trim-controls"><el-input-number v-model="trimStart" :min="0" :max="Math.max(0, trimEnd - .1)" :step=".1" size="small"/><span>至</span><el-input-number v-model="trimEnd" :min="trimStart + .1" :max="Number(previewItem.duration) || 3600" :step=".1" size="small"/><el-button size="small" :loading="trimming" @click="trimVideo">裁切为新素材</el-button></div>
        <audio v-else-if="previewItem?.type === 'audio'" :src="itemUrl(previewItem)" controls />
        <AudioWaveform v-if="previewItem?.type === 'audio'" :src="itemUrl(previewItem)" />
        <img v-else-if="previewItem" :src="itemUrl(previewItem)" class="preview-image" />
      </div>
      <div class="preview-meta">
        <div class="meta-row"><span>名称：</span>{{ previewItem?.name || '未命名' }}</div>
        <div class="meta-row"><span>大小：</span>{{ formatSize(previewItem?.size) }}</div>
        <div class="meta-row"><span>创建时间：</span>{{ previewItem?.created_at }}</div>
        <div class="meta-row tag-editor"><span>标签：</span><el-input v-model="editableTags" size="small" placeholder="用逗号分隔，例如：人物, 夜景" @change="saveTags" /></div>
        <div v-if="previewItem?.type === 'image'" class="sd2-preview-row"><el-checkbox :model-value="!!previewItem?.requires_sd2_identity" @change="setIdentity(previewItem, $event)">含真人</el-checkbox><span v-if="previewItem?.requires_sd2_identity">{{ sd2Label(previewItem) }}，系统自动准备，生成会自动等待。</span><span v-else>未勾选即为不含真人</span></div>
        <section v-if="previewItem" class="asset-lineage">
          <div class="asset-lineage-title"><span>版本与来源</span><el-button text size="small" :loading="lineageLoading" @click="loadLineage(previewItem.id)">刷新</el-button></div>
          <div v-if="lineageLoading" class="asset-lineage-empty">正在加载素材谱系…</div>
          <template v-else>
            <div v-if="lineage?.ancestors?.length" class="asset-lineage-list"><button v-for="item in lineage.ancestors" :key="`parent-${item.id}`" type="button" @click="openLineageItem(item)">上游 · {{ item.name || `#${item.id}` }}<small v-if="item.deleted_at"> 已删除</small></button></div>
            <div class="asset-lineage-current">当前 · {{ lineage?.current?.name || previewItem.name }}</div>
            <div v-if="lineage?.descendants?.length" class="asset-lineage-list"><button v-for="item in lineage.descendants" :key="`child-${item.id}`" type="button" @click="openLineageItem(item)">派生 · {{ item.name || `#${item.id}` }}<small v-if="item.deleted_at"> 已删除</small></button></div>
            <div v-if="!lineage?.ancestors?.length && !lineage?.descendants?.length" class="asset-lineage-empty">这是根素材，还没有裁切或关键帧等派生版本。</div>
          </template>
        </section>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, reactive, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowLeft, Upload, Search, Loading, CircleCheck,
  ZoomIn, Delete, Edit, Files, Star, StarFilled, VideoCamera
} from '@element-plus/icons-vue'
import { omniVideoAPI } from '@/api/omniVideo'
import { useRouter } from 'vue-router'
import request from '@/utils/request'
import AudioWaveform from '@/components/AudioWaveform.vue'

const loading = ref(false)
const uploading = ref(false)
const uploadProgress = ref({ current: 0, total: 0 })
const mediaItems = ref([])
const mediaType = ref('all')
const favoriteOnly = ref(false)
const keyword = ref('')
const page = ref(1)
const pageSize = ref(30)
const total = ref(0)
const selectedIds = reactive(new Set())
const selectedMedia = computed(() => mediaItems.value.filter((item) => selectedIds.has(item.id)))
const canConcatSelected = computed(() => selectedMedia.value.length >= 2 && selectedMedia.value.every((item) => item.type === 'video'))
const showPreview = ref(false)
const previewItem = ref(null)
const editableTags = ref('')
const trimStart = ref(0), trimEnd = ref(5), trimming = ref(false)
const lineage = ref(null), lineageLoading = ref(false)
const uploadInput = ref(null)
const router = useRouter()
let keywordTimer = null

function triggerUpload() {
  uploadInput.value?.click()
}

async function onUpload(e) {
  const files = Array.from(e.target.files || [])
  if (!files.length) return
  uploading.value = true
  uploadProgress.value = { current: 0, total: files.length }
  for (const file of files) {
    try {
      const item = await omniVideoAPI.upload(file)
      uploadProgress.value.current++
      if (item?.deduplicated) ElMessage.info(`${file.name} 已存在，已复用素材记录`)
    } catch (err) {
      ElMessage.warning(`${file.name} 上传失败: ${err.message}`)
    }
  }
  uploading.value = false
  e.target.value = ''
  ElMessage.success(`${files.length} 个素材上传完成`)
  loadMedia()
}

function debouncedLoad() {
  clearTimeout(keywordTimer)
  keywordTimer = setTimeout(resetAndLoad, 400)
}

function resetAndLoad() {
  page.value = 1
  selectedIds.clear()
  return loadMedia()
}

async function loadMedia() {
  loading.value = true
  try {
    const params = {
      page: page.value,
      page_size: pageSize.value,
      scope: 'global',
    }
    if (mediaType.value !== 'all') params.type = mediaType.value
    if (keyword.value) params.keyword = keyword.value
    if (favoriteOnly.value) params.favorite = 1
    const res = await request.get('/assets', { params })
    mediaItems.value = (res?.items || []).filter((item) => item && Number.isFinite(Number(item.id))).map(normalizeItem)
    total.value = Number(res?.pagination?.total ?? res?.total ?? 0)
  } catch (err) {
    mediaItems.value = []
  } finally {
    loading.value = false
  }
}

function normalizeItem(item) {
  const url = item.url || item.image_url || item.video_url || ''
  const isVideo = url.match(/\.(mp4|webm|mov)$/i) || item.type === 'video'
  const isAudio = item.type === 'audio'
  return {
    ...item,
    type: isAudio ? 'audio' : isVideo ? 'video' : 'image',
    name: item.name || item.filename || (url.split('/').pop()),
  }
}

function itemUrl(item) {
  if (!item) return ''
  const lp = item.local_path || item.image_local_path || item.video_local_path
  if (lp) return '/static/' + lp.replace(/^\//, '')
  return item.url || item.image_url || item.video_url || ''
}

function formatSize(size) {
  if (!size) return ''
  if (size > 1024 * 1024) return (size / 1024 / 1024).toFixed(1) + ' MB'
  if (size > 1024) return (size / 1024).toFixed(0) + ' KB'
  return size + ' B'
}

function toggleSelect(item) {
  if (selectedIds.has(item.id)) {
    selectedIds.delete(item.id)
  } else {
    selectedIds.add(item.id)
  }
}
function thumbnailUrl(item) {
  return item?.thumbnail_local_path ? '/static/' + item.thumbnail_local_path.replace(/^\//, '') : itemUrl(item)
}

function createWithSelected() {
  const ids = Array.from(selectedIds)
  router.push({ path: '/free-create', query: ids.length ? { assets: ids.join(',') } : {} })
}

async function openPreview(item) {
  previewItem.value = item
  editableTags.value = Array.isArray(item.tags) ? item.tags.join(', ') : ''
  trimStart.value = 0; trimEnd.value = Number(item.duration) || 5
  showPreview.value = true
  await loadLineage(item.id)
}

async function loadLineage(id) {
  if (!id) return
  lineageLoading.value = true
  try { lineage.value = await omniVideoAPI.assetLineage(id) } catch (_) { lineage.value = null } finally { lineageLoading.value = false }
}

function openLineageItem(item) {
  if (!item || item.deleted_at) return
  const visible = mediaItems.value.find((entry) => entry.id === item.id)
  if (visible) return openPreview(visible)
  previewItem.value = normalizeItem(item)
  editableTags.value = Array.isArray(item.tags) ? item.tags.join(', ') : ''
  trimStart.value = 0; trimEnd.value = Number(item.duration) || 5
  loadLineage(item.id)
}

async function trimVideo() {
  if (!previewItem.value || trimming.value) return
  trimming.value = true
  try {
    const item = await omniVideoAPI.trimAsset(previewItem.value.id, { start_seconds: trimStart.value, end_seconds: trimEnd.value })
    mediaItems.value.unshift(normalizeItem(item)); total.value++
    ElMessage.success('已裁切为新的派生素材，原视频未修改')
  } catch (error) { ElMessage.error(error.message || '裁切视频失败') } finally { trimming.value = false }
}

async function concatSelectedVideos() {
  if (!canConcatSelected.value) return
  try {
    await ElMessageBox.confirm(`将按当前素材排序拼接 ${selectedMedia.value.length} 段视频，并保留原素材。`, '拼接视频', { type: 'info' })
    const item = await omniVideoAPI.concatAssets(selectedMedia.value.map((entry) => entry.id))
    mediaItems.value.unshift(normalizeItem(item)); total.value++
    selectedIds.clear()
    ElMessage.success('已拼接为新的派生视频素材')
  } catch (error) {
    if (error !== 'cancel' && error?.message !== 'cancel') ElMessage.error(error.message || '拼接视频失败')
  }
}

async function saveTags() {
  if (!previewItem.value) return
  const tags = [...new Set(editableTags.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 12)
  try {
    const updated = await omniVideoAPI.updateAsset(previewItem.value.id, { tags })
    Object.assign(previewItem.value, updated)
    const index = mediaItems.value.findIndex((item) => item.id === updated.id)
    if (index >= 0) Object.assign(mediaItems.value[index], updated)
    editableTags.value = tags.join(', ')
    ElMessage.success('素材标签已更新')
  } catch (error) {
    ElMessage.error(error.message || '素材标签更新失败')
  }
}

async function toggleFavorite(item) {
  try {
    const updated = await omniVideoAPI.updateAsset(item.id, { is_favorite: !item.is_favorite })
    Object.assign(item, updated)
    ElMessage.success(item.is_favorite ? '已收藏素材' : '已取消收藏')
  } catch (error) {
    ElMessage.error(error.message || '收藏状态更新失败')
  }
}

async function deleteItem(item) {
  await ElMessageBox.confirm('确定删除该素材？', '删除确认', { type: 'warning' })
  try {
    await request.delete(`/assets/${item.id}`)
    ElMessage.success('已删除')
    loadMedia()
  } catch (err) {
    ElMessage.error(err.message || '删除失败')
  }
}

async function renameItem(item) {
  try {
    const { value } = await ElMessageBox.prompt('输入素材名称', '重命名素材', { inputValue: item.name || '' })
    const updated = await omniVideoAPI.updateAsset(item.id, { name: String(value || '').trim() || item.name })
    Object.assign(item, updated)
    ElMessage.success('素材名称已更新')
  } catch (_) {}
}

function sd2Status(item) { return String(item?.seedance2_asset?.status || 'none').toLowerCase() }
function sd2Label(item) { return ({ active: '认证可用', processing: '认证中', stale: '需刷新', failed: '认证失败', none: '未认证' })[sd2Status(item)] || '未认证' }
async function setIdentity(item, value) {
  const previous = !!item.requires_sd2_identity
  item.requires_sd2_identity = !!value
  try {
    const updated = await omniVideoAPI.updateAsset(item.id, { requires_sd2_identity: !!value })
    Object.assign(item, updated)
    if (value && sd2Status(item) !== 'active') {
      const out = await omniVideoAPI.certifyAsset(item.id)
      if (out?.seedance2_asset) item.seedance2_asset = out.seedance2_asset
    }
  } catch (error) {
    item.requires_sd2_identity = previous
    ElMessage.error(error.message || '真人声明保存或自动认证失败')
  }
}

async function batchDelete() {
  const count = selectedIds.size
  await ElMessageBox.confirm(`确定删除选中的 ${count} 个素材？`, '批量删除', { type: 'warning' })
  try {
    const result = await request.post('/assets/batch-delete', { ids: [...selectedIds] })
    selectedIds.clear()
    ElMessage.success(result?.message || `${count} 个素材已删除`)
    loadMedia()
  } catch (error) { ElMessage.error(error.message || '批量删除失败') }
}

function selectCurrentPage() {
  mediaItems.value.filter((item) => item.type === 'image').forEach((item) => selectedIds.add(item.id))
}

async function batchCertifyRealPeople() {
  const ids = mediaItems.value.filter((item) => selectedIds.has(item.id) && item.type === 'image').map((item) => item.id)
  if (!ids.length) return ElMessage.warning('请选择至少一张图片素材')
  try {
    await ElMessageBox.confirm(`将 ${ids.length} 张图片标记为含真人，并在后台按受控并发自动认证。生成会等待认证完成后自动续跑。`, '批量真人认证', { type: 'info' })
    const result = await omniVideoAPI.certifyAssetsBatch(ids)
    ElMessage.success(result?.message || `已排队 ${ids.length} 张素材认证`)
    await loadMedia()
  } catch (error) {
    if (error !== 'cancel' && error?.message !== 'cancel') ElMessage.error(error.message || '批量认证提交失败')
  }
}

async function clearLibrary() {
  try {
    await ElMessageBox.confirm(
      '将清空你有权限访问的全部媒体素材。该操作会从素材库隐藏记录，但不会立即物理删除本地或 OSS 文件，以保证已有作品可追溯。',
      '一键清空素材库',
      { type: 'warning', confirmButtonText: '确认清空', cancelButtonText: '取消' }
    )
    const result = await request.post('/assets/batch-delete', { all_matching: true })
    selectedIds.clear()
    showPreview.value = false
    ElMessage.success(result?.message || '素材库已清空')
    await resetAndLoad()
  } catch (error) {
    if (error !== 'cancel' && error?.message !== 'cancel') ElMessage.error(error.message || '清空素材库失败')
  }
}

onMounted(loadMedia)
</script>

<style scoped>
.media-library-page {
  min-height: 100vh;
  background: var(--bg-page);
  padding: 20px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.page-title {
  font-size: 22px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.upload-limits { margin: -8px 0 14px; color: var(--text-muted); font-size: 12px; }
.concat-bar { position:fixed; right:24px; bottom:24px; z-index:20; }

.search-input {
  width: 240px;
}

.upload-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--accent);
  font-size: 14px;
}

.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  min-height: 200px;
}

.media-card {
  background: var(--bg-surface);
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid var(--border-subtle);
  cursor: pointer;
  transition: all .2s;
  box-shadow: var(--shadow-sm);
}

.media-card:hover {
  box-shadow: var(--shadow-md);
}

.media-card.selected {
  border-color: var(--accent);
}

.media-thumb {
  aspect-ratio: 1;
  background: var(--bg-raised);
  overflow: hidden;
  position: relative;
}

.thumb-img,
.thumb-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.thumb-video-placeholder { display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--text-muted);font-size:13px;background:var(--bg-inner) }
.thumb-video-placeholder .el-icon { font-size:30px }
.audio-thumb { width: 100%; height: 100%; display: grid; place-items: center; font-size: 36px; background: var(--bg-hover); }

.media-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,.35);
  opacity: 0;
  transition: opacity .2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.media-card:hover .media-overlay {
  opacity: 1;
}

.media-card.selected .media-overlay {
  opacity: 1;
}

.check-icon {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 20px;
  color: var(--accent);
  background: var(--bg-surface);
  border-radius: 50%;
}

.overlay-actions {
  display: flex;
  gap: 6px;
}

.media-info {
  padding: 8px;
}

.media-name {
  display: block;
  font-size: 12px;
  color: var(--text-regular);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.media-meta {
  font-size: 11px;
  color: var(--text-faint);
}

.media-meta-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 4px; }
.identity-state { padding: 2px 5px; border-radius: 4px; font-size: 10px; white-space: nowrap; background: var(--bg-hover); color: var(--text-muted); }
.identity-state.active { background: var(--bg-active); color: var(--text-primary); }
.identity-state.processing { background: var(--bg-raised); color: var(--text-regular); }
.identity-state.stale,.identity-state.failed { background: var(--bg-elevated); color: var(--text-muted); }
.trim-controls { display:flex; align-items:center; gap:8px; margin-top:12px; flex-wrap:wrap; }
.sd2-preview-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-subtle); }

.empty-media {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  padding: 28px;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  color: var(--text-muted);
  gap: 14px;
  text-align: center;
}
.empty-media b { color: var(--text-primary); font-size: 15px; }
.empty-media p { margin: 7px 0 0; font-size: 13px; line-height: 1.6; }
.empty-media-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }

.empty-icon {
  font-size: 48px;
}

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}

.batch-bar {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-elevated);
  color: var(--text-primary);
  padding: 10px 20px;
  border-radius: 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  box-shadow: 0 4px 16px rgba(0,0,0,.2);
}

.preview-content {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
}

.preview-image {
  max-width: 100%;
  max-height: 60vh;
  object-fit: contain;
}

.preview-video {
  max-width: 100%;
  max-height: 60vh;
}

.preview-meta {
  margin-top: 16px;
}

.meta-row {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.meta-row span {
  font-weight: 500;
  color: var(--text-regular);
}
.asset-lineage { margin-top:14px; padding-top:12px; border-top:1px solid var(--border-subtle); }
.asset-lineage-title { display:flex; align-items:center; justify-content:space-between; font-size:13px; font-weight:600; color:var(--text-regular); }
.asset-lineage-list { display:flex; flex-wrap:wrap; gap:6px; margin-top:7px; }
.asset-lineage-list button,.asset-lineage-current { border:1px solid var(--border-color); border-radius:5px; padding:4px 7px; background:var(--bg-raised); color:var(--text-regular); font-size:12px; }
.asset-lineage-list button { cursor:pointer; }.asset-lineage-list button:hover { border-color:var(--accent); color:var(--text-primary); }
.asset-lineage-list small { color:var(--text-faint); }.asset-lineage-current { margin-top:7px; border-color:var(--border-strong); background:var(--bg-hover); color:var(--text-primary); }.asset-lineage-empty { margin-top:7px; color:var(--text-faint); font-size:12px; }
</style>
