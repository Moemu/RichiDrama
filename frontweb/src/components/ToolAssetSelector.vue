<template>
  <section class="tool-asset-selector">
    <div class="selector-heading"><b>{{ label }}</b><el-radio-group v-model="source" size="small"><el-radio-button value="library">素材库</el-radio-button><el-radio-button value="upload">本地上传</el-radio-button></el-radio-group></div>
    <template v-if="source === 'library'"><div class="asset-grid"><button v-for="asset in filteredAssets" :key="asset.id" type="button" :class="{ active: modelValue === asset.id }" @click="select(asset)"><img v-if="asset.type === 'image'" :src="assetUrl(asset)" alt="" /><video v-else-if="asset.type === 'video'" :src="assetUrl(asset)" muted preload="metadata" /><span v-else>♫</span><small>{{ asset.alias || asset.name }}</small></button></div><p v-if="!filteredAssets.length" class="empty">素材库暂无可用素材，可切换到“本地上传”。</p></template>
    <template v-else><el-button :loading="uploading" @click="fileInput?.click()">选择本地{{ acceptedLabel }}</el-button><input ref="fileInput" hidden type="file" :accept="accept" @change="upload" /><p class="upload-note">上传后会自动进入素材库并选中，后续可在其他工具复用。</p></template>
    <p v-if="selectedAsset" class="selected">已选：{{ selectedAsset.alias || selectedAsset.name }}</p>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { omniVideoAPI } from '@/api/omniVideo'

const props = defineProps({ modelValue: { type: Number, default: null }, types: { type: Array, default: () => ['image', 'video'] }, label: { type: String, default: '参考素材' } })
const emit = defineEmits(['update:modelValue', 'selected'])
const source = ref('library'), assets = ref([]), uploading = ref(false), fileInput = ref(null)
const filteredAssets = computed(() => assets.value.filter((asset) => props.types.includes(asset.type)))
const selectedAsset = computed(() => assets.value.find((asset) => asset.id === props.modelValue) || null)
const accept = computed(() => props.types.includes('video') && props.types.includes('image') ? 'image/*,video/*' : props.types.includes('video') ? 'video/*' : 'image/*')
const acceptedLabel = computed(() => props.types.includes('video') && props.types.includes('image') ? '图片或视频' : props.types.includes('video') ? '视频' : '图片')
const assetUrl = (asset) => asset?.local_path ? `/static/${asset.local_path}` : asset?.url || ''

async function load() { try { const result = await omniVideoAPI.assets({ scope: 'global', page_size: 100 }); assets.value = result.items || [] } catch (error) { ElMessage.error(error.message || '素材库加载失败') } }
function select(asset) { emit('update:modelValue', asset.id); emit('selected', asset) }
async function upload(event) { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; uploading.value = true; try { const result = await omniVideoAPI.upload(file, { name: file.name }); const asset = result.asset; if (!asset) throw new Error('上传未返回素材'); assets.value.unshift(asset); source.value = 'library'; select(asset); ElMessage.success('素材已上传并选中') } catch (error) { ElMessage.error(error.message || '素材上传失败') } finally { uploading.value = false } }
onMounted(load)
</script>

<style scoped>
.tool-asset-selector{display:grid;gap:8px}.selector-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.selector-heading b{font-size:12px}.asset-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;max-height:160px;overflow:auto}.asset-grid button{min-width:0;padding:4px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-raised);color:var(--text-regular);text-align:left;cursor:pointer}.asset-grid button:hover{background:var(--bg-hover);color:var(--text-primary)}.asset-grid button.active{border-color:var(--text-primary);box-shadow:inset 2px 0 0 var(--text-primary)}.asset-grid img,.asset-grid video,.asset-grid span{display:grid;place-items:center;width:100%;height:52px;object-fit:cover;background:var(--bg-hover);color:var(--text-muted)}.asset-grid small{display:block;padding-top:4px;overflow:hidden;color:var(--text-muted);font-size:10px;text-overflow:ellipsis;white-space:nowrap}.empty,.upload-note,.selected{margin:0;color:var(--text-muted);font-size:11px;line-height:1.45}.selected{color:var(--text-primary);font-weight:600}
</style>
