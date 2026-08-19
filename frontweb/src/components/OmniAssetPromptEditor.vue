<template>
  <div ref="editorRoot" class="editor" @dragenter.prevent="onDragEnter" @dragover.prevent="onDragOver" @dragleave="onDragLeave" @drop.prevent="onDrop">
    <div class="drop-status" :class="{ active: dragging }" role="status" aria-live="polite">
      <span v-if="dragging">移动到目标文字间隙，紫色光标就是插入位置</span>
    </div>
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
      @drop.prevent.stop="onDrop"
    />
    <span
      v-if="dropCaret.visible"
      class="drop-caret"
      :class="{ 'blank-line': dropCaret.blankLine }"
      :style="{ left: `${dropCaret.x}px`, top: `${dropCaret.y}px`, height: `${dropCaret.height}px`, width: dropCaret.blankLine ? `${dropCaret.width}px` : undefined }"
      aria-hidden="true"
    ></span>
    <teleport to="body">
    <div v-if="showPicker" class="asset-picker" :style="pickerStyle">
      <button v-for="asset in pickerAssets" :key="asset.id" type="button" @click="insertAsset(asset)">
        <span class="pa-thumb">
          <img v-if="asset.type === 'image' && thumbUrl(asset)" :src="thumbUrl(asset)" class="pa-thumb-img" :alt="asset.alias || asset.name" loading="lazy" decoding="async" />
          <img v-else-if="asset.type === 'video' && thumbUrl(asset)" :src="thumbUrl(asset)" class="pa-thumb-img" :alt="asset.alias || asset.name" loading="lazy" decoding="async" />
          <span v-else class="pa-thumb-icon">{{ icon(asset.type) }}</span>
        </span>
        <span class="pa-name">{{ asset.alias || asset.name }}</span>
        <span v-if="asset._chosen" class="pa-chosen">已选</span>
      </button>
      <p v-if="!pickerAssets.length" class="pa-empty">没有匹配的素材</p>
      <p v-else-if="pickerMatchCount > pickerAssets.length" class="pa-limit">共 {{ pickerMatchCount }} 个匹配素材，当前轻量展示前 {{ pickerAssets.length }} 个；继续在 @ 后输入名称即可筛选</p>
    </div>
    </teleport>
    <div v-if="unresolved.length" class="reference-warnings" role="status" aria-live="polite">
      <span v-for="item in unresolved" :key="item.alias">@{{ item.alias }} 存在重名素材，请在上方重新选择</span>
    </div>
  </div>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { insertTokenAtOffset } from '@/utils/promptInsertion'
import { ASSET_POINTER_CANCEL, ASSET_POINTER_DROP, ASSET_POINTER_MOVE } from '@/utils/assetPointerDrag'
const props = defineProps({
  modelValue: { type: String, default: '' },
  /** 全部可选素材（不限于已选）；插入未选中的时会 emit pick 自动加入创作 */
  assets: { type: Array, default: () => [] },
  /** 已选素材 id 集合，用于在 @ 选择器里标记"已选" */
  chosenIds: { type: Set, default: () => new Set() },
})
const emit = defineEmits(['update:modelValue', 'pick', 'references'])
const inputRef = ref(null)
const editorRoot = ref(null)
const text = ref(props.modelValue)
const showPicker = ref(false)
const dragging = ref(false)
const dropCaret = ref({ visible: false, offset: 0, x: 0, y: 0, height: 18, width: 0, blankLine: false })
const pickerStyle = ref({})
let dragCounter = 0
let lastCaretOffset = 0
let layoutCache = null
let dragRaf = 0
let latestDragPoint = null

watch(() => props.modelValue, (value) => { if (value !== text.value) text.value = value; syncReferences(value || '') })
watch(() => props.assets, () => syncReferences(text.value), { deep: false })
onMounted(() => {
  syncReferences(text.value)
  window.addEventListener(ASSET_POINTER_MOVE, onAssetPointerMove)
  window.addEventListener(ASSET_POINTER_DROP, onAssetPointerDrop)
  window.addEventListener(ASSET_POINTER_CANCEL, onAssetPointerCancel)
})

