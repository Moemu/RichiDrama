<template>
  <div class="board-upload">
    <input ref="uploadInput" type="file" accept="image/*,video/*,audio/*" multiple style="display:none" @change="onPick" />
    <div v-if="uploading" class="upload-progress">
      <span>正在上传 {{ progress.current }}/{{ progress.total }}...</span>
      <el-progress :percentage="percent" :stroke-width="8" :show-text="false" />
    </div>
    <div v-if="failed.length" class="upload-progress"><span>失败 {{ failed.length }} 个</span><el-button size="small" @click="retryFailed">重新上传失败项</el-button></div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { omniVideoAPI } from '@/api/omniVideo'
import { dropPosition, uploadedAsset } from '@/utils/creativeBoardWorkflow'

const emit = defineEmits(['uploaded'])
const uploadInput = ref(null)
const uploading = ref(false)
const progress = ref({ current: 0, total: 0 })
const failed = ref([])
let pendingPosition = null
const percent = computed(() => progress.value.total ? Math.round((progress.value.current / progress.value.total) * 100) : 0)

function pick(position = null) { pendingPosition = position; uploadInput.value?.click() }
function onPick(event) { const files = Array.from(event.target.files || []); event.target.value = ''; handleFiles(files, pendingPosition) }

async function handleFiles(files, position = null, positions = null) {
  if (!files.length) return
  uploading.value = true
  progress.value = { current: 0, total: files.length }
  failed.value = []
  const limits = await omniVideoAPI.uploadLimits().catch(() => null)
  for (const [index, file] of files.entries()) {
    // A retry hands back the position each file failed at; a fresh drop cascades instead.
    const at = positions?.[index] ?? dropPosition(position, index)
    try {
      const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : null
      const maxMb = type ? Number(limits?.files?.[type]?.max_mb) : 0
      if (!type) throw new Error('仅支持图片、视频或音频文件')
      if (maxMb > 0 && file.size > maxMb * 1024 * 1024) throw new Error(`文件超过 ${maxMb}MB 限制`)
      const item = uploadedAsset(await omniVideoAPI.upload(file, { name: file.name }))
      progress.value.current++
      if (item.deduplicated) ElMessage.info(`${file.name} 已存在，已复用素材记录`)
      emit('uploaded', { id: item.id, source_type: 'asset', type: item.type || type, name: item.name || file.name, local_path: item.local_path || null, url: item.local_path ? `/static/${String(item.local_path).replace(/^\/+/, '')}` : (item.url || null), status: 'ready' }, at)
    } catch (error) {
      failed.value.push({ file, position: at })
      ElMessage.warning(`${file.name} 上传失败: ${error.message}`)
    }
  }
  uploading.value = false
  const ok = progress.value.total - failed.value.length
  if (failed.value.length) ElMessage.warning(`上传完成：成功 ${ok} 个，失败 ${failed.value.length} 个`)
  else if (ok) ElMessage.success(`${ok} 个素材上传完成`)
}

async function retryFailed() { const items = [...failed.value]; failed.value = []; await handleFiles(items.map((item) => item.file), null, items.map((item) => item.position)) }

defineExpose({ pick, handleFiles })
</script>

<style scoped>
.board-upload{position:absolute;right:14px;bottom:14px;z-index:3;display:grid;gap:6px;width:240px;pointer-events:none}
.upload-progress{display:grid;gap:6px;padding:8px 10px;border:1px solid #334357;border-radius:8px;background:rgba(17,25,35,.92);color:#c6d4e4;font-size:.72rem;pointer-events:auto}
/* Narrow screens put the dock under this panel, so lift the progress box clear of it. */
@media(max-width:700px){.board-upload{bottom:64px}}
</style>
