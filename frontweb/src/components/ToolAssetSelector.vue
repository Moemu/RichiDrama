<template>
  <section class="tool-asset-selector" :aria-label="label">
    <div class="selector-heading">
      <div><b>{{ label }}</b><small>{{ libraryHint }}</small></div>
      <el-radio-group v-model="source" size="small" aria-label="素材来源">
        <el-radio-button value="library">素材库</el-radio-button>
        <el-radio-button value="upload">本地上传</el-radio-button>
      </el-radio-group>
    </div>

    <template v-if="source === 'library'">
      <div v-if="filteredAssets.length" class="asset-grid">
        <button
          v-for="asset in filteredAssets"
          :key="asset.id"
          type="button"
          :class="{ active: isSelected(asset.id) }"
          :aria-pressed="String(isSelected(asset.id))"
          :aria-label="`${isSelected(asset.id) ? '取消选择' : '选择'}素材 ${asset.alias || asset.name}`"
          @click="select(asset)"
        >
          <span class="asset-preview">
            <img v-if="asset.type === 'image'" :src="assetUrl(asset)" :alt="asset.alias || asset.name || '图片素材'" width="160" height="96" loading="lazy" />
            <video v-else-if="asset.type === 'video'" :src="assetUrl(asset)" muted preload="metadata" :aria-label="asset.alias || asset.name || '视频素材'" />
            <span v-else class="audio-preview" aria-hidden="true">♫</span>
            <span v-if="isSelected(asset.id)" class="selected-mark" aria-hidden="true">✓</span>
          </span>
          <span class="asset-copy"><b>{{ asset.alias || asset.name }}</b><small>{{ asset.drama_id ? '项目素材' : '个人素材' }} · {{ typeLabel(asset.type) }}</small></span>
        </button>
      </div>
      <p v-else class="empty">{{ loading ? '正在读取素材…' : '暂无可用素材。可切换到“本地上传”。' }}</p>
    </template>

    <template v-else>
      <button class="upload-dropzone" type="button" :disabled="uploading" @click="fileInput?.click()">
        <span aria-hidden="true">＋</span>
        <b>{{ uploading ? '正在上传…' : `上传${acceptedLabel}` }}</b>
        <small>{{ dramaId ? '文件会保存到当前项目素材库，并自动选中。' : '文件会保存到个人素材库，并自动选中。' }}</small>
      </button>
      <input ref="fileInput" hidden type="file" :accept="accept" :aria-label="`上传${acceptedLabel}`" @change="upload" />
    </template>

    <div v-if="selectedAssets.length" class="selected-summary" role="status" aria-live="polite">
      <span>已选 {{ selectedAssets.length }} 项</span>
      <button type="button" @click="clear">清空</button>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { omniVideoAPI } from '@/api/omniVideo'

const props = defineProps({
  modelValue: { type: [Number, Array], default: null },
  types: { type: Array, default: () => ['image', 'video'] },
  label: { type: String, default: '参考素材' },
  multiple: { type: Boolean, default: false },
  dramaId: { type: Number, default: null },
  maxSelections: { type: Number, default: 50 },
})
const emit = defineEmits(['update:modelValue', 'selected', 'selection-change'])
const source = ref('library'), assets = ref([]), uploading = ref(false), loading = ref(false), fileInput = ref(null)
let loadRevision = 0
const filteredAssets = computed(() => assets.value.filter((asset) => props.types.includes(asset.type)))
const selectedIds = computed(() => props.multiple
  ? (Array.isArray(props.modelValue) ? props.modelValue.map(Number) : [])
  : (Number(props.modelValue) > 0 ? [Number(props.modelValue)] : []))
const selectedAssets = computed(() => selectedIds.value.map((id) => assets.value.find((asset) => Number(asset.id) === id)).filter(Boolean))
const libraryHint = computed(() => props.dramaId ? '当前项目素材 + 个人素材' : '个人素材；选择项目后可读取项目素材')
const accept = computed(() => props.types.map((type) => type === 'image' ? 'image/*' : type === 'video' ? 'video/*' : type === 'audio' ? 'audio/*' : '').filter(Boolean).join(','))
const acceptedLabel = computed(() => props.types.map(typeLabel).join('、'))
const assetUrl = (asset) => asset?.local_path ? `/static/${String(asset.local_path).replace(/^\/+/, '')}` : asset?.url || ''
const typeLabel = (type) => ({ image: '图片', video: '视频', audio: '音频' }[type] || '素材')
const isSelected = (id) => selectedIds.value.includes(Number(id))

