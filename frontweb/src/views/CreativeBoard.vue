<template>
  <div class="creative-board">
    <header class="board-header">
      <button type="button" class="back-button" @click="router.push('/')">← 项目工作台</button>
      <div class="board-title"><h1>{{ board?.name || '纯画布' }}</h1><span>{{ saveLabel }}</span></div>
      <div class="header-actions"><AccountBalanceBadge /></div>
    </header>
    <main ref="stageRef" class="canvas-stage" @dragover.prevent="onDragOver" @drop.prevent="dropStage" @click="onStageClick">
      <VueFlow :id="FLOW_ID" v-if="board" v-model:nodes="flowNodes" v-model:edges="flowEdges" :node-types="nodeTypes" :connection-radius="30" :fit-view-on-init="flowNodes.length > 0" :min-zoom="0.15" :max-zoom="2" :pan-on-drag="true" :delete-key-code="null" class="flow" @node-click="onNodeClick" @node-drag-stop="onNodeDragStop" @selection-change="onSelection" @connect="onConnect" @connect-start="onConnectStart" @connect-end="onConnectEnd" @edge-click="onEdgeClick">
        <Background pattern-color="#334155" :gap="20" /><Controls />
      </VueFlow>
      <div v-if="board && !flowNodes.length" class="canvas-empty"><b>从一个节点开始</b><span>自由放置素材与生成节点。右侧输出连接下一节点的输入。</span><el-button @click="startCompose('image')">＋ 图片生成节点</el-button></div>
      <div class="canvas-dock" role="toolbar" aria-label="画布操作">
        <div class="dock-group">
          <el-tooltip content="素材与历史" placement="top"><el-button link aria-label="素材与历史" @click="showLibrary = !showLibrary"><el-icon :size="18"><Files /></el-icon></el-button></el-tooltip>
          <el-tooltip content="上传素材" placement="top"><el-button link aria-label="上传素材" @click="uploadRef?.pick()"><el-icon :size="18"><Upload /></el-icon></el-button></el-tooltip>
          <el-tooltip content="文本节点：未连接是备注，连接后作为提示词输入" placement="top"><el-button link aria-label="新建文本节点" @click="startText()"><el-icon :size="18"><Memo /></el-icon></el-button></el-tooltip>
          <el-tooltip content="图片生成节点" placement="top"><el-button link aria-label="新建图片生成节点" @click="startCompose('image')"><el-icon :size="18"><Picture /></el-icon></el-button></el-tooltip>
          <el-tooltip content="视频生成节点" placement="top"><el-button link aria-label="新建视频生成节点" @click="startCompose('video')"><el-icon :size="18"><VideoCamera /></el-icon></el-button></el-tooltip>
          <el-tooltip content="合并导出" placement="top"><el-button link aria-label="合并导出" @click="placeDeliveryNode"><el-icon :size="18"><Film /></el-icon></el-button></el-tooltip>
        </div>
        <div class="dock-group">
          <el-tooltip content="整理连线布局" placement="top"><el-button link :disabled="!flowNodes.length" aria-label="整理连线布局" @click="autoLayout"><el-icon :size="18"><Grid /></el-icon></el-button></el-tooltip>
          <el-tooltip content="撤销 (Ctrl+Z)" placement="top"><el-button link :disabled="!historyFlags.undo" aria-label="撤销" @click="undo()"><el-icon :size="18"><RefreshLeft /></el-icon></el-button></el-tooltip>
          <el-tooltip content="重做 (Ctrl+Shift+Z)" placement="top"><el-button link :disabled="!historyFlags.redo" aria-label="重做" @click="redo()"><el-icon :size="18"><RefreshRight /></el-icon></el-button></el-tooltip>
          <el-tooltip content="移出画布 (Del)" placement="top"><el-button link class="dock-danger" :disabled="!selectedNodeIds.length && !selectedEdgeId" aria-label="移出画布" @click="removeSelected"><el-icon :size="18"><Delete /></el-icon></el-button></el-tooltip>
        </div>
      </div>
      <CreativeBoardUpload ref="uploadRef" @uploaded="pinMedia" />
    </main>
    <!-- modal-penetrable keeps Element Plus's full-viewport wrapper transparent to pointer
         events (only .el-drawer gets them back), otherwise it swallows canvas drops, panning
         and the blank click that closes this drawer. Requires :modal="false". -->
    <el-drawer v-model="showLibrary" title="素材与历史" direction="ltr" size="min(340px, 92vw)" :modal="false" modal-penetrable>
      <aside class="library-panel">
        <div class="library-tabs"><button v-for="tab in tabs" :key="tab.key" :class="{ active: activeTab === tab.key }" @click="activeTab = tab.key; page = 1; loadLibrary()">{{ tab.label }}</button></div>
        <el-input v-model="keyword" placeholder="搜索素材" clearable @keyup.enter="page = 1; loadLibrary()" @clear="page = 1; loadLibrary()" />
        <p class="panel-hint">拖到画布或点击加入。生成的历史版本也在这里，不会自动铺满画布。</p>
        <div v-loading="libraryLoading" class="library-items">
          <button v-for="item in libraryItems" :key="`${activeTab}-${item.id}`" type="button" draggable="true" @dragstart="dragLibrary($event, item)" @click="pinMedia(item)">
            <span class="item-thumb"><img v-if="item.type === 'image' && item.url" :src="item.url" alt="" draggable="false" /><video v-else-if="item.type === 'video' && item.url" :src="item.url" muted preload="metadata" draggable="false" /><i v-else>▧</i></span>
            <span class="item-copy"><b>{{ item.name }}</b><small>{{ item.status }} · #{{ item.id }}</small></span>
          </button><p v-if="!libraryLoading && !libraryItems.length" class="panel-hint">暂无匹配记录</p>
        </div>
        <div class="page-row"><el-button size="small" :disabled="page <= 1" @click="page--; loadLibrary()">上一页</el-button><span>{{ page }} / {{ Math.max(1, Math.ceil(total / 20)) }}</span><el-button size="small" :disabled="page * 20 >= total" @click="page++; loadLibrary()">下一页</el-button></div>
      </aside>
    </el-drawer>
    <CreativeDeliveryDrawer v-model:show="showDelivery" :delivery-ids="deliveryIds" :subtitles="subtitles" :bgm-asset-id="bgmAssetId" :delivery-items="deliveryItems" :bgm-assets="bgmAssets" :delivery-duration-ms="deliveryDurationMs" :can-submit="canSubmitDelivery" :submitting="deliverySubmitting" :video-name="videoName" @update:bgm-asset-id="bgmAssetId = $event" @submit="submitDelivery" @restore="restoreDelivery" />
    <el-dialog v-model="usageDialog.visible" title="选择参考用途" width="min(360px, 92vw)">
      <p class="panel-hint">运行时读取上游最新完成的版本。上游未完成时不会提交或扣费。</p>
      <el-radio-group v-model="usageDialog.usage" class="usage-options"><el-radio v-for="option in usageDialog.options" :key="option.value" :value="option.value">{{ option.label }}</el-radio></el-radio-group>
      <template #footer><el-button @click="usageDialog.visible = false">取消</el-button><el-button type="primary" @click="confirmUsageEdge">确认连线</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, markRaw, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import AccountBalanceBadge from '@/components/AccountBalanceBadge.vue'
