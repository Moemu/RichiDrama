<template>
  <main class="media-tool" :class="`is-${media}`">
    <a class="skip-link" href="#media-tool-input">跳到创作输入</a>
    <header class="tool-topbar">
      <div class="tool-topbar-inner">
        <router-link class="brand" to="/film" aria-label="返回项目列表">
          <span class="brand-mark"><img src="/brand/richi-logo-color.png" alt="" /></span>
          <span class="brand-copy"><b>瑞池传媒短剧平台</b><small>创作工作台</small></span>
        </router-link>
        <span class="breadcrumb-sep">›</span>
        <span class="page-title">{{ media === 'image' ? '单图生成' : '单视频生成' }}</span>
        <div class="topbar-actions"><router-link to="/ai-tools">返回 AI 工具箱</router-link><AccountBalanceBadge /></div>
      </div>
    </header>

    <div class="tool-content">
      <section class="workflow-banner" aria-labelledby="tool-title">
        <div><span>AI 单项工具</span><h1 id="tool-title">{{ media === 'image' ? '生成单张图片' : '直接生成单个视频' }}</h1><p>{{ media === 'image' ? '输入提示词并选择素材，完成一张图片。' : '无需新建项目。输入长提示词，引用已有素材，然后生成成片。' }}</p></div>
        <ul v-if="media === 'video'" aria-label="工作流特点"><li>无需项目</li><li>支持 @ 素材</li><li>支持拖入素材</li></ul>
      </section>

      <section id="media-tool-input" class="control-panel" aria-label="创作输入与生成设置">
        <section v-if="media === 'image'" class="input-section project-section">
          <div class="section-heading"><div><h2>选择项目</h2><p>项目只用于图片计费和素材归属。</p></div></div>
          <label class="field-label">计费归属项目
            <el-select v-model="dramaId" filterable placeholder="选择项目后读取项目素材" aria-label="计费归属项目">
              <el-option v-for="project in projects" :key="project.id" :label="project.title" :value="project.id" />
            </el-select>
          </label>
          <p class="project-note" :class="{ ready: dramaId }"><span aria-hidden="true">{{ dramaId ? '✓' : '!' }}</span>{{ dramaId ? '上传的新素材会进入当前项目素材库。' : '先选择项目，才能提交生成任务。' }}</p>
        </section>

        <div class="setup-grid">
        <section class="input-section mode-section">
          <div class="section-heading"><div><h2>生成方式</h2><p>选择与素材输入匹配的模式。</p></div></div>
          <div class="mode-grid" role="radiogroup" aria-label="创作模式">
            <button v-for="item in modes" :key="item.value" type="button" role="radio" :aria-checked="String(mode === item.value)" :class="{ active: mode === item.value }" :disabled="!modeAvailable(item.value)" @click="selectMode(item.value)">
              <b>{{ item.label }}</b><small>{{ modeAvailable(item.value) ? item.hint : '当前模型不支持' }}</small>
            </button>
          </div>
        </section>

        <section v-if="media === 'video' || !['text', 'batch'].includes(mode)" class="input-section asset-section">
          <div class="section-heading"><div><h2>素材库</h2><p>{{ media === 'video' ? '点击选用素材，或把素材卡拖到下方提示词中的准确位置。' : selectedMode.rule }}</p></div></div>
          <template v-if="mode === 'first_last'">
            <div class="frame-selectors">
              <ToolAssetSelector v-model="firstFrameAssetId" :drama-id="media === 'image' ? Number(dramaId) || null : null" :types="['image']" :prompt-draggable="media === 'video'" label="首帧（必选）" @selected="applyFirstFrame" @assets-loaded="mergeLibraryAssets" />
              <ToolAssetSelector v-model="lastFrameAssetId" :drama-id="media === 'image' ? Number(dramaId) || null : null" :types="['image']" :prompt-draggable="media === 'video'" label="尾帧（可选）" @selected="applyLastFrame" @assets-loaded="mergeLibraryAssets" />
            </div>
          </template>
          <ToolAssetSelector v-else-if="mode === 'image'" v-model="selectedAssetId" :drama-id="media === 'image' ? Number(dramaId) || null : null" :types="['image']" :prompt-draggable="media === 'video'" label="起始参考图" @selected="applySelectedAsset" @assets-loaded="mergeLibraryAssets" />
          <ToolAssetSelector v-else v-model="selectedAssetIds" multiple :max-selections="assetLimit" :drama-id="media === 'image' ? Number(dramaId) || null : null" :types="media === 'image' ? ['image'] : ['image', 'video', 'audio']" :prompt-draggable="media === 'video'" :label="mode === 'text' ? '可选素材（选用后自动切换多参考）' : '参考素材'" @selection-change="applyMultiAssets" @assets-loaded="mergeLibraryAssets" />
          <details class="external-reference">
            <summary>使用公开素材链接</summary>
            <label class="field-label">公开链接
              <el-input v-model="reference" type="url" inputmode="url" name="public_reference_url" autocomplete="off" :placeholder="mode === 'first_last' ? '首帧 URL, 尾帧 URL' : '多个链接用英文逗号分隔…'" />
            </label>
          </details>
        </section>
        </div>

        <section class="input-section prompt-section">
          <div class="section-heading"><div><h2>{{ media === 'image' ? '图片提示词' : '视频提示词' }}</h2><p>{{ media === 'video' ? '支持上千字内容。输入 @ 选择素材，也可从上方直接拖入。' : '描述主体、构图和画面风格。' }}</p></div></div>
          <OmniAssetPromptEditor v-if="media === 'video'" ref="promptEditorRef" v-model="prompt" :assets="libraryAssets" :chosen-ids="chosenAssetIds" :reference-document="promptDocument" placeholder="描述视频内容；输入 @ 引用素材，或把上方素材卡拖入此处" @pick="onPromptAssetPick" @references="setPromptReferences" />
          <el-input v-else v-model="prompt" type="textarea" :autosize="{ minRows: 12, maxRows: 24 }" name="generation_prompt" autocomplete="off" placeholder="描述主体、构图和画面风格…" />
        </section>
      </section>

      <section class="output-grid" aria-label="生成规格与结果预览">
        <section class="spec-panel">
          <div class="input-section settings-section">
          <div class="section-heading"><div><h2>生成规格</h2><p>模型会限制可用时长、分辨率和素材类型。</p></div></div>
          <label v-if="media === 'image'" class="field-label">模型
            <el-select v-model="model" clearable placeholder="使用当前默认模型"><el-option v-for="item in imageModelOptions" :key="item" :label="item" :value="item" /></el-select>
          </label>
          <GenerationSettings v-else v-model="videoSettings" :max-duration="15" />
          </div>

          <footer class="submit-bar">
            <p :class="{ ready: canSubmit }" role="status" aria-live="polite"><span aria-hidden="true">{{ canSubmit ? '✓' : '•' }}</span>{{ submitHint }}</p>
            <el-button type="primary" size="large" :loading="running" :disabled="!canSubmit" @click="submit">{{ running ? '正在提交…' : `生成${media === 'image' ? '图片' : '视频'}` }}</el-button>
          </footer>
        </section>

        <section class="preview-stage">
          <div class="stage-heading">
            <div><p>结果预览</p><h2>{{ featured ? `生成记录 #${displayId(featured)}` : '等待首次生成' }}</h2></div>
            <span class="status-pill" :class="featured?.status || 'draft'" role="status" aria-live="polite">{{ featured ? statusText(featured.status) : '尚未生成' }}</span>
          </div>
          <div v-if="featured" class="featured">
            <img v-if="media === 'image' && featured.image_url" :src="featured.image_url" :alt="featured.prompt || '生成图片'" width="1280" height="720" />
            <video v-else-if="media === 'video' && (featured.local_path || featured.video_url)" :src="mediaUrl(featured)" controls playsinline />
            <div v-else class="empty-result"><GenerationFailureDetails v-if="featured.status === 'failed'" :job="featured" /><template v-else><span class="processing-mark" aria-hidden="true">{{ activeStatuses.has(featured.status) ? '◌' : '▶' }}</span><b>{{ statusText(featured.status) }}</b><small>{{ featured.task_message || '任务已保存，结果会自动更新。' }}</small></template></div>
            <footer><span>{{ statusText(featured.status) }}</span><b>{{ featured.prompt || '未填写提示词' }}</b><small>{{ formatDate(featured.updated_at || featured.created_at) }}</small></footer>
          </div>
          <div v-else class="empty-result"><span class="empty-play" aria-hidden="true">▶</span><b>成片会显示在这里</b><small>完成上方提示词、素材和模型设置后即可生成。</small></div>
          <div v-if="featured?.status === 'completed'" class="result-actions">
            <el-button type="primary" @click="downloadResult">下载{{ media === 'image' ? '图片' : '视频' }}</el-button>
            <el-button :loading="importing" @click="importAsset">保存到素材库</el-button>
            <el-button v-if="media === 'video'" :loading="importing" @click="continueOmni">带入多镜头创作</el-button>
          </div>
        </section>
      </section>

      <aside class="generation-history" aria-label="生成历史">
        <button type="button" class="history-toggle" :aria-expanded="String(historyExpanded)" @click="historyExpanded = !historyExpanded"><span>最近生成 <small>{{ items.length }}</small></span><b>{{ historyExpanded ? '收起' : '展开' }}</b></button>
        <div v-if="historyExpanded && items.length" class="history-list">
          <button v-for="item in items" :key="historyKey(item)" type="button" class="history-card" :class="{ active: historyKey(featured) === historyKey(item) }" @click="featured = item">
            <span class="history-preview"><img v-if="media === 'image' && item.image_url" :src="item.image_url" alt="" width="144" height="90" loading="lazy" /><video v-else-if="media === 'video' && (item.local_path || item.video_url)" :src="mediaUrl(item)" muted preload="metadata" /><span v-else aria-hidden="true">●</span></span>
            <span class="history-copy"><b>{{ statusText(item.status) }} · #{{ displayId(item) }}</b><small>{{ item.prompt || '未命名生成' }}</small><em>{{ formatDate(item.updated_at || item.created_at) }}</em></span>
          </button>
        </div>
        <p v-else-if="historyExpanded" class="history-empty">还没有生成记录。首次提交后，任务会保存在这里。</p>
      </aside>
    </div>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'