async function load() {
  const revision = ++loadRevision
  loading.value = true
  try {
    const requests = [omniVideoAPI.assets({ scope: 'global', page_size: 100 })]
    if (Number(props.dramaId) > 0) requests.unshift(omniVideoAPI.assets({ scope: 'project', drama_id: Number(props.dramaId), page_size: 100 }))
    const results = await Promise.allSettled(requests)
    if (revision !== loadRevision) return
    const available = results.filter((result) => result.status === 'fulfilled').flatMap((result) => result.value.items || [])
    if (!available.length && results.every((result) => result.status === 'rejected')) throw results[0].reason
    if (results.some((result) => result.status === 'rejected')) ElMessage.warning('部分素材库加载失败，已显示可用素材')
    const unique = new Map(available.map((asset) => [Number(asset.id), asset]))
    assets.value = [...unique.values()]
    emitSelection()
  } catch (error) { ElMessage.error(error.message || '素材库加载失败') }
  finally { if (revision === loadRevision) loading.value = false }
}
function emitSelection() { emit('selection-change', selectedAssets.value) }
function select(asset) {
  if (props.multiple) {
    if (!isSelected(asset.id) && selectedIds.value.length >= props.maxSelections) return ElMessage.warning(`最多选择 ${props.maxSelections} 项素材`)
    const next = isSelected(asset.id) ? selectedIds.value.filter((id) => id !== Number(asset.id)) : [...selectedIds.value, Number(asset.id)]
    emit('update:modelValue', next)
    queueMicrotask(() => emit('selection-change', next.map((id) => assets.value.find((item) => Number(item.id) === id)).filter(Boolean)))
  } else {
    const next = isSelected(asset.id) ? null : Number(asset.id)
    emit('update:modelValue', next)
    emit('selected', next ? asset : null)
    emit('selection-change', next ? [asset] : [])
  }
}
function clear() {
  emit('update:modelValue', props.multiple ? [] : null)
  emit('selected', null)
  emit('selection-change', [])
}
async function upload(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  uploading.value = true
  try {
    const result = await omniVideoAPI.upload(file, { name: file.name, drama_id: Number(props.dramaId) || undefined })
    const asset = result.asset
    if (!asset) throw new Error('上传未返回素材')
    assets.value = [asset, ...assets.value.filter((item) => Number(item.id) !== Number(asset.id))]
    source.value = 'library'
    select(asset)
    ElMessage.success('素材已上传并选中')
  } catch (error) { ElMessage.error(error.message || '素材上传失败') }
  finally { uploading.value = false }
}
watch(() => props.dramaId, load)
onMounted(load)
</script>

<style scoped>
.tool-asset-selector{display:grid;gap:10px;min-width:0}.selector-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.selector-heading>div{display:grid;gap:3px;min-width:0}.selector-heading b{font-size:13px}.selector-heading small,.empty{color:var(--text-muted);font-size:11px;line-height:1.45}.asset-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;max-height:250px;padding-right:3px;overflow:auto;overscroll-behavior:contain}.asset-grid>button{display:grid;gap:6px;min-width:0;padding:5px;border:1px solid var(--border-subtle);border-radius:10px;background:var(--bg-raised);color:var(--text-regular);text-align:left;cursor:pointer;transition:border-color .16s ease,background-color .16s ease,transform .16s ease}.asset-grid>button:hover{border-color:color-mix(in srgb,var(--accent) 55%,var(--border-color));background:var(--bg-hover);transform:translateY(-1px)}.asset-grid>button:focus-visible,.upload-dropzone:focus-visible,.selected-summary button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.asset-grid>button.active{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--bg-raised));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 38%,transparent)}.asset-preview{position:relative;display:grid;place-items:center;overflow:hidden;border-radius:7px;background:var(--bg-hover);aspect-ratio:5/3}.asset-preview img,.asset-preview video,.audio-preview{width:100%;height:100%;object-fit:cover}.audio-preview{display:grid;place-items:center;color:var(--accent);font-size:24px}.selected-mark{position:absolute;top:5px;right:5px;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--accent);color:#fff;font-size:12px;font-weight:700}.asset-copy{display:grid;gap:2px;min-width:0}.asset-copy b,.asset-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.asset-copy b{font-size:11px}.asset-copy small{color:var(--text-muted);font-size:10px}.empty{margin:0;padding:18px;border:1px dashed var(--border-color);border-radius:10px;text-align:center}.upload-dropzone{display:grid;place-items:center;gap:5px;min-height:126px;padding:18px;border:1px dashed color-mix(in srgb,var(--accent) 45%,var(--border-color));border-radius:12px;background:color-mix(in srgb,var(--accent) 6%,var(--bg-raised));color:var(--text-primary);cursor:pointer}.upload-dropzone:hover{background:color-mix(in srgb,var(--accent) 11%,var(--bg-raised))}.upload-dropzone small{color:var(--text-muted);font-weight:400}.upload-dropzone>span{color:var(--accent);font-size:28px}.selected-summary{display:flex;align-items:center;justify-content:space-between;padding:7px 9px;border-radius:8px;background:color-mix(in srgb,var(--accent) 8%,var(--bg-raised));color:var(--text-regular);font-size:11px}.selected-summary button{border:0;background:transparent;color:var(--accent);cursor:pointer}@media(max-width:520px){.selector-heading{align-items:stretch;flex-direction:column}.asset-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(prefers-reduced-motion:reduce){.asset-grid>button{transition:none}.asset-grid>button:hover{transform:none}}
</style>
