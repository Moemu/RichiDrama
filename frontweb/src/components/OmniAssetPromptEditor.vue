<template>
  <div ref="editorRoot" class="editor" :class="{ dragging }" @dragenter.prevent="onDragEnter" @dragover.prevent="onDragOver" @dragleave="onDragLeave" @drop.prevent="onDrop">
    <div class="drop-status" :class="{ active: dragging }" role="status" aria-live="polite">
      <span v-if="dragging">{{ dropCaret.rejected ? '空白行不能插入，请移动到某个字前后' : '已定位到文字间隙，松开即可插入' }}</span>
    </div>
    <div
      ref="editorRef"
      class="prompt-rich-editor"
      contenteditable="true"
      role="textbox"
      aria-multiline="true"
      aria-label="镜头提示词"
      data-placeholder="描述你要生成的视频；输入 @ 引用素材，或直接把左侧素材拖入此处"
      @input="onInput"
      @keyup="onCursorChange"
      @click="onCursorChange"
      @focus="onCursorChange"
      @dragover.prevent="onDragOver"
      @drop.prevent.stop="onDrop"
    ></div>
    <span
      v-if="dropCaret.visible && !dropCaret.rejected"
      class="drop-caret"
      :style="{ left: `${dropCaret.x}px`, top: `${dropCaret.y}px`, height: `${dropCaret.height}px` }"
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
  /** 结构化引用：素材 ID + 文本位置。重名素材不再仅靠文件名猜测。 */
  referenceDocument: { type: Object, default: () => ({ refs: [] }) },
})
const emit = defineEmits(['update:modelValue', 'pick', 'references'])
const editorRef = ref(null)
const editorRoot = ref(null)
const text = ref(props.modelValue)
const showPicker = ref(false)
const dragging = ref(false)
const dropCaret = ref({ visible: false, offset: 0, x: 0, y: 0, height: 18, rejected: false })
const pickerStyle = ref({})
let dragCounter = 0
let lastCaretOffset = 0
let layoutCache = null
let dragRaf = 0
let latestDragPoint = null
let emittedReferenceSignature = ''