import { imagesAPI } from '@/api/images'
import { dramaAPI } from '@/api/drama'
import { omniVideoAPI } from '@/api/omniVideo'
import { videosAPI } from '@/api/videos'
import ToolAssetSelector from '@/components/ToolAssetSelector.vue'
import OmniAssetPromptEditor from '@/components/OmniAssetPromptEditor.vue'
import GenerationSettings from '@/components/GenerationSettings.vue'
import AccountBalanceBadge from '@/components/AccountBalanceBadge.vue'
import GenerationFailureDetails from '@/components/GenerationFailureDetails.vue'
import { formatChinaDateTime } from '@/utils/time'
import { useModelOptions } from '@/composables/useModelOptions'

const props = defineProps({ media: { type: String, required: true } })
const router = useRouter()
const prompt = ref(''), promptDocument = ref({ text: '', refs: [], unresolved: [] }), promptEditorRef = ref(null), libraryAssets = ref([]), model = ref(''), reference = ref(''), selectedAssetId = ref(null), selectedAsset = ref(null), selectedAssetIds = ref([]), selectedAssets = ref([]), firstFrameAssetId = ref(null), lastFrameAssetId = ref(null), firstFrameAsset = ref(null), lastFrameAsset = ref(null)
const videoSettings = ref({ video_model: '', duration: 15, resolution: '720p', aspect_ratio: '16:9', upscale_resolution: null, target_fps: null })
const running = ref(false), importing = ref(false), historyLoading = ref(false), historyExpanded = ref(false), items = ref([]), mode = ref('text'), featured = ref(null), projects = ref([]), capabilities = ref([]), dramaId = ref(null)
const imageModelOptions = useModelOptions('image')
const activeStatuses = new Set(['pending', 'processing', 'sd2_waiting', 'upscale_pending', 'upscaling', 'interpolation_pending', 'interpolating', 'persisting', 'billing_reconciliation'])
let pollTimer = null