// @ 选择器：显示全部素材，已选的标记 _chosen
const pickerQuery = computed(() => (activeMentionRange()?.query || '').toLocaleLowerCase())
const pickerMatches = computed(() =>
  (props.assets || [])
    .filter((a) => a && a.id != null && (!pickerQuery.value || String(a.alias || a.name || '').toLocaleLowerCase().includes(pickerQuery.value)))
    .map((a) => ({ ...a, _chosen: props.chosenIds.has(a.id) }))
)
const pickerAssets = computed(() => pickerMatches.value.slice(0, 30))
const pickerMatchCount = computed(() => pickerMatches.value.length)
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
  clearLayoutCache()
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
function onCursorChange() {
  const textarea = inputRef.value?.textarea
  if (Number.isInteger(textarea?.selectionStart)) lastCaretOffset = textarea.selectionStart
  showPicker.value = !!activeMentionRange()
  if (showPicker.value) nextTick(positionPickerAndMention)
}
onBeforeUnmount(() => {
  clearLayoutCache()
  window.removeEventListener(ASSET_POINTER_MOVE, onAssetPointerMove)
  window.removeEventListener(ASSET_POINTER_DROP, onAssetPointerDrop)
  window.removeEventListener(ASSET_POINTER_CANCEL, onAssetPointerCancel)
})

function positionPickerAndMention() {
  const textarea = inputRef.value?.textarea
  if (!textarea) return
  const rect = textarea.getBoundingClientRect()
  const width = Math.min(Math.max(280, window.innerWidth - 16), Math.max(420, Math.min(760, rect.width)))
  const height = Math.min(260, Math.max(180, window.innerHeight - 24))
  const top = rect.top >= height + 12 ? rect.top - height - 8 : rect.bottom + 8
  pickerStyle.value = { position: 'fixed', left: `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.left))}px`, top: `${Math.max(8, top)}px`, width: `${width}px`, maxHeight: `${height}px` }
}

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

