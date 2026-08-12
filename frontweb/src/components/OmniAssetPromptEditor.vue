<template>
  <div class="editor" @dragover.prevent @drop.prevent="onDrop">
    <el-input
      ref="inputRef"
      v-model="text"
      type="textarea"
      :rows="7"
      placeholder="描述你要生成的视频；输入 @ 引用素材，或直接把左侧素材拖入此处"
      @input="onInput"
      @keyup="onCursorChange"
      @click="onCursorChange"
      @focus="onCursorChange"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent.stop="onDrop"
    />
    <div v-if="dragging" class="drop-hint">松开以插入该素材 @引用</div>
    <div v-if="showPicker" class="asset-picker">
      <button v-for="asset in pickerAssets" :key="asset.id" type="button" @click="insertAsset(asset)">
        <span class="pa-thumb">
          <img v-if="asset.type === 'image' && thumbUrl(asset)" :src="thumbUrl(asset)" class="pa-thumb-img" :alt="asset.alias || asset.name" />
          <img v-else-if="asset.type === 'video' && thumbUrl(asset)" :src="thumbUrl(asset)" class="pa-thumb-img" :alt="asset.alias || asset.name" />
          <span v-else class="pa-thumb-icon">{{ icon(asset.type) }}</span>
        </span>
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
import { computed, nextTick, onMounted, ref, watch } from 'vue'
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
watch(() => props.assets, () => syncReferences(text.value), { deep: false })
onMounted(() => syncReferences(text.value))

// @ 选择器：显示全部素材，已选的标记 _chosen
const pickerQuery = computed(() => (activeMentionRange()?.query || '').toLocaleLowerCase())
const pickerAssets = computed(() =>
  (props.assets || [])
    .filter((a) => a && a.id != null && (!pickerQuery.value || String(a.alias || a.name || '').toLocaleLowerCase().includes(pickerQuery.value)))
    .map((a) => ({ ...a, _chosen: props.chosenIds.has(a.id) }))
    .slice(0, 30)
)
const referenced = computed(() => {
  const tokens = referencesFromText(text.value)
  return tokens.flatMap((alias) => {
    const matches = (props.assets || []).filter((asset) => asset && (asset.alias || asset.name) === alias)
    return matches.length === 1 ? matches : []
  })
})
const unresolved = computed(() => referencesFromText(text.value).flatMap((alias) => {
  const matches = (props.assets || []).filter((asset) => asset && (asset.alias || asset.name) === alias)
  return matches.length > 1 ? [{ alias, candidates: matches.map((asset) => asset.id) }] : []
}))

function onInput(value) {
  emit('update:modelValue', value)
  syncReferences(value)
  nextTick(onCursorChange)
}

/**
 * `@` may be inserted anywhere in a sentence. Element Plus keeps the native
 * textarea under its component instance, so use its selection range instead
 * of treating only a trailing @ as an active mention.
 */
function activeMentionRange(value = text.value) {
  const textarea = inputRef.value?.textarea
  const cursor = Number.isInteger(textarea?.selectionStart) ? textarea.selectionStart : String(value || '').length
  const source = String(value || '')
  const before = source.slice(0, cursor)
  const at = before.lastIndexOf('@')
  if (at < 0 || /\s/.test(before.slice(at + 1))) return null
  // Only replace what was typed before the caret. Text on the right may be
  // ordinary sentence content, not part of the asset alias.
  return { start: at, end: cursor, query: source.slice(at + 1, cursor) }
}
function onCursorChange() { showPicker.value = !!activeMentionRange() }