const modes = computed(() => props.media === 'image' ? [
  { label: '文生图', value: 'text', hint: '只使用提示词', rule: '不需要参考素材。' },
  { label: '单图参考', value: 'image', hint: '保持主体或构图', rule: '选择一张项目图片。' },
  { label: '多图参考', value: 'multi', hint: '融合多个元素', rule: '可选择多张项目图片。' },
  { label: '组生组图', value: 'batch', hint: '共享风格批量出图', rule: '只使用提示词创建。' },
] : [
  { label: '文生视频', value: 'text', hint: '只使用提示词', rule: '不需要参考素材。' },
  { label: '图生视频', value: 'image', hint: '从一张图片起镜', rule: '选择一张图片作为起始参考。' },
  { label: '首尾帧', value: 'first_last', hint: '控制起点与终点', rule: '首帧必选，尾帧可选。' },
  { label: '多参考', value: 'multi', hint: '组合图片、视频、音频', rule: '可选择账号下的项目素材和个人素材。' },
])
const selectedMode = computed(() => modes.value.find((item) => item.value === mode.value) || modes.value[0])
const currentCapability = computed(() => capabilities.value.find((item) => item.model === videoSettings.value.video_model) || null)
const assetLimit = computed(() => props.media === 'image' ? 9 : Number(currentCapability.value?.limits?.total_reference?.max || 15))
const chosenAssetIds = computed(() => new Set([selectedAssetId.value, firstFrameAssetId.value, lastFrameAssetId.value, ...selectedAssetIds.value].filter((id) => Number(id) > 0).map(Number)))
const externalRefs = computed(() => reference.value.split(',').map((item) => item.trim()).filter(Boolean))
const hasRequiredAssets = computed(() => {
  if (mode.value === 'text' || mode.value === 'batch') return true
  if (mode.value === 'image') return !!selectedAsset.value || externalRefs.value.length > 0
  if (mode.value === 'first_last') return !!firstFrameAsset.value || externalRefs.value.length > 0
  return selectedAssets.value.length > 0 || externalRefs.value.length > 0
})
const hasModel = computed(() => props.media === 'image' || (!!videoSettings.value.video_model && videoSettings.value.video_model !== 'auto'))
const canSubmit = computed(() => !!prompt.value.trim() && (props.media === 'video' || Number(dramaId.value) > 0) && hasRequiredAssets.value && hasModel.value && modeAvailable(mode.value) && !running.value)
const submitHint = computed(() => {
  if (props.media === 'image' && !Number(dramaId.value)) return '请选择计费归属项目'
  if (!prompt.value.trim()) return `请填写${props.media === 'image' ? '图片' : '视频'}提示词`
  if (!hasRequiredAssets.value) return selectedMode.value.rule
  if (!hasModel.value) return '请选择可用的视频模型'
  if (!modeAvailable(mode.value)) return '当前模型不支持首尾帧模式，请切换模型或模式'
  return `已就绪 · ${['text', 'batch'].includes(mode.value) ? '不发送参考素材' : `${requestAssets().length} 项参考素材`}`
})
const statusText = (status) => ({ pending: '排队中', processing: '生成中', sd2_waiting: '素材准备中', upscale_pending: '等待超分', upscaling: '超分中', interpolation_pending: '等待插帧', interpolating: '插帧中', persisting: '保存成片', billing_reconciliation: '等待对账', completed: '已完成', failed: '生成失败', retryable: '可重试' }[status] || status || '草稿')
const mediaUrl = (item) => item?.local_path ? `/static/${String(item.local_path).replace(/^\/+/, '')}` : item?.video_url || ''
const assetUrl = (asset) => asset?.local_path || asset?.url || ''
const applySelectedAsset = (asset) => { selectedAsset.value = asset || null }
const applyMultiAssets = (assets) => { selectedAssets.value = assets || []; if (props.media === 'video' && selectedAssets.value.length && mode.value === 'text') mode.value = 'multi' }
const applyFirstFrame = (asset) => { firstFrameAsset.value = asset || null }
const applyLastFrame = (asset) => { lastFrameAsset.value = asset || null }
const formatDate = (value) => formatChinaDateTime(value)
const historyKey = (item) => item ? `${item.history_kind || props.media}:${item.id}` : ''
const displayId = (item) => item?.video_generation_id || item?.id || ''