/** 插入素材 @引用；若未选中则通知父组件加入创作 */
function insertAsset(asset, opts = {}) {
  // 未选中的先加入创作; entity 类素材(无素材库 id)只插入引用, 不触发加入创作
  if (asset.id != null && !props.chosenIds.has(asset.id)) emit('pick', asset)
  const token = `@${asset.alias || asset.name}`
  const explicitOffset = Number.isFinite(Number(opts.offset)) ? Number(opts.offset) : null
  const mention = explicitOffset == null ? activeMentionRange() : null
  if (explicitOffset != null) {
    const inserted = insertTokenAtOffset(text.value, token, explicitOffset)
    text.value = inserted.text
    lastCaretOffset = inserted.caret
    nextTick(() => {
      inputRef.value?.textarea?.focus()
      inputRef.value?.textarea?.setSelectionRange(inserted.caret, inserted.caret)
    })
  } else if (mention) {
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

// Deterministic alternative to HTML5 drag-and-drop: the parent material card
// can insert at the last native textarea caret even after the button takes focus.
function insertAtCaret(asset) {
  insertAsset(asset, { offset: lastCaretOffset })
}

defineExpose({ insertAtCaret })

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
function onDragEnter() { dragCounter += 1; dragging.value = true; clearLayoutCache(); ensureLayoutCache() }
function onDragOver(event) {
  dragging.value = true
  latestDragPoint = { clientX: event.clientX, clientY: event.clientY }
  if (!dragRaf) dragRaf = requestAnimationFrame(() => {
    dragRaf = 0
    const point = textareaPointFromEvent(latestDragPoint)
    dropCaret.value = { visible: true, ...point }
  })
}
function onDragLeave() {
  dragCounter = Math.max(0, dragCounter - 1)
  if (!dragCounter) {
    dragging.value = false
    dropCaret.value.visible = false
    clearLayoutCache()
  }
}

function clearLayoutCache() {
  if (layoutCache?.mirror) layoutCache.mirror.remove()
  layoutCache = null
  if (dragRaf) cancelAnimationFrame(dragRaf)
  dragRaf = 0
}

function ensureLayoutCache() {
  const textarea = inputRef.value?.textarea
  const editor = textarea?.closest('.editor')
  if (!textarea || !editor) return null
  const source = String(text.value || '')
  const rect = textarea.getBoundingClientRect()
  // 缓存键必须包含视口位置: 页面/面板滚动后 rect.top 变化而 source/width/scrollTop 不变, 旧缓存的 boundaries 是过期视口坐标, 造成拖拽光标错乱或不显示(时灵时不灵的根因)
  if (layoutCache && layoutCache.source === source && layoutCache.width === rect.width && layoutCache.scrollTop === textarea.scrollTop && Math.abs(layoutCache.rectTop - rect.top) < 0.5 && Math.abs(layoutCache.rectLeft - rect.left) < 0.5) return layoutCache
  clearLayoutCache()
  const editorRect = editor.getBoundingClientRect()
  const style = getComputedStyle(textarea)
  const mirror = document.createElement('div')
  const copied = ['boxSizing', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'whiteSpace', 'overflowWrap', 'wordBreak', 'tabSize', 'textTransform', 'textIndent']
  copied.forEach((name) => { mirror.style[name] = style[name] })
  Object.assign(mirror.style, {
    position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`,
    height: `${rect.height}px`, overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none',
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word', zIndex: '-1',
  })
  const textNode = document.createTextNode(source)
  mirror.appendChild(textNode)
  document.body.appendChild(mirror)
  mirror.scrollTop = textarea.scrollTop
  mirror.scrollLeft = textarea.scrollLeft
  const fallbackHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5 || 18
  const boundaries = []
  const contentLeft = rect.left + Number.parseFloat(style.borderLeftWidth || 0) + Number.parseFloat(style.paddingLeft || 0)
  let logicalLineY = rect.top + Number.parseFloat(style.borderTopWidth || 0) + Number.parseFloat(style.paddingTop || 0) - textarea.scrollTop
  try {
    for (let i = 0; i < source.length; i++) {
      if (source[i] === '\n') {
        boundaries.push({ offset: i, x: contentLeft, y: logicalLineY, height: fallbackHeight })
        logicalLineY += fallbackHeight
        boundaries.push({ offset: i + 1, x: contentLeft, y: logicalLineY, height: fallbackHeight })
        continue
      }
      const range = document.createRange()
      range.setStart(textNode, i)
      range.setEnd(textNode, i + 1)
      const charRect = range.getBoundingClientRect()
      if (!charRect.width && !charRect.height) continue
      logicalLineY = charRect.top
      boundaries.push({ offset: i, x: charRect.left, y: charRect.top, height: Math.max(12, charRect.height || fallbackHeight) })
      boundaries.push({ offset: i + 1, x: charRect.right, y: charRect.top, height: Math.max(12, charRect.height || fallbackHeight) })
    }
  } catch (_) {}
  if (!boundaries.length) boundaries.push({ offset: 0, x: rect.left + Number.parseFloat(style.paddingLeft || 0), y: rect.top + Number.parseFloat(style.paddingTop || 0), height: fallbackHeight })
  layoutCache = { source, width: rect.width, scrollTop: textarea.scrollTop, rectTop: rect.top, rectLeft: rect.left, mirror, boundaries, editorRect }
  return layoutCache
}

function textareaPointFromEvent(event) {
  const cache = ensureLayoutCache()
  if (!cache || !Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) return { offset: lastCaretOffset, x: 0, y: 0, height: 18 }
  let best = { ...cache.boundaries[0], score: Number.POSITIVE_INFINITY }
  for (const boundary of cache.boundaries) {
    const bottom = boundary.y + boundary.height
    const yDistance = event.clientY < boundary.y ? boundary.y - event.clientY : event.clientY > bottom ? event.clientY - bottom : 0
    const score = yDistance * 1000 + Math.abs(event.clientX - boundary.x)
    if (score < best.score) best = { ...boundary, score }
  }
  const lineStart = cache.source.lastIndexOf('\n', Math.max(0, best.offset - 1)) + 1
  const nextBreak = cache.source.indexOf('\n', best.offset)
  const lineEnd = nextBreak < 0 ? cache.source.length : nextBreak
  const blankLine = cache.source.slice(lineStart, lineEnd).trim().length === 0
  return {
    offset: best.offset,
    x: blankLine ? Math.max(8, best.x - cache.editorRect.left) : Math.max(0, Math.min(cache.editorRect.width - 2, best.x - cache.editorRect.left)),
    y: Math.max(0, best.y - cache.editorRect.top),
    height: blankLine ? 2 : best.height,
    width: blankLine ? Math.max(32, cache.editorRect.width - Math.max(16, (best.x - cache.editorRect.left) * 2)) : 3,
    blankLine,
  }
}

function pointerInside(detail) {
  const rect = editorRoot.value?.getBoundingClientRect()
  return !!rect && detail.clientX >= rect.left && detail.clientX <= rect.right && detail.clientY >= rect.top && detail.clientY <= rect.bottom
}

function onAssetPointerMove(event) {
  const detail = event.detail || {}
  if (!pointerInside(detail)) {
    dragging.value = false
    dropCaret.value.visible = false
    return
  }
  dragging.value = true
  dropCaret.value = { visible: true, ...textareaPointFromEvent(detail) }
}

function onAssetPointerDrop(event) {
  const detail = event.detail || {}
  const point = pointerInside(detail) ? (dropCaret.value.visible ? dropCaret.value : textareaPointFromEvent(detail)) : null
  dragging.value = false
  dropCaret.value.visible = false
  clearLayoutCache()
  if (point && detail.asset?.id) insertAsset(detail.asset, { offset: point.offset })
}

function onAssetPointerCancel() {
  dragging.value = false
  dropCaret.value.visible = false
  clearLayoutCache()
}

function onDrop(e) {
  dragging.value = false
  const point = dropCaret.value.visible ? dropCaret.value : textareaPointFromEvent(e)
  dropCaret.value.visible = false
  dragCounter = 0
  clearLayoutCache()
  const raw = e.dataTransfer?.getData('application/x-localminidrama-asset') || e.dataTransfer?.getData('application/json')
  let asset = null
  try { asset = raw ? JSON.parse(raw) : null } catch (_) { asset = null }
  // 兼容旧版素材卡的自定义 MIME 键。
  if (!asset && e.dataTransfer) {
    const a = e.dataTransfer.getData('asset')
    if (a) { try { asset = JSON.parse(a) } catch (_) {} }
  }
  // 兼容 FilmCreate 分镜页旧原生拖拽的 payload 字段(assetId/entity):
  // entity 类素材(角色/场景/道具)没有素材库 id, 仅插入 @token 不加入创作。
  if (asset && asset.assetId != null && asset.id == null) asset.id = asset.assetId
  if (asset && (asset.id != null || asset.entity)) insertAsset(asset, { offset: point.offset })
}
</script>
<style scoped>
.editor { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 188px; }
/* textarea 区作为主体撑满 editor 剩余高度；@选择器/引用标签为兄弟元素，按内容自适应 */
.editor :deep(.el-input) { flex: 1; min-height: 0; display: flex; }
.editor :deep(.el-textarea) { flex: 1; min-height: 0; display: flex; }
.editor :deep(.el-textarea__inner) { flex: 1; height: 100% !important; min-height: 160px; overflow-y: auto; overscroll-behavior-y: contain; scrollbar-gutter: stable; resize: none; transition: border-color 0.2s, background 0.2s; }
.drop-status {
  flex: 0 0 26px; min-width: 0; display: flex; align-items: center; justify-content: flex-end;
  padding: 0 4px; color: var(--text-muted); font-size: 12px; line-height: 1; pointer-events: none;
}
.drop-status.active { color: var(--accent); font-weight: 600; }
.drop-caret { position: absolute; width: 3px; min-height: 16px; border-radius: 3px; background: var(--accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--bg-page) 70%, transparent), 0 0 12px var(--accent); pointer-events: none; z-index: 6; animation: drop-caret-pulse .8s ease-in-out infinite alternate; }
.drop-caret.blank-line { min-height: 2px; transform: translateY(.7em); box-shadow: 0 0 0 1px color-mix(in srgb, var(--bg-page) 70%, transparent), 0 0 10px color-mix(in srgb, var(--accent) 62%, transparent); }
.drop-caret.blank-line::before { content: ''; position: absolute; inset-inline-start: -3px; inset-block-start: -2px; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
@keyframes drop-caret-pulse { to { opacity: .45; } }
.asset-picker {
  z-index: 5000; overflow: auto; background: color-mix(in srgb,var(--bg-surface,#202020) 74%,transparent);
  border: 1px solid color-mix(in srgb,var(--border-color,#777) 72%,transparent); border-radius: var(--radius-md, 8px); box-shadow: 0 12px 32px #0006; padding: 8px;
  backdrop-filter:blur(14px) saturate(.82); -webkit-backdrop-filter:blur(14px) saturate(.82);
  display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px;
}
.asset-picker button {
  border: 0; background: transparent; width: 100%; min-width:0; text-align: left;
  padding: 7px 8px; border-radius: 5px; cursor: pointer; display:grid; grid-template-columns:72px minmax(0,1fr); align-items:center; gap:8px;
}
.asset-picker button { color: var(--text-regular); }
.asset-picker button:hover,.asset-picker button:focus-visible { background:color-mix(in srgb,var(--bg-hover) 78%,transparent); color: var(--text-primary); }
.pa-icon { font-size: 14px; }
.pa-thumb { width:72px; height:54px; display:grid; place-items:center; overflow:hidden; border-radius:5px; background:var(--bg-hover); }
.pa-thumb-img { width: 100%; height: 100%; object-fit: cover; }
.pa-thumb-icon { font-size: 28px; }
.pa-name { flex: 1; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pa-chosen { grid-column:2; width:max-content; font-size: 10px; color: var(--text-primary); background: var(--bg-active); padding: 1px 5px; border-radius: 3px; }
.pa-empty { grid-column:1/-1; font-size: 12px; color: var(--text-muted); text-align: center; padding: 12px; }
.pa-limit { position:sticky; bottom:-8px; grid-column:1/-1; margin:0 -8px -8px; padding:8px 10px; border-top:1px solid color-mix(in srgb,var(--border-color,#777) 60%,transparent); background:color-mix(in srgb,var(--bg-surface,#202020) 86%,transparent); color:var(--text-muted); font-size:11px; line-height:1.45; backdrop-filter:blur(10px); }
.reference-warnings { display: grid; gap: 3px; margin-top: 6px; color: var(--status-warning); font-size: 11px; line-height: 1.45; }
</style>