watch(() => props.modelValue, (value) => { if (value !== text.value) { text.value = value; nextTick(() => renderEditor(value)) }; syncReferences(value || '') })
watch(() => props.assets, () => { syncReferences(text.value); nextTick(() => renderEditor(text.value)) }, { deep: false })
watch(() => props.referenceDocument, () => { syncReferences(text.value); nextTick(() => renderEditor(text.value)) }, { deep: true })
onMounted(() => {
  syncReferences(text.value)
  nextTick(() => renderEditor(text.value))
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
const resolvedReferences = ref([])
const unresolved = ref([])

function onInput() {
  clearLayoutCache()
  text.value = serializeEditor()
  emit('update:modelValue', text.value)
  syncReferences(text.value)
  nextTick(onCursorChange)
}

/**
 * `@` may be inserted anywhere in a sentence. Element Plus keeps the native
 * textarea under its component instance, so use its selection range instead
 * of treating only a trailing @ as an active mention.
 */
function activeMentionRange(value = text.value) {
  const cursor = lastCaretOffset
  const source = String(value || '')
  const before = source.slice(0, cursor)
  const at = before.lastIndexOf('@')
  if (at < 0 || /\s/.test(before.slice(at + 1))) return null
  // Only replace what was typed before the caret. Text on the right may be
  // ordinary sentence content, not part of the asset alias.
  return { start: at, end: cursor, query: source.slice(at + 1, cursor) }
}
function onCursorChange() {
  lastCaretOffset = caretOffset()
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
  const rect = editorRef.value?.getBoundingClientRect()
  if (!rect) return
  const width = Math.min(Math.max(280, window.innerWidth - 16), Math.max(420, Math.min(760, rect.width)))
  const height = Math.min(260, Math.max(180, window.innerHeight - 24))
  const top = rect.top >= height + 12 ? rect.top - height - 8 : rect.bottom + 8
  pickerStyle.value = { position: 'fixed', left: `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.left))}px`, top: `${Math.max(8, top)}px`, width: `${width}px`, maxHeight: `${height}px` }
}

function referencesFromText(value) {
  return [...new Set([...String(value || '').matchAll(/@([^\s@]+)/g)].map((match) => match[1]))]
}
function assetMatchesAlias(asset, alias) {
  return [asset?.alias, asset?.reference_alias, asset?.name, ...(asset?.legacy_aliases || [])]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .includes(alias)
}
function syncReferences(value) {
  const refs = []; const unresolvedRefs = []; const occurrences = new Map()
  const persisted = Array.isArray(props.referenceDocument?.refs) ? props.referenceDocument.refs : []
  for (const match of String(value || '').matchAll(/@([^\s@]+)/g)) {
    const alias = match[1]; const occurrence = occurrences.get(alias) || 0
    occurrences.set(alias, occurrence + 1)
    const matches = (props.assets || []).filter((asset) => asset && assetMatchesAlias(asset, alias))
    const previous = persisted.find((entry) => String(entry?.alias || '') === alias && Number(entry?.occurrence || 0) === occurrence && matches.some((asset) => Number(asset.id) === Number(entry.asset_id)))
    const asset = previous ? matches.find((item) => Number(item.id) === Number(previous.asset_id)) : (matches.length === 1 ? matches[0] : null)
    if (asset) refs.push({ asset_id: asset.id, alias, occurrence, start: match.index, end: match.index + match[0].length })
    else if (matches.length > 1) unresolvedRefs.push({ alias, occurrence, candidate_asset_ids: matches.map((asset) => asset.id) })
  }
  resolvedReferences.value = refs
  unresolved.value = unresolvedRefs
  const documentValue = { text: value || '', refs, unresolved: unresolvedRefs }
  const signature = JSON.stringify(documentValue)
  if (signature !== emittedReferenceSignature) {
    emittedReferenceSignature = signature
    emit('references', documentValue)
  }
}

/** 插入素材 @引用；若未选中则通知父组件加入创作 */
function insertAsset(asset, opts = {}) {
  // 未选中的先加入创作; entity 类素材(无素材库 id)只插入引用, 不触发加入创作
  if (asset.id != null && !props.chosenIds.has(asset.id)) emit('pick', asset)
  const token = `@${asset.alias || asset.name}`
  const explicitOffset = Number.isFinite(Number(opts.offset)) ? Number(opts.offset) : null
  const mention = explicitOffset == null ? activeMentionRange() : null
  const scrollPosition = { top: editorRef.value?.scrollTop || 0, left: editorRef.value?.scrollLeft || 0 }
  let caret = null
  if (explicitOffset != null) {
    const inserted = insertTokenAtOffset(text.value, token, explicitOffset)
    text.value = inserted.text
    lastCaretOffset = inserted.caret
    caret = inserted.caret
  } else if (mention) {
    // Replace exactly the @ token around the caret, including one in the
    // middle of a sentence, then leave the cursor immediately after it.
    const suffix = text.value.slice(mention.end)
    const separator = suffix && !/^\s/.test(suffix) ? ' ' : ''
    text.value = `${text.value.slice(0, mention.start)}${token}${separator}${suffix}`
    caret = mention.start + token.length + separator.length
    lastCaretOffset = caret
  } else if (opts.append) {
    text.value = `${text.value}${text.value && !/\s$/.test(text.value) ? ' ' : ''}${token} `
    caret = text.value.length
    lastCaretOffset = caret
  } else return
  emit('update:modelValue', text.value)
  syncReferences(text.value)
  // 这里以前同时执行了多次 render + focusEditorEnd；任一次聚焦末尾都会
  // 让长提示词的内部滚动条跳回顶部。插入后只重绘一次，并恢复原视口。
  nextTick(() => restoreEditorAfterInsert(caret, scrollPosition))
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

function matchingAsset(alias, occurrence = 0) {
  const reference = resolvedReferences.value.find((entry) => entry.alias === alias && Number(entry.occurrence || 0) === occurrence)
  if (reference) return (props.assets || []).find((asset) => Number(asset?.id) === Number(reference.asset_id)) || null
  const matches = (props.assets || []).filter((asset) => asset && assetMatchesAlias(asset, alias))
  return matches.length === 1 ? matches[0] : null
}
function serializeNode(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  if (node.dataset?.token) return node.dataset.token
  if (node.tagName === 'BR') return '\n'
  return [...node.childNodes].map(serializeNode).join('')
}
function serializeEditor() { return [...(editorRef.value?.childNodes || [])].map(serializeNode).join('') }
function renderEditor(value, force = false) {
  const el = editorRef.value
  if (!el || (!force && document.activeElement === el)) return
  el.replaceChildren()
  const source = String(value || '')
  const matcher = /@([^\s@]+)/g
  let last = 0; let found; const occurrences = new Map()
  while ((found = matcher.exec(source))) {
    if (found.index > last) el.append(document.createTextNode(source.slice(last, found.index)))
    const alias = found[1]; const occurrence = occurrences.get(alias) || 0; occurrences.set(alias, occurrence + 1); const asset = matchingAsset(alias, occurrence)
    if (!asset) el.append(document.createTextNode(found[0]))
    else {
      const chip = document.createElement('span')
      chip.className = 'prompt-asset-chip'; chip.contentEditable = 'false'; chip.dataset.token = found[0]
      chip.setAttribute('role', 'img'); chip.setAttribute('aria-label', `引用素材：${alias}`)
      const url = thumbUrl(asset)
      if (url && asset.type !== 'audio') { const image = document.createElement('img'); image.src = url; image.alt = ''; chip.append(image) }
      else { const icon = document.createElement('span'); icon.textContent = iconForAsset(asset.type); icon.setAttribute('aria-hidden', 'true'); chip.append(icon) }
      const name = document.createElement('b'); name.textContent = alias; chip.append(name)
      el.append(chip)
    }
    last = found.index + found[0].length
  }
  if (last < source.length) el.append(document.createTextNode(source.slice(last)))
}
function iconForAsset(type) { return type === 'video' ? '🎬' : type === 'audio' ? '🎵' : '🖼️' }
function caretOffset() {
  const el = editorRef.value; const selection = window.getSelection()
  if (!el || !selection?.rangeCount || !el.contains(selection.anchorNode)) return String(text.value || '').length
  const range = selection.getRangeAt(0).cloneRange(); range.selectNodeContents(el); range.setEnd(selection.anchorNode, selection.anchorOffset)
  const holder = document.createElement('div'); holder.append(range.cloneContents())
  return [...holder.childNodes].map(serializeNode).join('').length
}
function focusEditorEnd() {
  const el = editorRef.value; if (!el) return; el.focus()
  const range = document.createRange(); range.selectNodeContents(el); range.collapse(false)
  const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); lastCaretOffset = String(text.value || '').length
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
  return null
  /* istanbul ignore next -- retained below as reference for the former textarea layout algorithm.
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
  return layoutCache */
}

/**
 * Chromium may report a zero-sized rectangle for a collapsed range inside a
 * contenteditable element (especially beside a non-editable @素材 chip).
 * Resolve a real text/chip boundary instead of falling back to the pointer
 * coordinate, otherwise the visible insertion caret appears to float or
 * vanish even though the calculated insertion offset is correct.
 */
function visualRectForCollapsedRange(range) {
  const direct = range?.getBoundingClientRect?.()
  if (direct && (direct.width > 0 || direct.height > 0)) return { left: direct.left, top: direct.top, height: direct.height }
  const node = range?.startContainer
  const offset = Number(range?.startOffset)
  if (!node || !Number.isInteger(offset)) return null
  const probe = document.createRange()
  try {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.nodeValue?.length || 0
      if (offset < length) {
        probe.setStart(node, offset); probe.setEnd(node, offset + 1)
        const rect = probe.getBoundingClientRect()
        if (rect.width > 0 || rect.height > 0) return { left: rect.left, top: rect.top, height: rect.height }
      }
      if (offset > 0) {
        probe.setStart(node, offset - 1); probe.setEnd(node, offset)
        const rect = probe.getBoundingClientRect()
        if (rect.width > 0 || rect.height > 0) return { left: rect.right, top: rect.top, height: rect.height }
      }
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const children = node.childNodes || []
      const next = children[offset]
      const prev = children[offset - 1]
      const nextRect = next && (next.nodeType === Node.TEXT_NODE ? null : next.getBoundingClientRect?.())
      if (nextRect && (nextRect.width > 0 || nextRect.height > 0)) return { left: nextRect.left, top: nextRect.top, height: nextRect.height }
      const prevRect = prev && (prev.nodeType === Node.TEXT_NODE ? null : prev.getBoundingClientRect?.())
      if (prevRect && (prevRect.width > 0 || prevRect.height > 0)) return { left: prevRect.right, top: prevRect.top, height: prevRect.height }
    }
  } catch (_) {}
  return null
}

function focusEditorAtOffset(offset, scrollPosition) {
  const el = editorRef.value
  if (!el) return
  const target = Math.max(0, Number(offset) || 0)
  const range = document.createRange()
  let consumed = 0
  let placed = false
  for (let index = 0; index < el.childNodes.length; index += 1) {
    const node = el.childNodes[index]
    const length = serializeNode(node).length
    if (target <= consumed + length) {
      if (node.nodeType === Node.TEXT_NODE) range.setStart(node, Math.max(0, Math.min(node.nodeValue?.length || 0, target - consumed)))
      else range.setStart(el, target === consumed ? index : index + 1)
      placed = true
      break
    }
    consumed += length
  }
  if (!placed) { range.selectNodeContents(el); range.collapse(false) }
  range.collapse(true)
  el.focus({ preventScroll: true })
  const selection = window.getSelection()
  selection?.removeAllRanges(); selection?.addRange(range)
  // contenteditable 在 replaceChildren 后偶尔自行归零 scrollTop，显式回填
  // 原位置可避免在提示词底部插入时预览面跳回顶部。
  el.scrollTop = scrollPosition?.top || 0
  el.scrollLeft = scrollPosition?.left || 0
  lastCaretOffset = target
}

function restoreEditorAfterInsert(caret, scrollPosition) {
  renderEditor(text.value, true)
  focusEditorAtOffset(caret, scrollPosition)
}

function offsetForRange(range) {
  const el = editorRef.value
  if (!el || !range?.startContainer || !el.contains(range.startContainer)) return String(text.value || '').length
  const before = range.cloneRange()
  before.selectNodeContents(el)
  before.setEnd(range.startContainer, range.startOffset)
  const holder = document.createElement('div')
  holder.append(before.cloneContents())
  return [...holder.childNodes].map(serializeNode).join('').length
}

function textareaPointFromEvent(event) {
  if (!Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) return { offset: lastCaretOffset, x: 0, y: 0, height: 18, rejected: true }
  const position = document.caretPositionFromPoint?.(event.clientX, event.clientY)
  const range = position ? (() => { const next = document.createRange(); next.setStart(position.offsetNode, position.offset); next.collapse(true); return next })() : document.caretRangeFromPoint?.(event.clientX, event.clientY)
  if (range && editorRef.value?.contains(range.startContainer)) {
    // 预览拖拽时不要改写原生 Selection。否则 contenteditable 会同时显示
    // 浏览器光标和自定义光标，并且 Vue 重绘后可能把当前选区复位。
    const offset = offsetForRange(range)
    const source = String(text.value || '')
    const lineStart = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
    const nextBreak = source.indexOf('\n', offset)
    const lineEnd = nextBreak < 0 ? source.length : nextBreak
    // 空白行没有可辨识的文字前后。拒绝该落点而非把素材塞进空行，避免拖放
    // 看似成功却难以判断实际插入位置。
    if (!source.slice(lineStart, lineEnd).trim()) return { offset, x: 0, y: 0, height: 18, rejected: true }
    const rootRect = editorRoot.value?.getBoundingClientRect() || editorRef.value.getBoundingClientRect()
    const caretRect = visualRectForCollapsedRange(range)
    const lineHeight = Number.parseFloat(getComputedStyle(editorRef.value).lineHeight) || 20
    if (!caretRect) return { offset, x: 0, y: 0, height: lineHeight, rejected: true }
    return {
      offset,
      x: Math.max(0, Math.min(rootRect.width - 3, caretRect.left - rootRect.left)),
      y: Math.max(0, caretRect.top - rootRect.top),
      height: Math.max(16, caretRect.height || lineHeight),
      rejected: false,
    }
  }
  const cache = ensureLayoutCache()
  if (!cache) return { offset: lastCaretOffset, x: 0, y: 0, height: 18 }
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
    x: Math.max(0, Math.min(cache.editorRect.width - 2, best.x - cache.editorRect.left)),
    y: Math.max(0, best.y - cache.editorRect.top),
    height: best.height,
    rejected: blankLine,
  }
}

