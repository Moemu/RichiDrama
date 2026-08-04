<template>
  <div class="media-library-page">
    <div class="page-header">
      <div class="header-left">
        <el-button text @click="$router.push('/')">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
        <h2 class="page-title">媒体素材库</h2>
      </div>
      <div class="header-actions">
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
      <el-radio-group v-model="mediaType" class="type-filter" @change="loadMedia">
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
      <el-checkbox v-model="favoriteOnly" class="favorite-filter" @change="loadMedia">只看收藏</el-checkbox>
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
          <video v-else-if="item.type === 'video'" :src="itemUrl(item)" class="thumb-video" muted />
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
          <div class="media-meta-row"><span class="media-meta">{{ formatSize(item.size) }}</span><span v-if="item.type === 'image' && item.requires_sd2_identity" class="identity-state" :class="sd2Status(item)">真人 · {{ sd2Label(item) }}</span></div>
          <div v-if="item.tags?.length" class="media-tags"><el-tag v-for="tag in item.tags.slice(0, 3)" :key="tag" size="small" effect="plain">{{ tag }}</el-tag></div>
        </div>
      </div>

      <div v-if="!loading && mediaItems.length === 0" class="empty-media">
        <el-icon class="empty-icon"><Files /></el-icon>
        <p>暂无素材，点击上传按钮添加</p>
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
      <el-button size="small" @click="selectedIds.clear()">取消选择</el-button>
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
        <audio v-else-if="previewItem?.type === 'audio'" :src="itemUrl(previewItem)" controls />
        <img v-else-if="previewItem" :src="itemUrl(previewItem)" class="preview-image" />
      </div>
      <div class="preview-meta">
        <div class="meta-row"><span>名称：</span>{{ previewItem?.name || '未命名' }}</div>
        <div class="meta-row"><span>大小：</span>{{ formatSize(previewItem?.size) }}</div>
        <div class="meta-row"><span>创建时间：</span>{{ previewItem?.created_at }}</div>
        <div class="meta-row tag-editor"><span>标签：</span><el-input v-model="editableTags" size="small" placeholder="用逗号分隔，例如：人物, 夜景" @change="saveTags" /></div>
        <div v-if="previewItem?.type === 'image'" class="sd2-preview-row"><el-checkbox :model-value="!!previewItem?.requires_sd2_identity" @change="setIdentity(previewItem, $event)">含真人／需要身份一致性</el-checkbox><el-button v-if="previewItem?.requires_sd2_identity" text size="small" :loading="certifyingId === previewItem?.id" @click="certify(previewItem)">{{ sd2Status(previewItem) === 'active' ? '认证可用' : '认证 / 刷新' }}</el-button></div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowLeft, Upload, Search, Loading, CircleCheck,
  ZoomIn, Delete, Files, Star, StarFilled
} from '@element-plus/icons-vue'
import { omniVideoAPI } from '@/api/omniVideo'
import { useRouter } from 'vue-router'
import request from '@/utils/request'

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
const showPreview = ref(false)
const previewItem = ref(null)
const certifyingId = ref(null)
const editableTags = ref('')
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
      await omniVideoAPI.upload(file)
      uploadProgress.value.current++
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
  keywordTimer = setTimeout(loadMedia, 400)
}

async function loadMedia() {
  loading.value = true
  try {
    const params = {
      page: page.value,
      page_size: pageSize.value,
    }
    if (mediaType.value !== 'all') params.type = mediaType.value
    if (keyword.value) params.keyword = keyword.value
    if (favoriteOnly.value) params.favorite = 1
    const res = await request.get('/assets', { params })
    mediaItems.value = (res?.items || []).map(normalizeItem)
    total.value = res?.total || 0
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

function openPreview(item) {
  previewItem.value = item
  editableTags.value = Array.isArray(item.tags) ? item.tags.join(', ') : ''
  showPreview.value = true
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
  try { const updated = await omniVideoAPI.updateAsset(item.id, { requires_sd2_identity: !!value }); Object.assign(item, updated); if (value) await certify(item) } catch (error) { ElMessage.error(error.message || '真人声明保存失败') }
}
async function certify(item) {
  if (!item || certifyingId.value === item.id || sd2Status(item) === 'active') return
  certifyingId.value = item.id
  try { const out = sd2Status(item) === 'processing' ? await omniVideoAPI.refreshAssetCertification(item.id) : await omniVideoAPI.certifyAsset(item.id); item.seedance2_asset = out.seedance2_asset; ElMessage.success('SD2 认证状态已更新') } catch (error) { ElMessage.error(error.message || 'SD2 认证失败') } finally { certifyingId.value = null }
}

async function batchDelete() {
  const count = selectedIds.size
  await ElMessageBox.confirm(`确定删除选中的 ${count} 个素材？`, '批量删除', { type: 'warning' })
  let failed = 0
  for (const id of selectedIds) {
    try {
      await request.delete(`/assets/${id}`)
    } catch (_) { failed++ }
  }
  selectedIds.clear()
  if (failed > 0) ElMessage.warning(`${count - failed} 个删除成功，${failed} 个失败`)
  else ElMessage.success(`${count} 个素材已删除`)
  loadMedia()
}

onMounted(loadMedia)
</script>

<style scoped>
.media-library-page {
  min-height: 100vh;
  background: #f5f7fa;
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
  color: #1a1a2e;
  margin: 0;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.upload-limits { margin: -8px 0 14px; color: #6b7280; font-size: 12px; }

.search-input {
  width: 240px;
}

.upload-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  color: #409eff;
  font-size: 14px;
}

.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  min-height: 200px;
}

.media-card {
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all .2s;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
}

.media-card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,.1);
}

.media-card.selected {
  border-color: #409eff;
}

.media-thumb {
  aspect-ratio: 1;
  background: #f3f4f6;
  overflow: hidden;
  position: relative;
}

.thumb-img,
.thumb-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.audio-thumb { width: 100%; height: 100%; display: grid; place-items: center; font-size: 36px; background: #edf2ff; }

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
  color: #409eff;
  background: #fff;
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
  color: #374151;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.media-meta {
  font-size: 11px;
  color: #9ca3af;
}

.media-meta-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 4px; }
.identity-state { padding: 2px 5px; border-radius: 4px; font-size: 10px; white-space: nowrap; background: #eef2f5; color: #667085; }
.identity-state.active { background: #e6f4eb; color: #28734b; }
.identity-state.processing { background: #fff5dc; color: #966916; }
.identity-state.stale,.identity-state.failed { background: #fce9e9; color: #ad4949; }
.sd2-preview-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb; }

.empty-media {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: #9ca3af;
  gap: 12px;
}

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
  background: #1a1a2e;
  color: #fff;
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
  color: #6b7280;
  margin-bottom: 4px;
}

.meta-row span {
  font-weight: 500;
  color: #374151;
}
.media-library-page{background:#f5f5f5!important;color:#262626!important}.page-header,.filter-bar,.media-card,.upload-limits,.batch-bar{background:#fff!important;border-color:#e5e5e5!important;box-shadow:none!important}.media-card:hover,.media-card.selected{background:#fafafa!important;border-color:#171717!important;box-shadow:inset 2px 0 0 #171717!important}.media-library-page :deep(.el-button--primary){--el-button-bg-color:#171717!important;--el-button-border-color:#171717!important;--el-button-text-color:#fff!important;--el-button-hover-bg-color:#404040!important;--el-button-hover-border-color:#404040!important}.type-filter :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner){background:#171717!important;border-color:#171717!important;color:#fff!important;box-shadow:none!important}
</style>
