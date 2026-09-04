<template>
  <el-dialog :model-value="modelValue" :title="title" width="760px" append-to-body @update:model-value="$emit('update:modelValue', $event)">
    <div class="project-asset-library-toolbar">
      <el-input :model-value="keyword" clearable placeholder="搜索图片、视频或音频素材" aria-label="搜索素材" @update:model-value="$emit('update:keyword', $event)" />
      <slot name="toolbar" />
      <input ref="dialogFileInput" hidden type="file" multiple accept="image/*,video/*,audio/*" @change="onFiles" />
      <el-button v-if="uploadable" type="primary" plain @click="dialogFileInput?.click()"><el-icon><Upload /></el-icon>从本地上传</el-button>
    </div>
    <p v-if="joinable" class="project-asset-library-note">点击素材加入或移出本镜；可拖到提示词中引用。</p>
    <div class="project-asset-library-grid">
      <component :is="joinable ? 'button' : 'article'" v-for="asset in assets" :key="asset.id" :type="joinable ? 'button' : undefined" class="project-asset-library-card" :class="{ added: addedIds.has(asset.id), selected: referencedIds.has(asset.id) }" :aria-pressed="joinable ? referencedIds.has(asset.id) : undefined" @click="joinable && $emit('toggle', asset)">
        <img v-if="asset.type === 'image'" :src="assetUrl(asset)" :alt="asset.name || '图片素材'" />
        <img v-else-if="asset.type === 'video' && thumbnailOf(asset)" :src="thumbnailOf(asset)" :alt="asset.name || '视频素材'" />
        <span v-else>{{ asset.type === 'audio' ? '音频' : '视频' }}</span>
        <b>{{ asset.name || `素材 ${asset.id}` }}</b><small>{{ asset.drama_id ? '当前项目素材' : '我的全局素材' }}</small>
        <em v-if="joinable">{{ referencedIds.has(asset.id) ? '已引用' : addedIds.has(asset.id) ? '✓ 已加入本镜' : '点击加入' }}</em>
      </component>
      <p v-if="!assets.length" class="project-asset-library-empty">{{ emptyText }}</p>
    </div>
    <template v-if="showFullLink" #footer><el-button text size="small" @click="$emit('open-full')">打开完整素材库管理 →</el-button></template>
  </el-dialog>
</template>

<script setup>
import { ref } from 'vue'
import { Upload } from '@element-plus/icons-vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '素材库' },
  /** 已按关键词/范围过滤好的素材列表 */
  assets: { type: Array, default: () => [] },
  keyword: { type: String, default: '' },
  /** 已加入本镜的素材 id（引用态） */
  addedIds: { type: Set, default: () => new Set() },
  /** 已在提示词中引用的素材 id */
  referencedIds: { type: Set, default: () => new Set() },
  /** true=选择模式（点击加入/移出本镜）；false=浏览模式（仅查看与上传） */
  joinable: { type: Boolean, default: true },
  uploadable: { type: Boolean, default: true },
  showFullLink: { type: Boolean, default: true },
  emptyText: { type: String, default: '没有匹配的素材。可调整范围或搜索词，也可先上传新素材。' },
})
const emit = defineEmits(['update:modelValue', 'update:keyword', 'toggle', 'upload', 'open-full'])
const dialogFileInput = ref(null)
function onFiles(event) { emit('upload', event.target.files); event.target.value = '' }
function assetUrl(asset) { return asset?.local_path ? `/static/${String(asset.local_path).replace(/^\/+/, '')}` : asset?.url || '' }
function thumbnailOf(asset) {
  const path = String(asset?.thumbnail_local_path || '').trim()
  if (!path) return ''
  return /^https?:\/\//i.test(path) || path.startsWith('data:') ? path : `/static/${path.replace(/^\/+/, '')}`
}
</script>

<style scoped>
.project-asset-library-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.project-asset-library-toolbar .el-input{flex:1;min-width:180px}
.project-asset-library-toolbar .asset-scope{width:160px}
.project-asset-library-note{margin:10px 0;color:var(--el-text-color-secondary);font-size:13px;line-height:1.5}
.project-asset-library-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px;max-height:min(54vh,500px);overflow:auto;padding:2px}
.project-asset-library-card{position:relative;display:grid;gap:4px;min-width:0;padding:6px;overflow:hidden;border:1px solid var(--el-border-color);border-radius:8px;background:var(--el-fill-color-blank);color:var(--el-text-color-primary);text-align:left;cursor:pointer;font:inherit}
.project-asset-library-card:hover{border-color:var(--studio-teal,#0e9d74)}
.project-asset-library-card.added{border-color:color-mix(in srgb,var(--studio-teal,#0e9d74) 65%,var(--el-border-color));background:color-mix(in srgb,var(--studio-teal,#0e9d74) 7%,var(--el-fill-color-blank))}
.project-asset-library-card.added em{background:color-mix(in srgb,var(--studio-teal,#0e9d74) 76%,#111);font-weight:700}
.project-asset-library-card.selected{border:2px solid #fff;box-shadow:0 0 0 2px rgb(84 234 212 / 52%)}
.project-asset-library-card.selected em{background:#fff;color:#151515;font-weight:700}
.project-asset-library-card img,.project-asset-library-card>span{display:grid;width:100%;height:82px;place-items:center;object-fit:cover;border-radius:5px;background:var(--el-fill-color-light);color:var(--el-text-color-secondary)}
.project-asset-library-card b,.project-asset-library-card small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.project-asset-library-card b{font-size:12px}
.project-asset-library-card small{font-size:11px;color:var(--el-text-color-secondary)}
.project-asset-library-card em{position:absolute;right:6px;top:6px;padding:2px 5px;border-radius:4px;background:#111c;color:#fff;font-size:10px;font-style:normal}
.project-asset-library-empty{grid-column:1 / -1;margin:0;padding:24px 0;text-align:center;color:var(--el-text-color-secondary);font-size:13px}
@media(max-width:600px){.project-asset-library-toolbar .el-input{flex-basis:100%}.project-asset-library-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
