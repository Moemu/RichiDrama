<template>
  <div class="editor" @dragover.prevent @drop.prevent="onDrop">
    <el-input
      ref="inputRef"
      v-model="text"
      type="textarea"
      :rows="7"
      placeholder="描述你要生成的视频；输入 @ 引用素材，或直接把左侧素材拖入此处"
      @input="onInput"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
    />
    <div v-if="dragging" class="drop-hint">松开以插入该素材 @引用</div>
    <div v-if="showPicker" class="asset-picker">
      <button v-for="asset in pickerAssets" :key="asset.id" type="button" @click="insertAsset(asset)">
        <span class="pa-icon">{{ icon(asset.type) }}</span>
        <span class="pa-name">{{ asset.alias || asset.name }}</span>
        <span v-if="asset._chosen" class="pa-chosen">已选</span>
      </button>
      <p v-if="!pickerAssets.length" class="pa-empty">没有匹配的素材</p>
    </div>
    <div v-if="referenced.length || unresolved.length" class="hints">
      <el-tag v-for="asset in referenced" :key="asset.id" size="small" effect="plain" closable @close="removeReference(asset)">@{{ asset.alias || asset.name }}</el-tag>
      <el-tag v-for="item in unresolved" :key="item.alias" type="warning" size="small" effect="plain">@{{ item.alias }} 待关联（名称重复）</el-tag>
    </div>
  </div>
</template>
<script setup>
import { computed, nextTick, ref, watch } from 'vue'
const props = defineProps({
  modelValue: { type: String, default: '' },
  /** 全部可选素材（不限于已选）；插入未选中的时会 emit pick 自动加入创作 */
  assets: { type: Array, default: () => [] },
  /** 已选素材 id 集合，用于在 @ 选择器里标记"已选" */
  chosenIds: { type: Set, default: () => new Set() },
})
const emit = defineEmits(['update:modelValue', 'pick', 'references'])
const inputRef = ref(null)
const text = ref(props.modelValue)
const showPicker = ref(false)
const dragging = ref(false)
let dragCounter = 0

watch(() => props.modelValue, (value) => { if (value !== text.value) text.value = value; syncReferences(value || '') })

// @ 选择器：显示全部素材，已选的标记 _chosen
const pickerAssets = computed(() =>
  (props.assets || [])
    .map((a) => ({ ...a, _chosen: props.chosenIds.has(a.id) }))
    .slice(0, 30)
)
const referenced = computed(() => {
  const tokens = referencesFromText(text.value)
  return tokens.flatMap((alias) => {
    const matches = (props.assets || []).filter((asset) => (asset.alias || asset.name) === alias)
    return matches.length === 1 ? matches : []
  })
})
const unresolved = computed(() => referencesFromText(text.value).flatMap((alias) => {
  const matches = (props.assets || []).filter((asset) => (asset.alias || asset.name) === alias)
  return matches.length > 1 ? [{ alias, candidates: matches.map((asset) => asset.id) }] : []
}))

function onInput(value) {
  emit('update:modelValue', value)
  syncReferences(value)
  showPicker.value = /@[^\s@]*$/.test(value)
}

function referencesFromText(value) {
  return [...new Set([...String(value || '').matchAll(/@([^\s@]+)/g)].map((match) => match[1]))]
}
function syncReferences(value) {
  const refs = []; const unresolvedRefs = []
  referencesFromText(value).forEach((alias) => {
    const matches = (props.assets || []).filter((asset) => (asset.alias || asset.name) === alias)
    if (matches.length === 1) refs.push({ asset_id: matches[0].id, alias })
    if (matches.length > 1) unresolvedRefs.push({ alias, candidate_asset_ids: matches.map((asset) => asset.id) })
  })
  emit('references', { text: value || '', refs, unresolved: unresolvedRefs })
}

function removeReference(asset) {
  const token = `@${asset.alias || asset.name}`
  text.value = text.value.replace(token, '').replace(/\s{2,}/g, ' ').trim()
  emit('update:modelValue', text.value); syncReferences(text.value)
}

/** 插入素材 @引用；若未选中则通知父组件加入创作 */
function insertAsset(asset, opts = {}) {
  // 未选中的先加入创作
  if (!props.chosenIds.has(asset.id)) emit('pick', asset)
  const token = `@${asset.alias || asset.name} `
  if (opts.append) {
    // 拖入：追加到末尾
    text.value = (text.value.replace(/\s*$/, '') + (text.value ? ' ' : '') + token).replace(/@\S+\s*$/, (m) => m)
    // 若末尾正好有未完成的 @xxx，替换它
    text.value = text.value.replace(/@[^\s@]*$/, token.trim()) + ' '
  } else {
    // @ 选择器：替换未完成的 @xxx
    text.value = text.value.replace(/@[^\s@]*$/, token)
  }
  emit('update:modelValue', text.value)
  syncReferences(text.value)
  showPicker.value = false
}

function icon(type) { return type === 'video' ? '🎬' : type === 'audio' ? '🎵' : '🖼️' }

// ===== 拖拽支持 =====
function onDragOver(e) { dragging.value = true }
function onDragLeave(e) { /* 由 counter 控制，见 onDrop/ondragenter */ }
function onDrop(e) {
  dragging.value = false
  dragCounter = 0
  const raw = e.dataTransfer?.getData('text/plain') || e.dataTransfer?.getData('application/json')
  let asset = null
  try { asset = raw ? JSON.parse(raw) : null } catch (_) { asset = null }
  // 父组件可能直接传 asset 对象（通过 dataTransfer）
  if (!asset && e.dataTransfer) {
    const a = e.dataTransfer.getData('asset')
    if (a) { try { asset = JSON.parse(a) } catch (_) {} }
  }
  if (asset && asset.id) insertAsset(asset, { append: true })
}
</script>
<style scoped>
.editor { position: relative; }
.editor :deep(.el-textarea__inner) { transition: border-color 0.2s, background 0.2s; }
.drop-hint {
  position: absolute; inset: 0; display: grid; place-items: center;
  background: #4b91c81a; border: 2px dashed #4b91c8; border-radius: 6px;
  color: #3479ae; font-size: 13px; font-weight: 600; pointer-events: none; z-index: 4;
}
.asset-picker {
  position: absolute; z-index: 5; left: 0; right: 0; top: 100%;
  max-height: 200px; overflow: auto; background: #fff;
  border: 1px solid #dce4f2; border-radius: 8px; box-shadow: 0 8px 20px #1d2b4d22; padding: 4px;
}
.asset-picker button {
  border: 0; background: transparent; width: 100%; text-align: left;
  padding: 7px 8px; border-radius: 5px; cursor: pointer; display: flex; align-items: center; gap: 6px;
}
.asset-picker button:hover { background: #f1f5ff; }
.pa-icon { font-size: 14px; }
.pa-name { flex: 1; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pa-chosen { font-size: 10px; color: #3479ae; background: #e8f3fa; padding: 1px 5px; border-radius: 3px; }
.pa-empty { font-size: 12px; color: #9aa6ba; text-align: center; padding: 12px; }
.hints { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
</style>