function mergeLibraryAssets(assets) {
  const merged = new Map(libraryAssets.value.map((asset) => [Number(asset.id), asset]))
  for (const asset of assets || []) if (Number(asset?.id) > 0) merged.set(Number(asset.id), asset)
  libraryAssets.value = [...merged.values()]
}
function includePromptAsset(asset) {
  if (!asset || Number(asset.id) <= 0) return
  const id = Number(asset.id)
  if (!selectedAssetIds.value.map(Number).includes(id)) selectedAssetIds.value = [...selectedAssetIds.value, id]
  if (!selectedAssets.value.some((item) => Number(item.id) === id)) selectedAssets.value = [...selectedAssets.value, asset]
  if (props.media === 'video') mode.value = 'multi'
}
function onPromptAssetPick(asset) { includePromptAsset(asset) }
function setPromptReferences(documentValue) {
  promptDocument.value = documentValue || { text: prompt.value, refs: [], unresolved: [] }
  for (const entry of promptDocument.value.refs || []) includePromptAsset(libraryAssets.value.find((asset) => Number(asset.id) === Number(entry.asset_id)))
}
function selectMode(value) {
  if (value === mode.value) return
  clearReferences()
  mode.value = value
}

function requestAssets() {
  const fromAsset = (asset, usage, index) => ({ asset_id: asset.id, alias: asset.reference_alias || asset.alias || asset.name || `素材${index + 1}`, type: asset.type, usage, role: usage === 'primary' ? 'primary' : 'reference', ordinal: index + 1 })
  if (mode.value === 'text' || mode.value === 'batch') return []
  if (mode.value === 'image') {
    const assets = selectedAsset.value ? [fromAsset(selectedAsset.value, 'primary', 0)] : []
    return [...assets, ...externalRefs.value.slice(0, 1).map((url, index) => ({ url, type: 'image', alias: `外部参考图${index + 1}`, usage: 'primary', role: 'primary', ordinal: assets.length + index + 1 }))]
  }
  if (mode.value === 'first_last') {
    const assets = []
    if (firstFrameAsset.value) assets.push(fromAsset(firstFrameAsset.value, 'first_frame', assets.length))
    else if (externalRefs.value[0]) assets.push({ url: externalRefs.value[0], type: 'image', alias: '外部首帧', usage: 'first_frame', role: 'reference', ordinal: 1 })
    if (lastFrameAsset.value) assets.push(fromAsset(lastFrameAsset.value, 'last_frame', assets.length))
    else if (externalRefs.value[1]) assets.push({ url: externalRefs.value[1], type: 'image', alias: '外部尾帧', usage: 'last_frame', role: 'reference', ordinal: assets.length + 1 })
    return assets
  }
  const assets = selectedAssets.value.map((asset, index) => fromAsset(asset, asset.type === 'video' ? 'motion' : asset.type === 'audio' ? 'ambience' : 'reference', index))
  return [...assets, ...externalRefs.value.map((url, index) => ({ url, type: 'image', alias: `外部参考图${index + 1}`, usage: 'reference', role: 'reference', ordinal: assets.length + index + 1 }))]
}
function modeAvailable(value) { return props.media === 'image' || value !== 'first_last' || !currentCapability.value || !!currentCapability.value.supports?.first_last_frame }
function clearPoll() { window.clearTimeout(pollTimer); pollTimer = null }
function schedulePoll() {
  clearPoll()
  if (props.media === 'video' && items.value.some((item) => activeStatuses.has(item.status))) pollTimer = window.setTimeout(() => load(true), 4000)
}
async function load(silent = false) {
  if (!silent) historyLoading.value = true
  try {
    if (props.media === 'image') {
      const out = await imagesAPI.list({ page_size: 30, drama_id: 0 })
      items.value = (out.items || out || []).slice(0, 30)
    } else {
      const [omniResult, legacyResult] = await Promise.allSettled([
        omniVideoAPI.list({ tool_only: 1 }),
        videosAPI.list({ page_size: 30, tool_only: 1 }),
      ])
      const omniItems = omniResult.status === 'fulfilled' ? (omniResult.value.items || omniResult.value || []).map((item) => ({ ...item, history_kind: 'omni' })) : []
      const omniGenerationIds = new Set(omniItems.map((item) => Number(item.video_generation_id)).filter(Boolean))
      const legacyItems = legacyResult.status === 'fulfilled' ? (legacyResult.value.items || legacyResult.value || []).filter((item) => !omniGenerationIds.has(Number(item.id))).map((item) => ({ ...item, history_kind: 'legacy', video_generation_id: item.id })) : []
      if (!omniItems.length && !legacyItems.length && omniResult.status === 'rejected' && legacyResult.status === 'rejected') throw omniResult.reason
      items.value = [...omniItems, ...legacyItems].sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)).slice(0, 30)
    }
    const selectedKey = historyKey(featured.value)
    featured.value = items.value.find((item) => historyKey(item) === selectedKey) || items.value[0] || null
  } catch (error) { if (!silent) ElMessage.error(error.message || '生成记录加载失败') }
  finally { historyLoading.value = false; schedulePoll() }
}
async function submit() {
  if (!canSubmit.value) return
  running.value = true
  try {
    if (props.media === 'image') {
      const refs = requestAssets().map((asset) => asset.asset_id ? assetUrl(selectedAssets.value.find((item) => Number(item.id) === Number(asset.asset_id)) || selectedAsset.value) : asset.url).filter(Boolean)
      await imagesAPI.create({ drama_id: Number(dramaId.value), prompt: prompt.value.trim(), model: model.value || undefined, image_url: mode.value === 'image' ? refs[0] : undefined, reference_images: mode.value === 'multi' ? refs : undefined })
    } else {
      const settings = videoSettings.value || {}
      await omniVideoAPI.create({ source_context: 'single_video_tool', prompt: prompt.value.trim(), prompt_document: promptDocument.value, asset_selection_policy: 'all_selected', creation_mode: mode.value === 'first_last' ? 'first_last_frame' : 'multi_reference', model: settings.video_model, duration: settings.duration, resolution: settings.resolution || '720p', aspect_ratio: settings.aspect_ratio || '16:9', upscale_resolution: settings.upscale_resolution || null, target_fps: settings.target_fps || null, audio_strategy: 'reference_only', assets: requestAssets() })
    }
    ElMessage.success('任务已提交，结果会自动刷新')
    await load(true)
  } catch (error) { ElMessage.error(error.message || '任务提交失败') }
  finally { running.value = false }
}
async function importAsset() {
  importing.value = true
  try {
    const generationId = props.media === 'video' ? featured.value?.video_generation_id || featured.value?.id : featured.value?.id
    const path = props.media === 'image' ? `/assets/import/image/${generationId}` : `/assets/import/video/${generationId}`
    const asset = await request.post(path)
    ElMessage.success('已保存到素材库')
    return asset
  } catch (error) { ElMessage.error(error.message || '保存素材失败'); return null }
  finally { importing.value = false }
}
async function continueOmni() { const asset = await importAsset(); if (asset?.id) router.push({ path: '/free-create', query: { asset_id: asset.id } }) }
function downloadResult() {
  const url = props.media === 'image' ? featured.value?.image_url : mediaUrl(featured.value)
  if (!url) return ElMessage.warning('当前结果没有可下载文件')
  const link = document.createElement('a')
  link.href = url
  link.download = `richidrama-${props.media}-${displayId(featured.value) || 'result'}.${props.media === 'image' ? 'png' : 'mp4'}`
  document.body.appendChild(link)
  link.click()
  link.remove()
}
function clearReferences() { selectedAssetId.value = null; selectedAsset.value = null; selectedAssetIds.value = []; selectedAssets.value = []; firstFrameAssetId.value = null; lastFrameAssetId.value = null; firstFrameAsset.value = null; lastFrameAsset.value = null; reference.value = '' }