import { Delete, Files, Film, Grid, Memo, Picture, RefreshLeft, RefreshRight, Upload, VideoCamera } from '@element-plus/icons-vue'
import CreativeMediaNode from '@/components/creativeBoard/CreativeMediaNode.vue'
import CreativeDraftNode from '@/components/creativeBoard/CreativeDraftNode.vue'
import CreativeDeliveryNode from '@/components/creativeBoard/CreativeDeliveryNode.vue'
import CreativeTextNode from '@/components/creativeBoard/CreativeTextNode.vue'
import CreativeDeliveryDrawer from '@/components/creativeBoard/CreativeDeliveryDrawer.vue'
import CreativeBoardUpload from '@/components/creativeBoard/CreativeBoardUpload.vue'
import { creativeBoardAPI } from '@/api/creativeBoards'
import { omniVideoAPI } from '@/api/omniVideo'
import { imagesAPI } from '@/api/images'
import { videosAPI } from '@/api/videos'
import { accountAPI } from '@/api/account'
import { useModelOptions } from '@/composables/useModelOptions'
import { createClientRequestId } from '@/utils/requestId'
import { generationVersions, referenceForNode, usageOptionsFor, draftSnapshot, textInputsFor, composePrompt, nodeLabel, pasteNodes, videoSettingsFor } from '@/utils/creativeBoardWorkflow'
import { createHistory, editSnapshot, readStoredHistory, writeStoredHistory, clearStoredHistory } from '@/utils/creativeBoardHistory'
import { currentDraftUserId } from '@/utils/promptDraft'
import request from '@/utils/request'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