function referencesFromText(value) {
  return [...new Set([...String(value || '').matchAll(/@([^\s@]+)/g)].map((match) => match[1]))]
}
function syncReferences(value) {
  const refs = []; const unresolvedRefs = []
  referencesFromText(value).forEach((alias) => {
    const matches = (props.assets || []).filter((asset) => asset && (asset.alias || asset.name) === alias)
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
  const token = `@${asset.alias || asset.name}`
  const mention = activeMentionRange()
  if (mention) {
    // Replace exactly the @ token around the caret, including one in the
    // middle of a sentence, then leave the cursor immediately after it.
    const suffix = text.value.slice(mention.end)
    const separator = suffix && !/^\s/.test(suffix) ? ' ' : ''
    text.value = `${text.value.slice(0, mention.start)}${token}${separator}${suffix}`
    nextTick(() => inputRef.value?.textarea?.setSelectionRange(mention.start + token.length + separator.length, mention.start + token.length + separator.length))
  } else if (opts.append) {
    text.value = `${text.value}${text.value && !/\s$/.test(text.value) ? ' ' : ''}${token} `
  } else return
  emit('update:modelValue', text.value)
  syncReferences(text.value)
  showPicker.value = false
}

function icon(type) { return type === 'video' ? '🎬' : type === 'audio' ? '🎵' : '🖼️' }

/** 素材缩略图 URL：优先 thumbnail_local_path，其次 url/local_path */
function thumbUrl(asset) {
  if (!asset) return ''
  const t = asset.thumbnail_local_path || asset.local_path || asset.url || asset.image_url || ''
  if (!t) return ''
  if (/^https?:\/\//i.test(t) || t.startsWith('data:')) return t
  return '/static/' + String(t).replace(/^\/+/, '')
}

// ===== 拖拽支持 =====
function onDragOver(e) { dragging.value = true }
function onDragLeave(e) { /* 由 counter 控制，见 onDrop/ondragenter */ }
function onDrop(e) {
  dragging.value = false
  dragCounter = 0
  const raw = e.dataTransfer?.getData('application/x-localminidrama-asset') || e.dataTransfer?.getData('application/json')
  let asset = null
  try { asset = raw ? JSON.parse(raw) : null } catch (_) { asset = null }
  // 兼容旧版素材卡的自定义 MIME 键。
  if (!asset && e.dataTransfer) {
    const a = e.dataTransfer.getData('asset')
    if (a) { try { asset = JSON.parse(a) } catch (_) {} }
  }
  if (asset && asset.id) insertAsset(asset, { append: true })
}
</script>
<style scoped>
.editor { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 188px; }
/* textarea 区作为主体撑满 editor 剩余高度；@选择器/引用标签为兄弟元素，按内容自适应 */
.editor :deep(.el-input) { flex: 1; min-height: 0; display: flex; }
.editor :deep(.el-textarea) { flex: 1; min-height: 0; display: flex; }
.editor :deep(.el-textarea__inner) { flex: 1; height: 100% !important; min-height: 160px; resize: none; transition: border-color 0.2s, background 0.2s; }
.drop-hint {
  position: absolute; inset: 0; display: grid; place-items: center;
  background: color-mix(in srgb, var(--bg-hover) 82%, transparent); border: 2px dashed var(--border-strong); border-radius: var(--radius-sm);
  color: var(--text-primary); font-size: 13px; font-weight: 600; pointer-events: none; z-index: 4;
}
.asset-picker {
  /* The editor sits in a scrollable side panel. Keeping the picker in normal
     flow prevents overflow:auto from clipping the @ menu at the panel edge. */
  position: relative; z-index: 30; margin-top: 5px;
  max-height: 200px; overflow: auto; background: var(--bg-surface, #202020);
  border: 1px solid var(--border-color, #555); border-radius: var(--radius-md, 6px); box-shadow: 0 8px 20px #0005; padding: 4px;
}
.asset-picker button {
  border: 0; background: transparent; width: 100%; text-align: left;
  padding: 7px 8px; border-radius: 5px; cursor: pointer; display: flex; align-items: center; gap: 6px;
}
.asset-picker button { color: var(--text-regular); }
.asset-picker button:hover { background: var(--bg-hover); color: var(--text-primary); }
.pa-icon { font-size: 14px; }
.pa-thumb { width: 96px; height: 96px; flex: 0 0 96px; display: grid; place-items: center; overflow: hidden; border-radius: 5px; background: var(--bg-hover); }
.pa-thumb-img { width: 100%; height: 100%; object-fit: cover; }
.pa-thumb-icon { font-size: 28px; }
.pa-name { flex: 1; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pa-chosen { font-size: 10px; color: var(--text-primary); background: var(--bg-active); padding: 1px 5px; border-radius: 3px; }
.pa-empty { font-size: 12px; color: var(--text-muted); text-align: center; padding: 12px; }
.hints { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
</style>