watch(() => props.media, () => { featured.value = null; mode.value = 'text'; clearReferences(); load() })
watch(dramaId, clearReferences)
watch(() => videoSettings.value.video_model, () => { if (!modeAvailable(mode.value)) mode.value = 'multi' })
onMounted(async () => {
  const [data, modelCapabilities] = await Promise.all([props.media === 'image' ? dramaAPI.list({ page_size: 100 }) : Promise.resolve([]), props.media === 'video' ? omniVideoAPI.capabilities().catch(() => []) : Promise.resolve([])])
  projects.value = data?.items || data || []
  capabilities.value = Array.isArray(modelCapabilities) ? modelCapabilities : []
  await load()
})
onBeforeUnmount(clearPoll)
</script>

<style scoped>
.media-tool{min-height:100vh;padding:24px 30px 36px;background:var(--bg-page);background-image:radial-gradient(48% 38% at 10% -8%,color-mix(in srgb,var(--accent) 18%,transparent),transparent 72%),radial-gradient(34% 32% at 96% 8%,color-mix(in srgb,var(--accent-teal) 9%,transparent),transparent 70%);color:var(--text-primary)}.skip-link{position:fixed;top:8px;left:8px;z-index:100;transform:translateY(-150%);padding:8px 12px;border-radius:8px;background:var(--accent);color:#fff}.skip-link:focus{transform:translateY(0)}.media-header,.media-layout{width:100%;max-width:1500px;margin-inline:auto}.media-header{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:0 2px 20px;border-bottom:1px solid var(--border-subtle)}.title-wrap{display:flex;align-items:center;gap:14px;min-width:0}.title-wrap>span{display:grid;place-items:center;flex:0 0 auto;width:44px;height:44px;border-radius:13px;background:linear-gradient(145deg,var(--accent),#6f61df);box-shadow:0 10px 24px color-mix(in srgb,var(--accent) 26%,transparent);color:#fff}.title-wrap p,.stage-heading p{margin:0 0 4px;color:var(--accent);font-size:10px;font-weight:700;letter-spacing:.12em}.title-wrap h1,.stage-heading h2{margin:0;line-height:1.15;text-wrap:balance}.title-wrap h1{font-size:25px}.title-wrap small{display:block;margin-top:5px;color:var(--text-muted)}.header-actions{display:flex;align-items:center;gap:14px}.header-actions>a{color:var(--text-regular);text-decoration:none}.header-actions>a:hover{color:var(--text-primary)}.header-actions>a:focus-visible{outline:2px solid var(--accent);outline-offset:4px;border-radius:4px}.media-layout{display:grid;grid-template-columns:minmax(380px,430px) minmax(0,1fr);gap:18px;align-items:start;margin-top:18px}.control-panel,.preview-stage,.generation-history{min-width:0;border:1px solid var(--border-subtle);border-radius:16px;background:color-mix(in srgb,var(--bg-surface) 95%,transparent);box-shadow:var(--shadow-sm)}.control-panel{display:grid;gap:0;overflow:hidden}.input-section{display:grid;gap:13px;padding:18px;border-bottom:1px solid var(--border-subtle)}.section-heading{display:flex;align-items:flex-start;gap:10px}.section-heading>span{display:grid;place-items:center;flex:0 0 auto;width:26px;height:26px;border-radius:7px;background:color-mix(in srgb,var(--accent) 16%,var(--bg-elevated));color:var(--accent);font-size:10px;font-weight:700}.section-heading h2,.history-heading h2{margin:0;font-size:14px}.section-heading p,.history-heading p{margin:3px 0 0;color:var(--text-muted);font-size:11px;line-height:1.45}.field-label{display:grid;gap:7px;color:var(--text-regular);font-size:12px;font-weight:600}.project-note{display:flex;align-items:center;gap:7px;margin:0;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--status-warning,#d89b36) 10%,var(--bg-raised));color:var(--text-regular);font-size:11px}.project-note.ready{background:color-mix(in srgb,var(--status-success,#43a66f) 10%,var(--bg-raised))}.mode-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.mode-grid button{display:grid;gap:3px;min-height:58px;padding:10px;border:1px solid var(--border-subtle);border-radius:10px;background:var(--bg-raised);color:var(--text-regular);text-align:left;cursor:pointer;transition:border-color .16s ease,background-color .16s ease,transform .16s ease}.mode-grid button:hover{border-color:color-mix(in srgb,var(--accent) 55%,var(--border-color));transform:translateY(-1px)}.mode-grid button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.mode-grid button.active{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 11%,var(--bg-raised));box-shadow:inset 3px 0 0 var(--accent)}.mode-grid b{font-size:12px}.mode-grid small{color:var(--text-muted);font-size:10px;line-height:1.35}.control-panel :deep(.el-input__wrapper),.control-panel :deep(.el-select__wrapper),.control-panel :deep(.el-textarea__inner){background:color-mix(in srgb,var(--bg-page) 32%,transparent);box-shadow:0 0 0 1px var(--border-subtle) inset!important}.control-panel :deep(.el-input__wrapper:hover),.control-panel :deep(.el-select__wrapper:hover),.control-panel :deep(.el-textarea__inner:hover){box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 60%,var(--border-color)) inset!important}.frame-selectors{display:grid;gap:16px}.external-reference{border-top:1px solid var(--border-subtle);padding-top:10px}.external-reference summary{width:max-content;color:var(--text-muted);font-size:11px;cursor:pointer}.external-reference[open] summary{margin-bottom:10px;color:var(--text-regular)}.submit-bar{position:sticky;bottom:0;z-index:2;display:grid;gap:10px;padding:15px 18px;background:color-mix(in srgb,var(--bg-surface) 96%,transparent);backdrop-filter:blur(12px)}.submit-bar p{display:flex;align-items:center;gap:6px;margin:0;color:var(--text-muted);font-size:11px}.submit-bar p.ready{color:var(--status-success,#43a66f)}.submit-bar :deep(.el-button){width:100%;min-height:44px}.preview-workspace{display:grid;gap:14px;min-width:0}.preview-stage{display:flex;min-height:600px;padding:20px;flex-direction:column}.stage-heading,.history-heading{display:flex;align-items:center;justify-content:space-between;gap:14px}.stage-heading h2{font-size:21px}.status-pill{flex:0 0 auto;padding:5px 9px;border-radius:999px;background:var(--bg-elevated);color:var(--text-muted);font-size:11px}.status-pill.completed{background:color-mix(in srgb,var(--status-success,#43a66f) 14%,var(--bg-elevated));color:var(--status-success,#43a66f)}.status-pill.failed,.status-pill.retryable{background:color-mix(in srgb,var(--status-danger,#e45a67) 14%,var(--bg-elevated));color:var(--status-danger,#e45a67)}.status-pill.processing,.status-pill.sd2_waiting,.status-pill.upscaling,.status-pill.interpolating,.status-pill.persisting{background:color-mix(in srgb,var(--accent) 14%,var(--bg-elevated));color:var(--accent)}.featured,.empty-result{position:relative;display:flex;align-items:center;justify-content:center;flex:1;min-height:460px;margin-top:15px;overflow:hidden;border:1px solid var(--border-subtle);border-radius:13px;background:#080d14}.featured>img,.featured>video{width:100%;height:100%;object-fit:contain}.featured>footer{position:absolute;right:0;bottom:0;left:0;display:grid;gap:4px;padding:13px 15px;background:linear-gradient(transparent,rgba(5,9,15,.96));color:#fff}.featured>footer span{width:max-content;padding:3px 7px;border-radius:5px;background:rgba(255,255,255,.14);font-size:10px}.featured>footer b{max-width:72ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.featured>footer small{color:rgba(255,255,255,.66);font-size:10px}.empty-result{flex-direction:column;gap:9px;background:color-mix(in srgb,var(--bg-page) 55%,transparent);color:var(--text-muted);text-align:center}.empty-play,.processing-mark{color:var(--accent);font-size:44px}.empty-result b{color:var(--text-regular)}.empty-result small{max-width:48ch;line-height:1.5}.result-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.generation-history{padding:16px}.history-list{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-top:12px}.history-card{display:grid;grid-template-columns:76px minmax(0,1fr);gap:9px;min-width:0;padding:6px;border:1px solid var(--border-subtle);border-radius:10px;background:var(--bg-raised);color:var(--text-regular);text-align:left;cursor:pointer;transition:border-color .16s ease,background-color .16s ease}.history-card:hover,.history-card.active{border-color:color-mix(in srgb,var(--accent) 58%,var(--border-color));background:color-mix(in srgb,var(--accent) 7%,var(--bg-raised))}.history-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.history-preview{display:grid;place-items:center;overflow:hidden;border-radius:7px;background:var(--bg-hover);aspect-ratio:4/3;color:var(--accent)}.history-preview img,.history-preview video{width:100%;height:100%;object-fit:cover}.history-copy{display:grid;align-content:center;min-width:0}.history-copy b,.history-copy small,.history-copy em{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.history-copy b{font-size:11px}.history-copy small,.history-copy em{margin-top:3px;color:var(--text-muted);font-size:10px;font-style:normal}.history-empty{margin:12px 0 0;padding:22px;border:1px dashed var(--border-color);border-radius:10px;color:var(--text-muted);font-size:11px;text-align:center}@media(max-width:1180px){.media-layout{grid-template-columns:minmax(350px,400px) minmax(0,1fr)}.history-list{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:900px){.media-tool{padding:18px}.media-layout{grid-template-columns:1fr}.preview-workspace{grid-row:1}.control-panel{grid-row:2}.preview-stage{min-height:520px}.history-list{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.media-tool{padding:14px}.media-header{align-items:flex-start;flex-direction:column}.header-actions{width:100%;justify-content:space-between}.mode-grid,.history-list{grid-template-columns:1fr}.preview-stage{min-height:430px;padding:14px}.featured,.empty-result{min-height:330px}.title-wrap h1{font-size:22px}}
.mode-grid button:disabled{cursor:not-allowed;opacity:.48;transform:none}.mode-grid button:disabled:hover{border-color:var(--border-subtle);transform:none}
@media(prefers-reduced-motion:reduce){.mode-grid button,.history-card{transition:none}.mode-grid button:hover{transform:none}}
</style>

<style scoped>
.media-tool {
  min-height: 100vh;
  padding: 0 0 40px;
  overflow-x: clip;
  background: var(--bg-page);
  color: var(--text-primary);
}
.tool-topbar {
  width: 100%;
  border-bottom: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--bg-surface) 88%, transparent);
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(14px);
}
.tool-topbar-inner {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  padding: 12px 26px;
  gap: 12px;
}
.brand {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  color: var(--text-primary);
  text-decoration: none;
}
.brand-mark {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  overflow: hidden;
  border-radius: 10px;
}
.brand-mark img { width: 100%; height: 100%; object-fit: contain; }
.brand-copy { display: grid; min-width: 0; }
.brand-copy b { font-size: .88rem; line-height: 1.15; white-space: nowrap; }
.brand-copy small { color: var(--text-muted); font-size: .62rem; }
.breadcrumb-sep { color: var(--text-muted); }
.page-title {
  min-width: 0;
  overflow: hidden;
  padding: 7px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 9px;
  background: color-mix(in srgb, var(--bg-raised) 80%, transparent);
  color: var(--text-regular);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.topbar-actions { display: flex; align-items: center; gap: 14px; margin-left: auto; }
.topbar-actions > a { color: var(--text-regular); text-decoration: none; white-space: nowrap; }
.topbar-actions > a:hover { color: var(--text-primary); }
.tool-content {
  display: grid;
  width: min(100% - 48px, 1320px);
  margin: 22px auto 0;
  gap: 16px;
}
.workflow-banner {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  min-width: 0;
  padding: 24px 26px;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  background: linear-gradient(120deg, color-mix(in srgb, var(--accent) 14%, var(--bg-surface)), color-mix(in srgb, var(--bg-surface) 95%, transparent));
  box-shadow: var(--shadow-sm);
}
.workflow-banner > div { min-width: 0; }
.workflow-banner span { color: var(--accent); font-size: 11px; font-weight: 700; letter-spacing: .1em; }
.workflow-banner h1 { margin: 6px 0 5px; font-size: clamp(22px, 2.2vw, 31px); line-height: 1.15; }
.workflow-banner p { max-width: 72ch; margin: 0; color: var(--text-muted); line-height: 1.55; }
.workflow-banner ul { display: flex; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin: 0; padding: 0; list-style: none; }
.workflow-banner li { padding: 6px 9px; border-radius: 999px; background: var(--bg-raised); color: var(--text-regular); font-size: 11px; white-space: nowrap; }
.control-panel,
.spec-panel,
.preview-stage,
.generation-history {
  width: 100%;
  min-width: 0;
  overflow: visible;
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg-surface) 96%, transparent);
  box-shadow: var(--shadow-sm);
}
.control-panel { display: grid; }
.output-grid {
  display: grid;
  grid-template-columns: minmax(320px, .58fr) minmax(0, 1.42fr);
  gap: 16px;
  align-items: stretch;
  min-width: 0;
}
.spec-panel { display: flex; min-width: 0; flex-direction: column; }
.spec-panel .settings-section { flex: 1; border-bottom: 1px solid var(--border-subtle); }
.spec-panel :deep(.generation-settings) { grid-template-columns: minmax(0, 1fr); }
.spec-panel :deep(.ui-choice-field) { position: relative; }
.spec-panel :deep(.ui-choice-field__panel) {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  left: 0;
  z-index: 20;
  box-shadow: var(--shadow-lg);
}
.setup-grid {
  display: grid;
  grid-template-columns: minmax(360px, .8fr) minmax(0, 1.2fr);
  border-bottom: 1px solid var(--border-subtle);
}
.setup-grid > .input-section { align-content: start; border-bottom: 0; }
.setup-grid > .input-section + .input-section { border-left: 1px solid var(--border-subtle); }
.setup-grid .mode-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.setup-grid .asset-section :deep(.asset-grid) { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.input-section { display: grid; gap: 14px; padding: 22px 24px; border-bottom: 1px solid var(--border-subtle); }
.section-heading { display: block; }
.section-heading h2 { margin: 0; font-size: 16px; }
.section-heading p { margin: 4px 0 0; color: var(--text-muted); font-size: 12px; line-height: 1.5; }
.mode-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.prompt-section :deep(.editor) { height: 460px; min-height: 460px; }
.prompt-section :deep(.prompt-rich-editor) { min-height: 0; padding: 16px 18px; font-size: 14px; line-height: 1.75; }
.prompt-section :deep(.el-textarea__inner) { min-height: 320px !important; padding: 16px 18px; line-height: 1.7; }
.asset-section :deep(.asset-grid) { grid-template-columns: repeat(5, minmax(0, 1fr)); max-height: 330px; }
.frame-selectors { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.submit-bar {
  position: static;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 18px 24px;
  background: transparent;
  backdrop-filter: none;
}
.submit-bar p { margin-right: auto; }
.submit-bar :deep(.el-button) { width: auto; min-width: 190px; }
.preview-workspace { display: grid; gap: 12px; }
.preview-stage { min-height: 0; padding: 22px 24px; }
.featured,
.empty-result { min-height: 420px; }
.generation-history { padding: 0; overflow: hidden; }
.history-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 15px 18px;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}
.history-toggle:hover { background: var(--bg-hover); }
.history-toggle span { font-size: 13px; font-weight: 650; }
.history-toggle small { color: var(--text-muted); font-weight: 500; }
.history-toggle b { color: var(--accent); font-size: 12px; }
.history-list { grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0; padding: 0 16px 16px; }
.history-empty { margin: 0 16px 16px; }
@media (max-width: 900px) {
  .tool-topbar-inner { padding: 10px 16px; }
  .brand-copy { display: none; }
  .tool-content { width: min(100% - 28px, 1320px); margin-top: 14px; }
  .workflow-banner { align-items: flex-start; flex-direction: column; padding: 20px; }
  .workflow-banner ul { justify-content: flex-start; }
  .mode-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .setup-grid { grid-template-columns: 1fr; }
  .output-grid { grid-template-columns: 1fr; }
  .setup-grid > .input-section + .input-section { border-top: 1px solid var(--border-subtle); border-left: 0; }
  .asset-section :deep(.asset-grid) { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .frame-selectors { grid-template-columns: 1fr; }
  .featured, .empty-result { min-height: 340px; }
}
@media (max-width: 620px) {
  .page-title { display: none; }
  .topbar-actions { gap: 8px; }
  .input-section { padding: 18px 16px; }
  .asset-section :deep(.asset-grid), .history-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .submit-bar { align-items: stretch; flex-direction: column; padding: 16px; }
  .submit-bar :deep(.el-button) { width: 100%; }
}
</style>