const route = useRoute(), router = useRouter(), boardId = Number(route.params.id)
// The store must be shared with the rendered canvas, so both sides pin the same id.
// A bare useVueFlow() here resolves to a store of its own: coordinate conversion and
// fitView/setCenter would then silently drive a canvas that is not on screen.
const FLOW_ID = 'creative-board'
const { screenToFlowCoordinate, fitView, setCenter } = useVueFlow(FLOW_ID)
const nodeTypes = { media: markRaw(CreativeMediaNode), draft: markRaw(CreativeDraftNode), delivery: markRaw(CreativeDeliveryNode), text: markRaw(CreativeTextNode) }
const LIBRARY_MIME = 'application/x-creative-board'
const tabs = [{ key: 'assets', label: '素材库' }, { key: 'images', label: '图片记录' }, { key: 'videos', label: '视频历史' }]
const board = ref(null), flowNodes = ref([]), flowEdges = ref([]), saveState = ref('saved'), saveBlocked = ref(false)
const showLibrary = ref(false), activeTab = ref('assets'), keyword = ref(''), page = ref(1), total = ref(0), libraryRows = ref([]), libraryLoading = ref(false), bgmAssets = ref([])
const imageModels = useModelOptions('image'), capabilities = ref([])
const selectedNodeIds = ref([]), selectedEdgeId = ref(''), connectSourceId = ref('')
const showDelivery = ref(false), deliveryIds = ref([]), subtitles = ref([]), bgmAssetId = ref(null), deliveryItems = ref([]), deliverySubmitting = ref(false), deliveryRequestId = ref('')
const uploadRef = ref(null), stageRef = ref(null)
const usageDialog = ref({ visible: false, sourceId: '', targetId: '', usage: 'reference', options: [] })
let saveTimer = null, refreshTimer = null, savePromise = null, dirtyVersion = 0, savedVersion = 0, refreshing = false, disposed = false
const history = createHistory(), historyFlags = ref({ undo: false, redo: false })
const historyKey = `lmd_board_history:v1:${currentDraftUserId()}:${boardId}`
let lastCommitted = null, historyTimer = null
const saveLabel = computed(() => saveBlocked.value ? '保存冲突，请刷新' : ({ saving: '保存中…', error: '保存失败', saved: '已保存' }[saveState.value]))
const libraryItems = computed(() => libraryRows.value.map((row) => mediaData(activeTab.value === 'assets' ? 'asset' : activeTab.value === 'images' ? 'image_generation' : 'video_generation', row)))
const deliveryDurationMs = computed(() => deliveryIds.value.reduce((sum, id) => sum + Number(videoRecord(id)?.duration_ms || 0), 0))
const canSubmitDelivery = computed(() => deliveryIds.value.length > 0 && deliveryDurationMs.value > 0 && subtitles.value.every((line) => !line.text.trim() || (Number.isFinite(line.start) && Number.isFinite(line.end) && line.start >= 0 && line.end > line.start && line.end * 1000 <= deliveryDurationMs.value)))
function isDraft(node) { return ['draft_image', 'draft_video'].includes(node?.kind) }
function edgeLabel(usage) { return ({ reference: '参考', first_frame: '首帧', last_frame: '尾帧', continuation: '续接' }[usage] || '') }
function nodeType(node) { return isDraft(node) ? node.data.draftType : node?.data.type }
function mediaData(sourceType, row) {
  return { ...row, source_type: sourceType, type: sourceType === 'asset' ? row.type : sourceType === 'image_generation' ? 'image' : 'video', name: row.name || row.prompt || `${sourceType === 'image_generation' ? '图片' : '视频'} #${row.id}`, url: row.local_path ? `/static/${String(row.local_path).replace(/^\/+/, '')}` : null, status: row.status || row.processing_status || 'ready', duration_ms: row.output_duration_ms || (row.duration ? Number(row.duration) * 1000 : null) }
}
function nextFreePosition() {
  const rect = stageRef.value?.getBoundingClientRect()
  const origin = rect ? screenToFlowCoordinate({ x: rect.left + rect.width / 2 - 140, y: rect.top + 120 }) : { x: 100, y: 100 }
  // ponytail: bounded linear placement; manual dragging remains the fallback on crowded canvases.
  for (let i = 0; i < 100; i++) {
    const position = { x: origin.x + (i % 5) * 360, y: origin.y + Math.floor(i / 5) * 380 }
    if (!flowNodes.value.some((node) => Math.abs(node.position.x - position.x) < 300 && Math.abs(node.position.y - position.y) < 320)) return position
  }
  return origin
}
function attachActions(node) {
  Object.assign(node.data, { onChange: touchEdit, onRun: submitGeneration, onReference: createFromReference, onDelivery: addToDelivery, onCancel: cancelVideo, onRemoveInput: removeInput, onRunDelivery: submitDelivery, onOpenDelivery: openDeliveryDrawer })
  return node
}
function updateNodeState(value) {
  for (const node of flowNodes.value) {
    if (isDraft(node)) {
      const versions = generationVersions(value, node.id, node.data.draftType).map((row) => mediaData(node.data.draftType === 'image' ? 'image_generation' : 'video_generation', row))
      Object.assign(node.data, { latest: versions.at(-1) || null, output: versions.findLast((row) => row.status === 'completed' && row.local_path) || null, versionCount: versions.length, imageModels: imageModels.value, capabilities: capabilities.value })
    } else if (node.type === 'media' && value.media[node.id]) Object.assign(node.data, value.media[node.id])
  }
  syncInputs()
  syncDeliveryNodeStatus()
}
function syncInputs() {
  for (const node of flowNodes.value.filter(isDraft)) {
    node.data.inputs = flowEdges.value.filter((edge) => edge.target === node.id).map((edge) => {
      const source = flowNodes.value.find((item) => item.id === edge.source)
      return { id: edge.id, name: nodeLabel(source), usage: edgeLabel(edge.usage), ready: edge.usage === 'prompt' ? !!String(source?.data.text || '').trim() : !!referenceForNode(source) }
    })
    node.data.upstreamText = textInputsFor(node.id, flowEdges.value, flowNodes.value)
    node.data.effectivePrompt = composePrompt(node.data.prompt, node.data.upstreamText)
  }
  for (const node of flowNodes.value.filter((item) => item.kind === 'text')) node.data.linked = flowEdges.value.some((edge) => edge.source === node.id)
}
async function loadBoard() {
  const value = await creativeBoardAPI.get(boardId)
  board.value = value
  flowNodes.value = value.graph.nodes.map((entry) => {
    const base = { id: entry.id, position: { x: entry.x, y: entry.y }, kind: entry.kind, source_type: entry.source_type, source_id: entry.source_id }
    if (isDraft(entry)) return attachActions({ ...base, type: 'draft', data: { prompt: '', model: '', duration: 15, resolution: '720p', upscale1080: false, aspectRatio: '16:9', ...draftSnapshot(entry.draft || {}), title: entry.name || '', draftType: entry.kind === 'draft_image' ? 'image' : 'video', submitting: false } })
    if (entry.kind === 'text') return attachActions({ ...base, type: 'text', data: { title: entry.name || '', text: entry.text || '', linked: false } })
    if (entry.kind === 'delivery') return attachActions({ ...base, type: 'delivery', data: { delivery_id: entry.delivery_id ?? null, delivery: null, title: entry.name || '', name: '合并导出' } })
    return attachActions({ ...base, type: 'media', data: { ...(value.media[entry.id] || { missing: true, name: '媒体不可用' }), source_type: entry.source_type, title: entry.name || '' } })
  })
  flowEdges.value = value.graph.edges.map((edge) => ({ ...edge, label: edgeLabel(edge.usage) }))
  updateNodeState(value)
}
// Undo/redo and paste both rebuild nodes from a snapshot entry, so the mapping lives once.
// Runtime state is never part of an entry: a restored or pasted draft starts with no version.
function nodeFromSnapshot(entry, liveData) {
  const base = { id: entry.id, position: { x: entry.x, y: entry.y }, kind: entry.kind, source_type: entry.source_type, source_id: entry.source_id }
  if (entry.kind === 'text') return attachActions({ ...base, type: 'text', data: { title: entry.name || '', text: entry.text || '', linked: false } })
  if (entry.kind === 'delivery') return attachActions({ ...base, type: 'delivery', data: { ...(liveData || { delivery_id: null, delivery: null }), title: entry.name || '', name: '合并导出' } })
  if (isDraft(entry)) return attachActions({ ...base, type: 'draft', data: { prompt: '', model: '', duration: 15, resolution: '720p', upscale1080: false, aspectRatio: '16:9', ...(entry.draft || {}), title: entry.name || '', draftType: entry.kind === 'draft_image' ? 'image' : 'video', submitting: false, inputs: [], versionCount: 0, imageModels: imageModels.value, capabilities: capabilities.value } })
  return attachActions({ ...base, type: 'media', data: { ...(liveData || board.value?.media?.[entry.id] || { missing: true, name: '媒体不可用' }), source_type: entry.source_type, title: entry.name || '' } })
}
function restoreEdit(snapshot) {
  const previous = new Map(flowNodes.value.map((node) => [node.id, node]))
  flowNodes.value = snapshot.nodes.map((entry) => nodeFromSnapshot(entry, previous.get(entry.id)?.data))
  flowEdges.value = snapshot.edges.map((edge) => ({ ...edge, label: edgeLabel(edge.usage) }))
  selectedNodeIds.value = []; selectedEdgeId.value = ''
  lastCommitted = snapshot
  updateNodeState(board.value)
  persistHistory(); syncHistoryFlags(); scheduleSave()
}
// A pending or in-flight request is not in the history, so replaying an edit over it could
// change the frozen inputs of a paid submission. Refuse instead.
function historyAllowed() {
  if (saveBlocked.value) { ElMessage.info('画布存在保存冲突，请刷新后再试'); return false }
  if (flowNodes.value.some((node) => node.data?.submitting || node.data?.pendingRequest)) { ElMessage.info('有生成请求待确认，暂不能撤销、重做或粘贴'); return false }
  return true
}
function applyHistory(direction) {
  if (!board.value || !historyAllowed()) return
  flushHistory()
  const target = direction === 'undo' ? history.undo(currentEdit()) : history.redo(currentEdit())
  if (!target) return
  restoreEdit(target)
}
function undo() { applyHistory('undo') }
function redo() { applyHistory('redo') }
function clearSelection() {
  for (const node of flowNodes.value) node.selected = false
  selectedNodeIds.value = []; selectedEdgeId.value = ''
}
function selectAllNodes() {
  if (!flowNodes.value.length) return
  for (const node of flowNodes.value) node.selected = true
  selectedNodeIds.value = flowNodes.value.map((node) => node.id); selectedEdgeId.value = ''
}
// A media card's identity is its library row and the canvas allows a single delivery node,
// so neither survives being re-identified on paste; only generated content is copyable.
const PASTABLE_KINDS = new Set(['text', 'draft_image', 'draft_video'])
const PASTE_OFFSET = 36
let clipboard = null
function selectionSnapshot() {
  const ids = new Set(selectedNodeIds.value)
  const nodes = flowNodes.value.filter((node) => ids.has(node.id) && PASTABLE_KINDS.has(node.kind))
  if (!nodes.length) return null
  return editSnapshot(nodes, flowEdges.value.filter((edge) => ids.has(edge.source) && ids.has(edge.target)))
}
function copySelection(announce = true) {
  const snapshot = selectionSnapshot()
  if (!snapshot) { ElMessage.info('选中生成节点或文本节点后才能复制'); return false }
  clipboard = snapshot
  if (announce) ElMessage.success(`已复制 ${snapshot.nodes.length} 个节点`)
  return true
}
function pasteClipboard() {
  if (!board.value || !clipboard?.nodes.length) return
  if (!historyAllowed()) return
  // Paste on top of an earlier paste would hide the new nodes behind the old ones.
  const offset = flowNodes.value.some((live) => clipboard.nodes.some((node) => live.position.x === node.x + PASTE_OFFSET && live.position.y === node.y + PASTE_OFFSET)) ? PASTE_OFFSET * 2 : PASTE_OFFSET
  const { nodes: pasted, edges: pastedEdges } = pasteNodes(clipboard, createClientRequestId, offset)
  clearSelection()
  for (const entry of pasted) flowNodes.value.push(nodeFromSnapshot(entry))
  for (const edge of pastedEdges) flowEdges.value.push({ ...edge, label: edgeLabel(edge.usage) })
  const pastedIds = new Set(pasted.map((node) => node.id))
  for (const node of flowNodes.value) node.selected = pastedIds.has(node.id)
  selectedNodeIds.value = [...pastedIds]
  updateNodeState(board.value)
  commitEdit(); scheduleSave()
  ElMessage.success(`已粘贴 ${pasted.length} 个节点`)
}
function duplicateSelection() { if (copySelection(false)) pasteClipboard() }
function onKeydown(event) {
  // Fields keep their native behaviour, so copy/paste and Backspace still edit text in place.
  if (event.target?.closest?.('input, textarea, select, [contenteditable="true"], .el-overlay, .el-dialog, .el-drawer')) return
  const key = String(event.key || '').toLowerCase()
  if (key === 'escape') {
    if (showDelivery.value || usageDialog.value.visible) return
    if (showLibrary.value) showLibrary.value = false; else clearSelection()
    return
  }
  if (event.ctrlKey || event.metaKey) {
    if (event.altKey) return
    if (key === 'z' && !event.shiftKey) { event.preventDefault(); undo() }
    else if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); redo() }
    else if (key === 'c') { event.preventDefault(); copySelection() }
    else if (key === 'v') { event.preventDefault(); pasteClipboard() }
    else if (key === 'd') { event.preventDefault(); duplicateSelection() }
    else if (key === 'a') { event.preventDefault(); selectAllNodes() }
    return
  }
  if ((key === 'delete' || key === 'backspace') && !event.altKey) { event.preventDefault(); removeSelected() }
}
async function loadLibrary() {
  libraryLoading.value = true
  try {
    const params = { page: page.value, page_size: 20, keyword: keyword.value || undefined }
    const result = activeTab.value === 'assets' ? await omniVideoAPI.assets({ ...params, scope: 'all' }) : activeTab.value === 'images' ? await imagesAPI.list(params) : await videosAPI.list(params)
    libraryRows.value = result.items || []; total.value = result.pagination?.total ?? result.total ?? 0
  } catch (error) { ElMessage.error(error.message || '历史记录加载失败') } finally { libraryLoading.value = false }
}
function dragLibrary(event, item) { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData(LIBRARY_MIME, JSON.stringify(item)) }
function onDragOver(event) {
  const types = Array.from(event.dataTransfer?.types || [])
  if (event.dataTransfer) event.dataTransfer.dropEffect = types.includes(LIBRARY_MIME) || types.includes('Files') ? 'copy' : 'none'
}
function dropStage(event) {
  const position = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  const types = Array.from(event.dataTransfer?.types || [])
  if (types.includes('Files')) { uploadRef.value?.handleFiles(Array.from(event.dataTransfer.files || []), position); return }
  if (!types.includes(LIBRARY_MIME)) { ElMessage.info('无法识别拖入的内容，请从素材库拖动卡片'); return }
  let item = null
  try { item = JSON.parse(event.dataTransfer.getData(LIBRARY_MIME)) } catch (_) { item = null }
  if (!item || !['asset', 'image_generation', 'video_generation'].includes(item.source_type) || !Number.isFinite(Number(item.id))) { ElMessage.info('拖入的卡片数据无效，请从素材库重新拖动'); return }
  pinMedia(item, position)
}
// The library drawer has no modal overlay, so it needs an explicit way out. Only a click
// on the canvas itself counts: the dock sits inside the stage, and closing on its clicks
// would shut the drawer the instant it was opened.
function onStageClick(event) {
  const target = event.target
  if (!showLibrary.value || !target?.closest?.('.vue-flow__pane') || target.closest('.vue-flow__node')) return
  showLibrary.value = false
}
function focusNode(node) {
  selectedNodeIds.value = [node.id]; selectedEdgeId.value = ''
  setCenter(node.position.x + 110, node.position.y + 80, { zoom: 1, duration: 300 })
}
function pinMedia(item, position = null) {
  if (!board.value) return
  const id = `${item.source_type}:${item.id}`
  const existing = flowNodes.value.find((node) => node.id === id)
  if (existing) { focusNode(existing); ElMessage.info('这张卡片已在画布中，已为你定位'); return }
  flowNodes.value.push(attachActions({ id, type: 'media', position: position || nextFreePosition(), source_type: item.source_type, source_id: item.id, data: { ...item } }))
  commitEdit(); scheduleSave()
}
function startText() {
  if (!board.value) return
  const node = attachActions({ id: `text:${createClientRequestId()}`, type: 'text', kind: 'text', position: nextFreePosition(), selected: true, data: { title: '', text: '', linked: false } })
  for (const old of flowNodes.value) old.selected = false
  flowNodes.value.push(node); selectedNodeIds.value = [node.id]
  commitEdit(); scheduleSave(); return node
}
function placeDeliveryNode() {
  if (!board.value) return
  if (flowNodes.value.some((node) => node.kind === 'delivery')) { showDelivery.value = true; return }
  flowNodes.value.push(attachActions({ id: `delivery:${createClientRequestId()}`, type: 'delivery', kind: 'delivery', position: nextFreePosition(), data: { delivery_id: null, delivery: null, title: '', name: '合并导出' } }))
  commitEdit(); scheduleSave()
}
function graphSnapshot() {
  return { nodes: flowNodes.value.map((node) => {
    const out = { id: node.id, x: node.position.x, y: node.position.y }
    if (node.data.title) out.name = node.data.title
    if (isDraft(node)) { out.kind = node.kind; out.draft = draftSnapshot(node.data) }
    else if (node.kind === 'text') { out.kind = 'text'; out.text = node.data.text || '' }
    else if (node.kind === 'delivery') { out.kind = 'delivery'; out.delivery_id = node.data.delivery_id }
    else { out.source_type = node.source_type; out.source_id = node.source_id }
    return out
  }), edges: flowEdges.value.map(({ id, source, target, usage }) => ({ id, source, target, usage })) }
}
// History records the graph as it stood before each edit, so the entry pushed is always
// lastCommitted and never depends on whether the caller reports before or after mutating.
function currentEdit() { return editSnapshot(flowNodes.value, flowEdges.value) }
function syncHistoryFlags() { historyFlags.value = { undo: history.size.past > 0, redo: history.size.future > 0 } }
function persistHistory() { writeStoredHistory(sessionStorage, historyKey, JSON.stringify(lastCommitted), history.dump()) }
function flushHistory() {
  clearTimeout(historyTimer)
  if (!lastCommitted) return
  const now = currentEdit()
  if (JSON.stringify(now) === JSON.stringify(lastCommitted)) return
  history.record(lastCommitted); lastCommitted = now
  persistHistory(); syncHistoryFlags()
}
function commitEdit() { flushHistory() }
// Typing and select changes coalesce into one history entry instead of one per keystroke.
function scheduleHistory() { clearTimeout(historyTimer); historyTimer = setTimeout(flushHistory, 500) }
function touchEdit() { scheduleSave(); scheduleHistory() }
function onNodeDragStop() { commitEdit(); scheduleSave() }
function scheduleSave() {
  dirtyVersion++; syncInputs()
  if (saveBlocked.value) return
  saveState.value = 'saving'; clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { saveBoard().catch(() => {}) }, 700)
}
async function saveBoard() {
  clearTimeout(saveTimer)
  if (saveBlocked.value || !board.value) throw new Error('画布尚未保存或有冲突，请刷新')
  if (savePromise) { await savePromise; return saveBoard() }
  if (savedVersion === dirtyVersion) return
  const version = dirtyVersion
  savePromise = creativeBoardAPI.update(boardId, { revision: board.value.revision, graph: graphSnapshot() })
  try { board.value = await savePromise; savedVersion = version; saveState.value = 'saved' }
  catch (error) {
    saveState.value = 'error'
    if ((error.response?.status || error.status) === 409) saveBlocked.value = true
    ElMessage.error(saveBlocked.value ? '画布在另一页面更新，请刷新后重新操作' : error.message || '画布保存失败')
    throw error
  } finally { savePromise = null }
  if (dirtyVersion !== savedVersion) return saveBoard()
}
function onSelection(event) { selectedNodeIds.value = (event.nodes || []).map((node) => node.id); selectedEdgeId.value = '' }
function onNodeClick({ node }) { selectedNodeIds.value = [node.id]; selectedEdgeId.value = ''; if (node.kind === 'delivery') showDelivery.value = true }
function onEdgeClick({ edge }) { selectedEdgeId.value = edge.id; selectedNodeIds.value = [] }
function onConnectStart(event) { connectSourceId.value = event.handleType === 'source' ? event.nodeId : '' }
function onConnect({ source, target }) {
  connectSourceId.value = ''
  const sourceNode = flowNodes.value.find((node) => node.id === source), targetNode = flowNodes.value.find((node) => node.id === target)
  if (!sourceNode || !targetNode || source === target) return
  if (!isDraft(targetNode)) { ElMessage.info(sourceNode.kind === 'text' ? '文本只能连接到生成节点的输入端口' : '请连接到生成节点的左侧输入端口'); return }
  if (sourceNode.kind === 'text') { addEdge(source, target, 'prompt'); return }
  openUsageDialog(sourceNode, targetNode)
}
function onConnectEnd(event) {
  const sourceId = connectSourceId.value; connectSourceId.value = ''
  const point = event?.changedTouches?.[0] || event
  if (!sourceId || point?.clientX == null) return
  const element = document.elementFromPoint(point.clientX, point.clientY)
  if (!element?.closest('.vue-flow__pane')) return
  const source = flowNodes.value.find((node) => node.id === sourceId)
  if (source) createDraftNode(nodeType(source) === 'video' ? 'video' : 'image', screenToFlowCoordinate({ x: point.clientX, y: point.clientY }), source)
}
function defaultUsageFor(source) {
  if (source?.kind === 'text') return 'prompt'
  return nodeType(source) === 'video' ? 'continuation' : 'reference'
}
function openUsageDialog(source, target) {
  const options = usageOptionsFor(nodeType(source), target.kind)
  if (!options.length) { ElMessage.info('该素材类型不能作为此节点的输入'); return }
  if (target.data.pendingRequest || target.data.submitting) { ElMessage.info('请先确认当前生成请求的结果'); return }
  usageDialog.value = { visible: true, sourceId: source.id, targetId: target.id, usage: options[0].value, options }
}
function addEdge(sourceId, targetId, usage) {
  if (flowEdges.value.some((edge) => edge.source === sourceId && edge.target === targetId)) return
  flowEdges.value.push({ id: `edge:${createClientRequestId()}`, source: sourceId, target: targetId, usage, label: edgeLabel(usage) })
  commitEdit(); scheduleSave()
}
function confirmUsageEdge() { const { sourceId, targetId, usage } = usageDialog.value; usageDialog.value.visible = false; addEdge(sourceId, targetId, usage) }
function createDraftNode(draftType, position, source = null) {
  const node = attachActions({ id: `draft:${createClientRequestId()}`, type: 'draft', kind: draftType === 'image' ? 'draft_image' : 'draft_video', position, selected: true, data: { draftType, prompt: '', model: draftType === 'image' ? imageModels.value[0] || '' : capabilities.value[0]?.model || '', duration: 15, resolution: '720p', upscale1080: false, aspectRatio: '16:9', submitting: false, inputs: [], versionCount: 0, imageModels: imageModels.value, capabilities: capabilities.value } })
  for (const old of flowNodes.value) old.selected = false
  flowNodes.value.push(node); selectedNodeIds.value = [node.id]
  // Creating a node and its incoming edge is one edit, so undo removes both together.
  if (source) addEdge(source.id, node.id, defaultUsageFor(source))
  else commitEdit()
  scheduleSave(); return node
}
function startCompose(kind) { if (board.value) createDraftNode(kind, nextFreePosition()) }
function createFromReference(id, kind) {
  const source = flowNodes.value.find((node) => node.id === id)
  if (!source || !usageOptionsFor(nodeType(source), kind === 'image' ? 'draft_image' : 'draft_video').length) return
  createDraftNode(kind, { x: source.position.x + 400, y: source.position.y + 40 }, source)
}
function removeInput(id) {
  const edge = flowEdges.value.find((item) => item.id === id)
  const target = flowNodes.value.find((node) => node.id === edge?.target)
  if (target?.data.pendingRequest || target?.data.submitting) { ElMessage.info('请先确认当前生成请求的结果'); return }
  flowEdges.value = flowEdges.value.filter((item) => item.id !== id); commitEdit(); scheduleSave()
}
async function materializeAsset(reference) {
  if (reference.source_type === 'asset') return reference.source_id
  const imported = await request.post(reference.source_type === 'image_generation' ? `/assets/import/image/${reference.source_id}` : `/assets/import/video/${reference.source_id}`)
  return imported.id
}
async function submitGeneration(id) {
  const node = flowNodes.value.find((item) => item.id === id)
  if (!node || !isDraft(node) || node.data.submitting || saveBlocked.value) return
  const data = node.data
  if (!data.pendingRequest && (!data.effectivePrompt || !data.model)) return
  data.submitting = true; data.submitError = ''
  let attempted = false
  try {
    if (!data.pendingRequest) {
      // Text inputs are prompt text, never references; freezing the composed value into the
      // request keeps a retry identical even if the upstream text changes afterwards.
      const prompt = composePrompt(data.prompt, textInputsFor(id, flowEdges.value, flowNodes.value))
      if (prompt.length > 10000) throw new Error('组合后的提示词超过 10000 字，请精简文本节点')
      const references = flowEdges.value.filter((edge) => edge.target === id && edge.usage !== 'prompt').map((edge) => {
        const source = flowNodes.value.find((item) => item.id === edge.source), reference = referenceForNode(source)
        if (!reference) throw new Error('有上游节点尚无已完成的本地产物，请先运行上游')
        if (!usageOptionsFor(reference.type, node.kind).some((option) => option.value === edge.usage)) throw new Error('参考类型或用途不适用于当前节点')
        return { ...reference, usage: edge.usage }
      })
      const body = { source_context: 'creative_board', board_id: boardId, draft_node_id: id, idempotency_key: createClientRequestId(), prompt, model: data.model, aspect_ratio: data.aspectRatio }
      if (data.draftType === 'image') {
        body.reference_sources = references.map(({ source_type, source_id }) => ({ source_type, source_id }))
        const quote = await accountAPI.quoteResourceImages({ model: data.model, count: 1, image_input_count: references.length ? 1 : 0, reference_images: references.map((item) => item.local_path) })
        await ElMessageBox.confirm(`本次图片生成预计冻结 ${quote.amount} 积分，继续提交？`, '图片生成费用', { confirmButtonText: '提交生成', cancelButtonText: '取消' })
      } else {
        const capability = capabilities.value.find((item) => item.model === data.model)
        if (references.filter((item) => item.type === 'image').length > Number(capability?.supports?.image_reference?.max || 0)) throw new Error('参考图数量超过模型上限')
        if (references.some((item) => item.type === 'video') && !capability?.supports?.video_reference) throw new Error('该模型不支持视频参考')
        const assets = []
        for (const [index, reference] of references.entries()) assets.push({ asset_id: await materializeAsset(reference), usage: reference.usage === 'continuation' ? 'motion' : reference.usage, role: 'reference', ordinal: index + 1, type: reference.type, alias: reference.name })
        const firstLast = assets.length && assets.every((item) => ['first_frame', 'last_frame'].includes(item.usage)) && assets.some((item) => item.usage === 'first_frame')
        const settings = videoSettingsFor(data)
        Object.assign(body, { duration: data.duration, resolution: data.resolution, upscale_resolution: settings.upscale_resolution, target_fps: settings.target_fps, creation_mode: firstLast ? 'first_last_frame' : 'multi_reference', audio_strategy: 'reference_only', assets })
        const quote = await omniVideoAPI.quoteBilling({ source_context: 'creative_board', board_id: boardId, model: data.model, duration: data.duration, resolution: data.resolution, has_video_input: references.some((item) => item.type === 'video'), has_audio: false })
        const postprocess = body.upscale_resolution || body.target_fps ? await videosAPI.postprocessQuote({ resolution: data.resolution, upscale_resolution: body.upscale_resolution, target_fps: body.target_fps, source_fps: 30, duration: data.duration, aspect_ratio: data.aspectRatio }) : null
        await ElMessageBox.confirm(`本次视频生成预计冻结 ${quote.amount} 积分。${postprocess ? `超分／插帧另预计 ${postprocess.estimated_total_points} 积分，完成后按实际规格结算。` : ''}继续提交？`, '视频生成费用', { confirmButtonText: '提交生成', cancelButtonText: '取消' })
      }
      data.pendingRequest = body
    }
    scheduleSave(); await saveBoard()
    attempted = true
    const created = data.draftType === 'image' ? await imagesAPI.create(data.pendingRequest) : await omniVideoAPI.create(data.pendingRequest)
    const row = { id: data.draftType === 'image' ? created.id : created.video_generation_id, status: created.status, draft_node_id: id }
    const key = data.draftType === 'image' ? 'generated_images' : 'generated_videos'
    board.value[key] = [...board.value[key].filter((item) => item.id !== row.id), row]
    data.pendingRequest = null
    updateNodeState(board.value); scheduleSave()
    ElMessage.success('生成任务已提交，结果将在此节点中更新')
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    const status = error.response?.status || error.status
    if (attempted && status >= 400 && status < 500 && ![408, 409, 429].includes(status)) { data.pendingRequest = null; scheduleSave() }
    data.submitError = error.message || '生成提交失败'
    ElMessage.error(data.submitError)
  } finally { data.submitting = false }
}
function removeSelected() {
  if (!selectedNodeIds.value.length && !selectedEdgeId.value) return
  const ids = new Set(selectedNodeIds.value)
  if (flowNodes.value.some((node) => (ids.has(node.id) || flowEdges.value.some((edge) => ids.has(edge.source) && edge.target === node.id)) && (node.data.submitting || node.data.pendingRequest))) { ElMessage.info('请先确认生成请求，再移除节点'); return }
  if (selectedEdgeId.value) removeInput(selectedEdgeId.value)
  flowNodes.value = flowNodes.value.filter((node) => !ids.has(node.id))
  flowEdges.value = flowEdges.value.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target))
  selectedNodeIds.value = []; selectedEdgeId.value = ''; commitEdit(); scheduleSave()
}
async function cancelVideo(id) {
  const node = flowNodes.value.find((item) => item.id === id), videoId = isDraft(node) ? node.data.latest?.id : node?.source_id
  try {
    const detail = await omniVideoAPI.historyDetail(videoId)
    if (!detail.omni_job_id) throw new Error('该任务不支持取消')
    await omniVideoAPI.cancel(detail.omni_job_id); await refresh(); ElMessage.success('取消请求已提交')
  } catch (error) { ElMessage.error(error.message || '取消失败') }
}
function addToDelivery(id) {
  const reference = referenceForNode(flowNodes.value.find((node) => node.id === id))
  if (reference?.source_type !== 'video_generation') return
  if (!deliveryIds.value.includes(reference.source_id)) deliveryIds.value.push(reference.source_id)
  showDelivery.value = true
}
function videoRecord(id) { return board.value?.generated_videos?.find((row) => Number(row.id) === id) ? mediaData('video_generation', board.value.generated_videos.find((row) => Number(row.id) === id)) : flowNodes.value.find((node) => node.source_type === 'video_generation' && Number(node.source_id) === id)?.data }
function videoName(id) { return videoRecord(id)?.name || `视频 #${id}` }
function restoreDelivery(item) { deliveryIds.value = [...item.input.video_generation_ids]; subtitles.value = (item.input.subtitles || []).map((line) => ({ start: line.start_ms / 1000, end: line.end_ms / 1000, text: line.text })); bgmAssetId.value = item.input.bgm?.asset_id || null }
async function loadDeliveries() { try { deliveryItems.value = await creativeBoardAPI.deliveries(boardId); syncDeliveryNodeStatus() } catch (_) {} }
function openDeliveryDrawer() { showDelivery.value = true }
function syncDeliveryNodeStatus() {
  const node = flowNodes.value.find((item) => item.kind === 'delivery')
  if (!node) return
  node.data.delivery = node.data.delivery_id ? deliveryItems.value.find((item) => String(item.id) === node.data.delivery_id) || null : deliveryItems.value[0] || null
  node.data.clipCount = deliveryIds.value.length
  node.data.clipSeconds = Math.round(deliveryDurationMs.value / 1000)
  node.data.canSubmit = canSubmitDelivery.value
}
async function submitDelivery() {
  deliverySubmitting.value = true
  const node = flowNodes.value.find((item) => item.kind === 'delivery')
  if (node) node.data.submitting = true
  try {
    const key = deliveryRequestId.value || createClientRequestId(); deliveryRequestId.value = key
    const created = await creativeBoardAPI.createDelivery(boardId, { idempotency_key: key, video_generation_ids: deliveryIds.value, subtitles: subtitles.value.filter((line) => line.text.trim()).map((line) => ({ start_ms: Math.round(line.start * 1000), end_ms: Math.round(line.end * 1000), text: line.text })), bgm_asset_id: bgmAssetId.value || null })
    deliveryRequestId.value = ''; await loadDeliveries()
    const recordId = created?.id ?? deliveryItems.value[0]?.id
    if (node && recordId) { node.data.delivery_id = String(recordId); scheduleSave() }
    syncDeliveryNodeStatus(); ElMessage.success('合并导出任务已提交')
  } catch (error) { ElMessage.error(error.message || '合并导出失败') } finally { deliverySubmitting.value = false; if (node) node.data.submitting = false }
}
function autoLayout() {
  const nodes = flowNodes.value, adj = new Map(nodes.map((node) => [node.id, []])), indeg = new Map(nodes.map((node) => [node.id, 0])), layer = new Map(nodes.map((node) => [node.id, 0]))
  for (const edge of flowEdges.value) { if (!adj.has(edge.source) || !adj.has(edge.target)) continue; adj.get(edge.source).push(edge.target); indeg.set(edge.target, indeg.get(edge.target) + 1) }
  const queue = nodes.filter((node) => !indeg.get(node.id)).map((node) => node.id)
  while (queue.length) { const id = queue.shift(); for (const target of adj.get(id)) { layer.set(target, Math.max(layer.get(target), layer.get(id) + 1)); indeg.set(target, indeg.get(target) - 1); if (!indeg.get(target)) queue.push(target) } }
  const counts = new Map()
  for (const node of nodes) { const level = layer.get(node.id); const row = counts.get(level) || 0; node.position = { x: 80 + level * 400, y: 100 + row * 760 }; counts.set(level, row + 1) }
  commitEdit(); scheduleSave(); fitView({ padding: 0.15 })
}
async function refresh() {
  if (refreshing || saveBlocked.value || savePromise || !board.value) return
  refreshing = true
  const revision = board.value.revision
  try {
    const value = await creativeBoardAPI.get(boardId)
    if (disposed || savePromise || board.value.revision !== revision) return
    if (value.revision !== revision) { saveBlocked.value = true; ElMessage.warning('画布已在其他页面修改，请刷新后继续'); return }
    board.value.generated_images = value.generated_images; board.value.generated_videos = value.generated_videos
    updateNodeState(value)
    if (showDelivery.value || flowNodes.value.some((node) => node.kind === 'delivery')) await loadDeliveries()
  } catch (_) {} finally { refreshing = false }
}
watch(showLibrary, (open) => { if (open) loadLibrary() })
watch(showDelivery, async (open) => { if (open) { await loadDeliveries(); try { bgmAssets.value = (await omniVideoAPI.assets({ scope: 'all', type: 'audio', page: 1, page_size: 100 })).items || [] } catch (_) {} } })
watch([deliveryIds, subtitles, bgmAssetId], () => { deliveryRequestId.value = ''; syncDeliveryNodeStatus() }, { deep: true })
watch(imageModels, () => { if (board.value) updateNodeState(board.value) })
onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  try {
    capabilities.value = await omniVideoAPI.capabilities(); await loadBoard(); await loadDeliveries()
    // Restored history is only trusted when it was recorded against this exact graph.
    lastCommitted = currentEdit()
    const stored = readStoredHistory(sessionStorage, historyKey, JSON.stringify(lastCommitted))
    if (stored) history.restore(stored); else clearStoredHistory(sessionStorage, historyKey)
    syncHistoryFlags()
    refreshTimer = setInterval(refresh, 6000)
  } catch (error) { ElMessage.error(error.message || '画布加载失败') }
})
onBeforeUnmount(() => {
  disposed = true; window.removeEventListener('keydown', onKeydown)
  clearTimeout(saveTimer); clearTimeout(historyTimer); clearInterval(refreshTimer)
  if (dirtyVersion !== savedVersion && !saveBlocked.value) saveBoard().catch(() => {})
})
</script>