function pointerInside(detail) {
  // editorRoot 还包含拖放状态栏；只有可编辑文本区域才有可解释的字符边界。
  const rect = editorRef.value?.getBoundingClientRect()
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
  // 释放位置才是最终意图，不能复用上一帧 pointermove 的陈旧落点。
  const point = pointerInside(detail) ? textareaPointFromEvent(detail) : null
  dragging.value = false
  dropCaret.value.visible = false
  clearLayoutCache()
  if (point && !point.rejected && detail.asset?.id) insertAsset(detail.asset, { offset: point.offset })
}

function onAssetPointerCancel() {
  dragging.value = false
  dropCaret.value.visible = false
  clearLayoutCache()
}

function onDrop(e) {
  dragging.value = false
  // 同样以原生 drop 事件的最终坐标为准，避免拖放最后一小段移动未触发
  // dragover 时仍使用旧落点。
  const point = textareaPointFromEvent(e)
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
  if (asset && !point?.rejected && (asset.id != null || asset.entity)) insertAsset(asset, { offset: point.offset })
}
</script>
<style scoped>
.editor { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 188px; }
.prompt-rich-editor { flex:1; min-height:160px; overflow-y: auto; overscroll-behavior-y: contain; scrollbar-gutter: stable; padding:10px 12px; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-raised); color:var(--text-primary); font:inherit; line-height:1.65; white-space:pre-wrap; overflow-wrap:anywhere; outline:none; }
.prompt-rich-editor:empty::before { content:attr(data-placeholder); color:var(--text-muted); pointer-events:none; }
.prompt-rich-editor:focus-visible { border-color:var(--studio-teal,var(--accent)); box-shadow:0 0 0 2px color-mix(in srgb,var(--studio-teal,var(--accent)) 32%,transparent); }
/* 拖入时只显示自定义落点光标，避免与 contenteditable 的原生光标重叠。 */
.editor.dragging .prompt-rich-editor { caret-color:transparent; }
:deep(.prompt-asset-chip) { display:inline-flex; vertical-align:baseline; align-items:center; gap:4px; max-width:156px; margin:0 1px; padding:2px 5px 2px 2px; border:1px solid #54ead4; border-radius:5px; background:color-mix(in srgb,#54ead4 12%,var(--bg-raised)); color:var(--text-primary); line-height:1; user-select:all; }
:deep(.prompt-asset-chip img),:deep(.prompt-asset-chip>span) { width:30px; height:30px; flex:none; border-radius:4px; object-fit:cover; background:var(--bg-hover); }
:deep(.prompt-asset-chip>span) { display:grid; place-items:center; font-size:10px; }
:deep(.prompt-asset-chip b) { overflow:hidden; font-size:11px; font-weight:650; text-overflow:ellipsis; white-space:nowrap; }
.drop-status {
  flex: 0 0 26px; min-width: 0; display: flex; align-items: center; justify-content: flex-end;
  padding: 0 4px; color: var(--text-muted); font-size: 12px; line-height: 1; pointer-events: none;
}
.drop-status.active { color: var(--accent); font-weight: 600; }
.drop-caret { position: absolute; width: 3px; min-height: 16px; border-radius: 3px; background: var(--accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--bg-page) 70%, transparent), 0 0 12px var(--accent); pointer-events: none; z-index: 6; animation: drop-caret-pulse .8s ease-in-out infinite alternate; }
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