<style scoped>
.creative-board{min-height:100dvh;background:#0a0d13;color:#edf2f9}.board-header{display:flex;align-items:center;flex-wrap:wrap;gap:1rem;min-height:64px;padding:.7rem 1.2rem;border-bottom:1px solid #263346;background:#101721;box-sizing:border-box}.back-button{border:0;background:transparent;color:#a5b8ce;cursor:pointer}.board-title{display:flex;align-items:baseline;gap:.8rem;min-width:0}.board-title h1{overflow:hidden;max-width:40vw;margin:0;text-overflow:ellipsis;white-space:nowrap;font-size:1.05rem}.board-title span{white-space:nowrap;color:#8296ac;font-size:.72rem}.header-actions{display:flex;align-items:center;flex-wrap:wrap;gap:.6rem;margin-left:auto}.canvas-stage{position:relative;min-width:0;height:calc(100dvh - 80px);min-height:500px;background:#080c12}.flow{width:100%;height:100%}.canvas-empty{position:absolute;top:38%;left:50%;z-index:2;display:grid;justify-items:center;gap:.7rem;width:min(90%,320px);color:#94a9c1;text-align:center;transform:translate(-50%,-50%);pointer-events:none}.canvas-empty b{color:#f3f6fb}.canvas-empty :deep(button){pointer-events:auto}.canvas-dock{position:absolute;bottom:14px;left:50%;z-index:3;display:flex;align-items:center;gap:10px;max-width:calc(100% - 24px);padding:7px 10px;border:1px solid #2b3a50;border-radius:14px;background:#111925e6;box-shadow:0 10px 30px #0006;transform:translateX(-50%)}
.dock-group{display:flex;gap:5px;min-width:0;overflow-x:auto;pointer-events:auto}
.dock-group+.dock-group{padding-left:10px;border-left:1px solid #2b3a50}
.canvas-dock :deep(.el-button){width:30px;height:30px;padding:0;border:0;background:transparent;color:#c3d0e2}
.canvas-dock :deep(.el-button+.el-button){margin-left:0}
/* Resting state is a bare icon; only hover earns a fill, so state stays readable. */
.canvas-dock :deep(.el-button:hover:not(.is-disabled)){background:#25344b;color:#fff}
.canvas-dock :deep(.el-button:focus-visible){outline:2px solid #b6c3ff;outline-offset:1px}
.canvas-dock :deep(.el-button.is-disabled){background:transparent;color:#4a5a70}
/* Destructive actions must not read as one more neutral icon. */
.canvas-dock :deep(.dock-danger:not(.is-disabled)){color:#e79a9a}
.canvas-dock :deep(.dock-danger:hover:not(.is-disabled)){background:#4b2129;color:#ffb3b3}
.canvas-stage :deep(.vue-flow__handle){width:14px;height:14px;border:2px solid #7f8ea6;background:#1b2a3d}
/* Keep the grab area well past the visible dot without changing the layout box. */
.canvas-stage :deep(.vue-flow__handle)::after{content:'';position:absolute;inset:-9px;border-radius:50%}
.canvas-stage :deep(.vue-flow__handle:hover){border-color:#b6c3ff;background:#4d5fd6}
.canvas-stage :deep(.vue-flow__handle.vue-flow__handle-left){left:-8px}.canvas-stage :deep(.vue-flow__handle.vue-flow__handle-right){right:-8px}.canvas-stage :deep(.vue-flow__edge-path){stroke:#73829a;stroke-width:1.5}.canvas-stage :deep(.vue-flow__edge.selected .vue-flow__edge-path){stroke:#b6c3ff;stroke-width:3}.canvas-stage :deep(.vue-flow__edge-text){fill:#cbd5e1;font-size:11px}.canvas-stage :deep(.vue-flow__edge-textbg){fill:#172231}.canvas-stage :deep(.vue-flow__controls){border-radius:9px;overflow:hidden}.library-panel{min-width:0}.library-tabs{display:flex;gap:4px;margin-bottom:.8rem}.library-tabs button{flex:1;padding:8px 4px;border:1px solid #334357;border-radius:7px;background:#1b2735;color:#bac9d8;cursor:pointer}.library-tabs button.active{border-color:#819bff;color:#fff}.panel-hint{color:#8fa1b5;font-size:.75rem;line-height:1.55}.library-items{display:grid;align-content:start;gap:6px;min-height:140px}.library-items button{display:flex;gap:9px;width:100%;padding:5px;border:1px solid #29394d;border-radius:8px;background:#172231;color:#eaf0f7;text-align:left;cursor:grab}.item-thumb{display:grid;place-content:center;flex:0 0 64px;height:52px;overflow:hidden;border-radius:5px;background:#0b111a}.item-thumb img,.item-thumb video{width:100%;height:100%;object-fit:cover}.item-copy{display:grid;align-content:center;min-width:0}.item-copy b,.item-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.item-copy b{font-size:.75rem}.item-copy small{color:#90a4b8;font-size:.65rem}.page-row{display:flex;align-items:center;justify-content:space-between;gap:4px;margin-top:1rem}.usage-options{display:flex;flex-direction:column;align-items:flex-start;gap:.5rem}@media(max-width:700px){.board-header{padding:1rem}.header-actions{margin-left:0}.board-title h1{max-width:65vw}.canvas-stage :deep(.vue-flow__controls){margin-bottom:52px}}
</style>
