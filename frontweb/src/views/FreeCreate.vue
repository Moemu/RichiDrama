<template>
  <section class="omni-page" :class="{ 'project-storyboard-page': isProjectMode, embedded: embedded }" @wheel.capture="containEmbeddedScroll">
    <header v-if="!embedded" class="topbar">
      <div class="topbar-left">
        <el-button text @click="backToProject"><el-icon><ArrowLeft /></el-icon>返回项目</el-button>
        <span class="divider"></span><span>{{ isProjectMode ? '项目剧集：' : '剧集：' }}</span><el-input v-if="sequence" v-model="sequence.name" size="small" class="sequence-name" :readonly="isProjectMode" @change="saveCurrentShot" />
      </div>
      <div class="topbar-actions"><el-button text @click="$router.push('/media-library')">素材库</el-button><el-button text size="small" :disabled="!currentShot" @click="copyCurrentShot">复制当前镜头</el-button><el-button type="primary" plain size="small" @click="saveCurrentShot">保存整集</el-button></div>
    </header>

    <section class="workbench">
      <aside class="panel shot-panel" aria-label="镜头导航">
        <div class="shot-heading"><b>镜头列表</b><small>{{ shots.length }} 个镜头</small></div>
        <div class="shot-actions"><el-button size="small" type="primary" plain @click="addShot(false)">+ 尾部添加</el-button><el-button size="small" @click="addShot(true)">当前镜头后添加</el-button></div>
        <div class="shot-list">
          <article v-for="(shot, index) in shots" :key="shot.id" class="shot-card" :class="{ active: shot.id === activeShotId, dragging: draggedShotId === shot.id }" draggable="true" @dragstart="draggedShotId = shot.id" @dragend="draggedShotId = null" @dragover.prevent @drop="dropShot(shot.id)" @click="selectShot(shot)">
            <div class="shot-title"><span class="drag-handle">⠿</span><span class="shot-number">{{ index + 1 }}</span><b>{{ shot.title || '未命名镜头' }}</b><span class="shot-controls"><el-button text size="small" :disabled="index === 0" aria-label="上移镜头" @click.stop="moveShot(index, -1)">↑</el-button><el-button text size="small" :disabled="index === shots.length - 1" aria-label="下移镜头" @click.stop="moveShot(index, 1)">↓</el-button><el-button text size="small" aria-label="重命名镜头" @click.stop="renameShot(shot)"><el-icon><Edit /></el-icon></el-button></span><el-button class="shot-delete" type="danger" plain size="small" :disabled="shots.length <= 1" :title="shots.length <= 1 ? '至少保留一个镜头；请先新增镜头再删除当前镜头' : '删除镜头'" aria-label="删除镜头" @click.stop="removeShot(shot)"><el-icon><Delete /></el-icon><span>删除</span></el-button></div>
            <div class="shot-preview"><video v-if="shot.video_url" :src="shot.video_url" muted preload="metadata" /><img v-else-if="shotCover(shot)" :src="shotCover(shot)" /><div v-else class="shot-empty"><el-icon><VideoCamera /></el-icon></div><span>{{ shot.settings?.duration || 15 }}s</span></div>
            <div class="shot-state" :class="shot.status"><i></i>{{ shotState(shot) }}</div>
          </article>
        </div>
      </aside>

      <section class="center-stage" aria-label="当前镜头播放与时间线">
        <div class="player-tools"><el-button text size="small" @click="selectRelative(-1)">上一镜</el-button><el-button text size="small" @click="selectRelative(1)">下一镜</el-button><span></span><el-tag :type="stageTagType" effect="dark">{{ stageLabel }}</el-tag></div>
        <div class="video-stage" :class="{ rendering: activeJob?.status === 'processing' }">
          <template v-if="activeVideoUrl"><video :src="activeVideoUrl" controls autoplay class="main-video" /><div class="frame-actions"><el-button size="small" @click="downloadCurrentVideo">下载成片</el-button><template v-if="activeJob"><el-button size="small" type="primary" :disabled="savedResultJobId === activeJob.id" @click="saveResultAsAsset">{{ savedResultJobId === activeJob.id ? '已加入素材' : '作为视频素材继续创作' }}</el-button><el-button v-if="isProjectMode && savedResultJobId === activeJob.id" size="small" @click="$router.push(`/film/${projectDramaId}/canvas`)">在项目画布中打开</el-button><template v-if="canExtractFrames"><el-button size="small" :loading="extractingPosition === 'first'" :disabled="!!extractingPosition" @click="extractFrame('first')">提取首帧</el-button><el-button size="small" :loading="extractingPosition === 'last'" :disabled="!!extractingPosition" @click="extractFrame('last')">提取尾帧</el-button></template></template></div></template>
          <template v-else-if="activeJob?.status === 'processing'"><div class="render-ring ring-one"></div><div class="render-ring ring-two"></div><div class="render-play">▶</div><b>{{ stagePhase || '正在生成当前镜头' }}</b></template>
          <template v-else-if="activeJob && ['failed','retryable','invalid'].includes(activeJob.status)"><el-icon class="stage-warning"><WarningFilled /></el-icon><b>{{ activeJob.status === 'invalid' ? '当前历史任务无效' : '当前镜头生成失败' }}</b><small>{{ activeJob.error_msg }}</small><el-button v-if="activeJob.status === 'retryable'" type="primary" @click="retry(activeJob)">重新生成</el-button></template>
          <template v-else><div class="selected-mosaic"><img v-for="asset in chosenImageAssets.slice(0, 5)" :key="asset.id" :src="assetUrl(asset)" /></div><div class="empty-play">▶</div><b>{{ chosenAssets.length ? '当前镜头已编排，等待生成' : '为当前镜头添加素材' }}</b></template>
        </div>
        <div class="time-ruler"><span>0秒</span><div><i :style="{ width: `${Math.min(100, duration / maxDuration * 100)}%` }"></i></div><span>{{ duration }}秒 / {{ maxDuration }}秒</span></div>
        <div class="shot-tabs"><span class="active">本分镜脚本</span><span>本分镜素材 {{ chosenAssets.length }}</span><span>镜头 {{ activeShotIndex + 1 }} / {{ shots.length }}</span></div>
        <div class="shot-script"><OmniAssetPromptEditor v-model="prompt" :assets="assets" :chosen-ids="selected" @pick="onPickFromEditor" @references="setPromptReferences" /></div>
      </section>

      <aside class="panel creation-panel" aria-label="创作输入与生成设置">
        <div class="panel-title"><b>视频生成方式</b><el-tag size="small" type="info">{{ creationMode === 'first_last_frame' ? '首尾帧生视频' : '多参考生视频' }}</el-tag></div>
        <el-radio-group v-model="creationMode" size="small" class="mode-switch"><el-radio-button label="multi_reference">多参考生视频</el-radio-button><el-radio-button label="first_last_frame">首尾帧生视频</el-radio-button></el-radio-group>
        <small class="mode-note">{{ creationMode === 'first_last_frame' ? '必须设置一张首帧（必填），尾帧可选；模型不支持时不可提交。' : '图片、视频、音频可按用途自由编排，按模型能力自动路由。' }}</small>
        <el-alert v-if="!currentCapability" class="model-config-alert" type="warning" :closable="false" title="尚未配置可用的视频模型" description="请先在 AI 配置中启用并保存一个已验证的视频模型；配置后本工作台会自动读取它的素材能力与限制。"><template #default><el-button text size="small" @click="$router.push('/ai-config')">前往 AI 配置</el-button></template></el-alert>
        <div class="creation-generate-dock" aria-label="当前镜头生成操作">
          <div class="creation-generate-summary"><b>生成镜头 {{ activeShotIndex + 1 }}</b><small>{{ chosenAssets.length }} 个已选素材 · {{ duration }} 秒</small></div>
          <div class="creation-generate-actions"><el-button size="small" @click="requestPreviewOpen = true">预览请求</el-button><el-button class="generate-button" type="primary" :loading="creating" :disabled="!canCreate" @click="create">{{ creating ? '生成中…' : '生成当前镜头' }}</el-button></div>
        </div>
        <div v-if="creationMode === 'first_last_frame'" class="frame-slots">
          <div class="frame-slot" :class="{ filled: !!firstFrameAsset, required: true }" @click="openFramePicker('first_frame')">
            <img v-if="firstFrameAsset" :src="assetUrl(firstFrameAsset)" />
            <el-button v-if="firstFrameAsset" text size="small" class="frame-clear" @click.stop="clearFrame('first_frame')">清除</el-button>
            <span v-if="!firstFrameAsset" class="frame-tag req">必填</span>
            <div v-if="!firstFrameAsset" class="frame-empty"><el-icon><Picture /></el-icon><span class="frame-label">首帧 <em class="req">*</em></span><small>点击选择</small></div>
          </div>
          <div class="frame-slot" :class="{ filled: !!lastFrameAsset }" @click="openFramePicker('last_frame')">
            <img v-if="lastFrameAsset" :src="assetUrl(lastFrameAsset)" />
            <el-button v-if="lastFrameAsset" text size="small" class="frame-clear" @click.stop="clearFrame('last_frame')">清除</el-button>
            <span v-if="!lastFrameAsset" class="frame-tag">选填</span>
            <div v-if="!lastFrameAsset" class="frame-empty"><el-icon><Picture /></el-icon><span class="frame-label">尾帧</span><small>点击选择</small></div>
          </div>
        </div>
        <section class="t0-generation-settings" aria-label="生成参数">
          <div class="t0-settings-heading"><b>生成参数</b><small>模型、比例、时长、分辨率、音频</small></div>
          <GenerationSettings v-model="generationSettings" :max-duration="maxDuration" />
          <div class="parameters"><label>音频<el-select v-model="audioStrategy" size="small"><el-option label="音频参考" value="reference_only"/><el-option label="成片混音" value="post_mix"/></el-select></label></div>
        </section>

        <div class="materials-title"><b>当前镜头素材</b><div><el-select v-if="isProjectMode" v-model="assetScope" size="small" class="asset-scope"><el-option label="全部素材" value="all"/><el-option label="本项目素材" value="project"/><el-option label="全局素材" value="global"/></el-select><el-button text size="small" @click="$router.push('/media-library')">素材库</el-button><el-button text size="small" @click="pickFiles">上传素材</el-button></div></div>
        <input ref="fileInput" hidden type="file" multiple accept="image/*,video/*,audio/*" @change="uploadFiles" />
        <div class="dropzone" @click="pickFiles" @dragover.prevent @drop.prevent="dropFiles"><el-icon><Upload /></el-icon>拖入图片、视频或音频</div>
        <small class="upload-limit-note">{{ limitSummary }}</small>
        <div class="material-pool">
          <article v-for="asset in visibleAssets" :key="asset.id" class="material-card" :class="{ selected: selected.has(asset.id) }" draggable="true" @dragstart="onAssetDragStart($event, asset)" @click="toggle(asset)"><img v-if="asset.type === 'image'" :src="assetUrl(asset)"/><video v-else-if="asset.type === 'video'" :src="assetUrl(asset)" muted/><span v-else>🎵</span><small>{{ asset.alias || asset.name }}</small><em v-if="isProjectMode" class="asset-scope-label">{{ Number(asset.drama_id) === projectDramaId ? '项目' : '全局' }}</em><el-icon v-if="selected.has(asset.id)"><CircleCheckFilled /></el-icon></article>
        </div>

        <template v-if="!isProjectMode">
          <label class="prompt-label">提示词 <em>可拖入上方素材或输入 @ 引用</em></label>
          <OmniAssetPromptEditor v-model="prompt" :assets="assets" :chosen-ids="selected" @pick="onPickFromEditor" @references="setPromptReferences" />
        </template>
        <div class="selected-assets">
          <article v-for="asset in chosenAssets" :key="asset.id" draggable="true" @dragstart="draggedAssetId = asset.id" @dragover.prevent @drop="dropSelectedAsset(asset.id)"><span class="drag-handle">⠿</span><span class="asset-name"><b>@{{ asset.alias || asset.name }}</b><small class="asset-route-hint">{{ assetRouteHint(asset) }}</small></span><el-select v-model="asset.usage" size="small" @change="onUsageChange(asset)"><el-option v-for="usage in usages(asset.type)" :key="usage.value" :label="usage.label" :value="usage.value"/></el-select><el-button text size="small" @click="remove(asset.id)">移除</el-button></article>
        </div>
        <small class="selection-limit-note">{{ selectionSummary }}</small><small v-if="creationMode === 'first_last_frame'" class="selection-limit-note">首帧 {{ firstFrameCount }}/1，尾帧 {{ lastFrameCount }}/1</small>
        <div v-if="chosenImageAssets.length" class="identity-options">
          <div class="identity-heading"><b>素材声明</b><small>只需勾选含真人；未勾选即为不含真人，不再需要额外认证。</small></div>
          <div v-for="asset in chosenImageAssets" :key="asset.id" class="identity-row">
            <el-checkbox :model-value="asset.requires_sd2_identity" @change="setRealPerson(asset, $event)">{{ asset.alias || asset.name }}</el-checkbox>
            <small v-if="asset.requires_sd2_identity" class="identity-help">系统将自动完成真人素材准备。</small>
            <small v-else class="identity-help">不含真人素材。</small>
          </div>
        </div>
        <div v-if="audioStrategy === 'post_mix'" class="audio-options"><el-checkbox v-model="keepOriginalAudio">保留原声</el-checkbox><el-slider v-model="audioVolume" :min="0" :max="2" :step="0.1"/><el-input-number v-model="audioFadeSeconds" :min="0" :max="10" size="small"/></div>
        <div v-if="expiredIdentityAssets.length" class="identity-expired-warn"><el-icon><WarningFilled /></el-icon><span>以下真人素材认证未成功：{{ expiredIdentityAssets.map((a) => a.alias || a.name).join('、') }}。请检查素材或认证配置后重新勾选“含真人”。</span></div>
        <section class="generation-history">
          <div class="generation-history-head"><b>本镜生成记录</b><small>{{ shotHistory.length }} 个版本</small></div>
          <div class="generation-history-grid">
            <button v-for="job in shotHistory" :key="job.id" type="button" class="generation-history-item" :class="{ active: String(selectedHistoryJobId) === String(job.id) }" @click="selectHistoryJob(job)">
              <video v-if="job.videoUrl" :src="job.videoUrl" :poster="historyPoster(job)" muted playsinline preload="auto" /><span v-else class="history-video-empty">{{ job.status === 'processing' ? '生成中' : '暂无预览' }}</span>
              <span class="history-card-meta"><b>{{ job.model_resolved || job.model || '视频版本' }}</b><small>{{ historyStatus(job.status) }} · {{ job.duration || duration }}秒</small></span>
              <span :class="['history-dot', job.status]"></span>
            </button>
          </div>
          <p v-if="!shotHistory.length" class="generation-history-empty">尚无生成记录。每次生成都会保留为独立版本。</p>
        </section>
      </aside>
    </section>

    <el-dialog v-model="framePicker.open" :title="framePicker.target === 'first_frame' ? '选择首帧' : '选择尾帧'" width="540px" append-to-body>
      <div class="frame-picker-grid">
        <article v-for="asset in pickerImageAssets" :key="asset.id" class="frame-picker-card" :class="{ active: framePickerValue && framePickerValue.id === asset.id }" @click="confirmFrame(asset)">
          <img :src="assetUrl(asset)" /><small>{{ asset.alias || asset.name }}</small>
        </article>
      </div>
      <div v-if="!pickerImageAssets.length" class="frame-picker-empty">还没有图片素材，请先在上方上传图片</div>
    </el-dialog>
    <el-dialog v-model="requestPreviewOpen" title="本次生成请求预览" width="620px" append-to-body>
      <p class="request-preview-note">此处仅展示将要提交的内容，不会润色或改写你的原始提示词。</p>
      <pre class="request-preview">{{ JSON.stringify(requestPreview, null, 2) }}</pre>
      <div class="request-preview-actions"><el-button :loading="polishingPrompt" @click="suggestPolish">AI 润色建议</el-button><el-button v-if="polishSuggestion" type="primary" plain @click="applyPolishSuggestion">应用建议</el-button></div>
      <div v-if="polishSuggestion" class="polish-suggestion"><b>润色建议（尚未应用）</b><pre>{{ polishSuggestion }}</pre></div>
    </el-dialog>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, CircleCheckFilled, Delete, Edit, Picture, Upload, VideoCamera, WarningFilled } from '@element-plus/icons-vue'
import { omniVideoAPI } from '@/api/omniVideo'
import { videosAPI } from '@/api/videos'
import { dramaAPI } from '@/api/drama'
import { storyboardsAPI } from '@/api/storyboards'
import OmniAssetPromptEditor from '@/components/OmniAssetPromptEditor.vue'
import GenerationSettings from '@/components/GenerationSettings.vue'
import { formatChinaDateTime } from '@/utils/time'

const componentProps = defineProps({ projectEpisodeId: { type: [Number, String], default: null }, projectDramaId: { type: [Number, String], default: null }, embedded: { type: Boolean, default: false } })
const emit = defineEmits(['reordered', 'changed'])
const assets = ref([]), capabilities = ref([]), jobs = ref([]), sequence = ref(null), shots = ref([]), activeShotId = ref(null)
const route = useRoute()
const router = useRouter()
const embedded = computed(() => componentProps.embedded)
const projectEpisodeId = computed(() => Number(componentProps.projectEpisodeId || route.query.episode_id || 0))
const projectDramaId = computed(() => Number(componentProps.projectDramaId || route.query.drama_id || 0))
const isProjectMode = computed(() => Number.isInteger(projectEpisodeId.value) && projectEpisodeId.value > 0)
const selected = ref(new Set()), selectedOrder = ref([]), assetScope = ref('project'), prompt = ref(''), model = ref(''), aspectRatio = ref('16:9'), duration = ref(15), resolution = ref('720p'), audioStrategy = ref('reference_only'), creationMode = ref('multi_reference')
const promptDocument = ref({ text: '', refs: [] })
const keepOriginalAudio = ref(false), audioVolume = ref(1), audioFadeSeconds = ref(0), creating = ref(false), certifyingId = ref(null), extractingPosition = ref(''), savedResultJobId = ref(null), requestPreviewOpen = ref(false), polishingPrompt = ref(false), polishSuggestion = ref(''), stagePhase = ref(''), fileInput = ref(null), uploadLimits = ref(null)
const draggedShotId = ref(null), draggedAssetId = ref(null), loadingShot = ref(false)
const shotHistory = ref([]), selectedHistoryJobId = ref(null)
let saveTimer = null

const currentShot = computed(() => shots.value.find((shot) => shot.id === activeShotId.value) || null)
const activeShotIndex = computed(() => Math.max(0, shots.value.findIndex((shot) => shot.id === activeShotId.value)))
const chosenAssets = computed(() => selectedOrder.value.map((id) => assets.value.find((asset) => asset.id === id)).filter(Boolean))
const chosenImageAssets = computed(() => chosenAssets.value.filter((asset) => asset.type === 'image'))
const visibleAssets = computed(() => assets.value.filter((asset) => assetScope.value === 'all' || (assetScope.value === 'project' ? Number(asset.drama_id) === projectDramaId.value : !asset.drama_id)))
const activeJob = computed(() => {
  const selected = shotHistory.value.find((job) => String(job.id) === String(selectedHistoryJobId.value))
  return selected || shotHistory.value.find((job) => String(job.id) === String(currentShot.value?.omni_job_id)) || shotHistory.value[0] || null
})
const activeVideoUrl = computed(() => activeJob.value?.videoUrl || currentShot.value?.video_url || '')
const canExtractFrames = computed(() => Number(activeJob.value?.video_generation_id) > 0 && activeJob.value?.status === 'completed')
const currentCapability = computed(() => capabilities.value.find((item) => item.model === model.value) || null)
const shotLimits = computed(() => {
  const base = uploadLimits.value?.shot || { total: 12, image: 9, video: 3, audio: 3 }
  const limits = currentCapability.value?.limits || {}
  if (!limits.total_reference?.max) return base
  return {
    total: Number(limits.total_reference.max), image: Number(limits.image_reference?.max || base.image),
    video: Number(limits.video_reference?.max || base.video), audio: Number(limits.audio_reference?.max || base.audio),
  }
})
const maxDuration = computed(() => Math.max(4, Number(currentCapability.value?.limits?.duration?.max || 15)))
const normalizeDuration = (value) => Math.min(maxDuration.value, Math.max(4, Math.round(Number(value) || 15)))
const generationSettings = computed({ get: () => ({ video_model: model.value, aspect_ratio: aspectRatio.value, duration: duration.value, resolution: resolution.value }), set: (next) => { model.value = next.video_model || ''; aspectRatio.value = next.aspect_ratio || '16:9'; duration.value = normalizeDuration(next.duration); resolution.value = next.resolution || '720p' } })
const selectionCounts = computed(() => chosenAssets.value.reduce((result, asset) => { if (Object.prototype.hasOwnProperty.call(result, asset.type)) result[asset.type] += 1; return result }, { image: 0, video: 0, audio: 0 }))
const firstFrameCount = computed(() => chosenAssets.value.filter((asset) => asset.usage === 'first_frame').length)
const lastFrameCount = computed(() => chosenAssets.value.filter((asset) => asset.usage === 'last_frame').length)
const firstFrameAsset = computed(() => chosenAssets.value.find((asset) => asset.usage === 'first_frame') || null)
const lastFrameAsset = computed(() => chosenAssets.value.find((asset) => asset.usage === 'last_frame') || null)
const pickerImageAssets = computed(() => assets.value.filter((asset) => asset.type === 'image'))
/** 认证中的素材会由服务端等待并自动续跑；仅终态失败才提示用户处理。 */
const expiredIdentityAssets = computed(() => chosenImageAssets.value.filter((asset) => asset.requires_sd2_identity && ['invalid', 'failed', 'stale'].includes(sd2Status(asset))))
const framePicker = ref({ open: false, target: 'first_frame' })
const canCreate = computed(() => !!model.value && !!currentCapability.value && prompt.value.trim() && (creationMode.value !== 'first_last_frame' || (firstFrameCount.value === 1 && lastFrameCount.value <= 1 && currentCapability.value.supports?.first_last_frame)))
const nativeImageLimit = computed(() => Math.min(shotLimits.value.image, Number(currentCapability.value?.supports?.image_reference?.max || 0)))
const limitSummary = computed(() => `单文件：图片 ${uploadLimits.value?.files?.image?.max_mb || 30}MB、视频 ${uploadLimits.value?.files?.video?.max_mb || 50}MB、音频 ${uploadLimits.value?.files?.audio?.max_mb || 15}MB；单镜头最多 ${shotLimits.value.total} 个素材。`)
const selectionSummary = computed(() => `已选 ${chosenAssets.value.length}/${shotLimits.value.total}；图片 ${selectionCounts.value.image}/${shotLimits.value.image}，视频 ${selectionCounts.value.video}/${shotLimits.value.video}，音频 ${selectionCounts.value.audio}/${shotLimits.value.audio}${currentCapability.value ? `；当前模型原生图片参考 ${selectionCounts.value.image}/${nativeImageLimit.value}` : ''}`)
const stageLabel = computed(() => ({ completed: '成片完成', processing: '生成中', failed: '生成失败', retryable: '可重试', invalid: '无效任务' })[activeJob.value?.status] || '镜头草稿')
const stageTagType = computed(() => ({ completed: 'success', failed: 'danger', retryable: 'warning', invalid: 'info' })[activeJob.value?.status] || 'info')
const requestPreview = computed(() => ({ prompt: prompt.value, creation_mode: creationMode.value, model: currentCapability.value?.model || model.value, aspect_ratio: aspectRatio.value, duration_seconds: normalizeDuration(duration.value), resolution: resolution.value, audio_strategy: audioStrategy.value, assets: chosenAssets.value.map((asset, index) => ({ ordinal: index + 1, name: asset.alias || asset.name, type: asset.type, usage: asset.usage, routing: assetRouteHint(asset) })) }))

async function suggestPolish() {
  if (!prompt.value.trim() || polishingPrompt.value) return
  polishingPrompt.value = true
  try {
    const out = await omniVideoAPI.polishPrompt({ prompt: prompt.value, assets: chosenAssets.value.map((asset) => ({ name: asset.name, alias: asset.alias, type: asset.type, usage: asset.usage })) })
    polishSuggestion.value = String(out?.suggestion || '').trim()
    if (!polishSuggestion.value) ElMessage.warning('未得到可用的润色建议，请检查文本模型配置')
  } catch (error) { ElMessage.error(error.message || '提示词润色失败') } finally { polishingPrompt.value = false }
}
function applyPolishSuggestion() { if (!polishSuggestion.value) return; prompt.value = polishSuggestion.value; promptDocument.value = { text: prompt.value, refs: promptDocument.value.refs || [] }; polishSuggestion.value = ''; ElMessage.success('已应用润色建议') }
function assetUrl(asset) { return asset?.local_path ? `/static/${asset.local_path}` : asset?.url || '' }
function typeName(type) { return ({ image: '图片', video: '视频', audio: '音频' })[type] || '素材' }
function usages(type) { return type === 'image' ? [{label:'主视觉',value:'primary'},{label:'人物一致性',value:'identity'},{label:'场景/风格',value:'environment'},{label:'普通参考',value:'reference'},{label:'首帧',value:'first_frame'},{label:'尾帧',value:'last_frame'}] : type === 'video' ? [{label:'动作/镜头参考',value:'motion'},{label:'关键帧提取',value:'keyframes'},{label:'仅后期',value:'post_process'}] : [{label:'音色/氛围参考',value:'ambience'},{label:'成片混音',value:'post_mix'}] }
function assetRouteHint(asset) {
  const supports = currentCapability.value?.supports
  if (!supports) return '等待模型能力加载'
  if (asset.type === 'image') {
    const ordinal = chosenAssets.value.filter((item) => item.type === 'image').findIndex((item) => item.id === asset.id)
    return ordinal >= 0 && ordinal < nativeImageLimit.value ? '发送给模型：图片参考' : '不会发送：超出图片参考上限'
  }
  if (asset.type === 'video') return supports.video_reference ? '发送给模型：原生视频参考' : '生成前处理：提取关键帧参考'
  if (asset.type === 'audio') return supports.audio_reference && audioStrategy.value !== 'post_mix' ? '发送给模型：音频参考' : '生成后处理：成片混音'
  return '按当前模型能力处理'
}
function shotState(shot) { return ({ completed:'已完成',processing:'生成中',failed:'失败',retryable:'可重试',invalid:'无效',draft:'草稿' })[shot.status] || '草稿' }
function historyStatus(status) { return ({ completed: '已完成', processing: '生成中', failed: '失败', retryable: '可重试', invalid: '无效' })[status] || '等待中' }
function formatHistoryTime(value) { return formatChinaDateTime(value) }
function selectHistoryJob(job) { selectedHistoryJobId.value = job.id }
function historyPoster(job) {
  const image = String(job?.image_url || job?.generation?.image_url || '')
  if (!image || image.startsWith('asset://')) return ''
  return /^https?:\/\//.test(image) || image.startsWith('/static/') ? image : `/static/${image.replace(/^\/+/, '')}`
}
function containEmbeddedScroll(event) {
  if (!embedded.value || !event.deltaY || !(event.target instanceof Element)) return
  const panel = event.target.closest('.shot-list, .creation-panel, .material-pool, .selected-assets, .frame-picker-grid')
  if (!panel || panel.scrollHeight <= panel.clientHeight) return
  const atTop = panel.scrollTop <= 0
  const atBottom = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 1
  if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) event.preventDefault()
}
function shotCover(shot) { const first = (shot.assets || []).find((item) => item.type === 'image'); const asset = first && assets.value.find((item) => item.id === Number(first.asset_id)); return assetUrl(asset) }
function sd2Status(asset) { return String(asset?.seedance2_asset?.status || 'none').toLowerCase() }
function sd2StatusLabel(asset) { return ({ none: '未认证', processing: '认证中', active: '可用', invalid: '已失效', failed: '认证失败' })[sd2Status(asset)] || '认证状态未知' }
function sd2ActionLabel(asset) {
  const status = sd2Status(asset)
  if (status === 'active') return '刷新状态'
  if (status === 'processing') return '刷新状态'
  if (status === 'invalid' || status === 'failed' || status === 'stale') return '重新认证'
  return '认证'
}
function localVideoUrl(video) {
  const localPath = String(video?.local_path || '').replace(/^\/+/, '')
  if (!localPath) return video?.video_url || ''
  const version = video.updated_at || video.completed_at || video.id || ''
  return `/static/${localPath}${version ? `?v=${encodeURIComponent(version)}` : ''}`
}
function normalizeJob(data) { const generation = data.generation || {}; return { ...data, omni_job_id: data.id, status: generation.status || data.status || 'processing', error_msg: generation.error_msg || data.error_msg, videoUrl: localVideoUrl(generation) || data.video_url, local_path: generation.local_path || data.local_path, duration: generation.duration || data.duration } }
function legacyVideoHistoryItem(video) { return { ...video, id: `video-${video.id}`, omni_job_id: null, video_generation_id: video.id, status: video.status || 'completed', videoUrl: localVideoUrl(video), duration: video.duration } }
function promptDocumentFor(text) {
  const value = String(text || '')
  const aliases = [...new Set([...value.matchAll(/@([^\s@]+)/g)].map((match) => match[1]))]
  const refs = aliases.flatMap((alias) => {
    const asset = assets.value.find((item) => (item.alias || item.name) === alias)
    return asset ? [{ asset_id: asset.id, alias }] : []
  })
  return { text: value, refs }
}
function projectShot(storyboard, video = null) {
  const { omni_asset_ids, omni_asset_usage, ...rest } = storyboard
  const ids = Array.isArray(omni_asset_ids) ? omni_asset_ids.map(Number).filter(Number.isFinite) : []
  const usage = omni_asset_usage || {}
  const firstFrameId = Number(storyboard.omni_first_frame_asset_id) || null
  const lastFrameId = Number(storyboard.omni_last_frame_asset_id) || null
  const assetIds = [...ids]
  if (firstFrameId && !assetIds.includes(firstFrameId)) assetIds.push(firstFrameId)
  if (lastFrameId && !assetIds.includes(lastFrameId)) assetIds.push(lastFrameId)
  return {
    ...rest,
    video_url: video ? localVideoUrl(video) : storyboard.video_url,
    prompt: storyboard.universal_segment_text || storyboard.video_prompt || '',
    prompt_document: promptDocumentFor(storyboard.universal_segment_text || storyboard.video_prompt || ''),
    assets: assetIds.map((asset_id) => ({ asset_id, usage: asset_id === firstFrameId ? 'first_frame' : asset_id === lastFrameId ? 'last_frame' : usage[asset_id] || 'reference' })),
    settings: {
      model: storyboard.video_model === 'auto' ? '' : (storyboard.video_model || ''), creation_mode: storyboard.omni_creation_mode || 'multi_reference',
      aspect_ratio: storyboard.video_aspect_ratio || '16:9', duration: Number(storyboard.duration) || 5,
      resolution: storyboard.video_resolution || '720p', audio_strategy: storyboard.audio_strategy || 'reference_only',
      keep_original_audio: !!storyboard.keep_original_audio, audio_volume: storyboard.audio_volume ?? 1, audio_fade_seconds: storyboard.audio_fade_seconds ?? 0,
    },
  }
}
function backToProject() {
  if (isProjectMode.value && projectDramaId.value) router.push({ path: `/film/${projectDramaId.value}`, query: projectEpisodeId.value ? { episode_id: projectEpisodeId.value } : {} })
  else router.push('/')
}
async function loadProjectVideos(storyboards) {
  const groups = await Promise.all((storyboards || []).map(async (storyboard) => {
    const result = await videosAPI.list({ storyboard_id: storyboard.id, page_size: 20 })
    return [Number(storyboard.id), (result?.items || []).find((item) => item.status === 'completed' && (item.local_path || item.video_url)) || null]
  }))
  return new Map(groups)
}
function applyProjectVideoSources(storyboards, videos) {
  shots.value = storyboards.map((storyboard) => projectShot(storyboard, videos.get(Number(storyboard.id))))
  jobs.value = jobs.value.map((job) => {
    const shot = shots.value.find((item) => Number(item.omni_job_id) === Number(job.id))
    const video = videos.get(Number(shot?.id))
    return video ? { ...job, videoUrl: localVideoUrl(video), generation: { ...(job.generation || {}), ...video } } : job
  })
}
async function refreshProjectShots(preferredId = activeShotId.value) {
  const result = await dramaAPI.getStoryboards(projectEpisodeId.value)
  const storyboards = result?.storyboards || []
  applyProjectVideoSources(storyboards, await loadProjectVideos(storyboards))
  const target = shots.value.find((shot) => Number(shot.id) === Number(preferredId)) || shots.value[0] || null
  if (target) loadShot(target)
  else activeShotId.value = null
}
async function ensureProjectResourceAssets(project, mediaItems) {
  const all = (mediaItems || []).filter((asset) => asset && Number.isFinite(Number(asset.id)))
  const groups = [
    ['character', project?.characters || []], ['scene', project?.scenes || []], ['prop', project?.props || []],
  ]
  for (const [kind, entries] of groups) {
    for (const entry of entries) {
      const localPath = entry?.local_path || null
      const url = entry?.image_url || null
      if (!localPath && !url) continue
      const exists = all.find((asset) => (localPath && asset.local_path === localPath) || (!localPath && url && asset.url === url))
      if (exists) continue
      try {
        const asset = await omniVideoAPI.createAsset({
          drama_id: projectDramaId.value, name: entry.name || entry.location || `${kind} ${entry.id}`, type: 'image',
          url: url || '', local_path: localPath, source_type: 'project_resource', processing_status: 'ready',
          metadata: { resource_type: kind, resource_id: entry.id },
        })
        if (asset) all.unshift(asset)
      } catch (_) {
        // 单个实体同步失败不阻塞其余素材和分镜工作台加载。
      }
    }
  }
  return all
}

async function loadAllAssets(params = {}) {
  const items = []
  let page = 1
  let total = Infinity
  while (items.length < total) {
    const result = await omniVideoAPI.assets({ ...params, page, page_size: 100 })
    const batch = (result?.items || []).filter((asset) => asset && Number.isFinite(Number(asset.id)))
    items.push(...batch)
    total = Number(result?.pagination?.total ?? items.length)
    if (!batch.length || page >= Number(result?.pagination?.total_pages || 1)) break
    page += 1
  }
  return { items }
}

async function loadProjectScopedAssets() {
  const [project, global] = await Promise.all([
    loadAllAssets({ scope: 'project', drama_id: projectDramaId.value }),
    loadAllAssets({ scope: 'global' }),
  ])
  const byId = new Map()
  ;[...(project.items || []), ...(global.items || [])].forEach((item) => byId.set(Number(item.id), item))
  return { items: [...byId.values()] }
}

function loadShot(shot) { loadingShot.value = true; activeShotId.value = shot.id; selectedHistoryJobId.value = null; prompt.value = shot.prompt || ''; promptDocument.value = promptDocumentFor(prompt.value); const settings = shot.settings || {}; model.value = settings.model === 'auto' ? '' : (settings.model || ''); creationMode.value = settings.creation_mode || 'multi_reference'; aspectRatio.value = settings.aspect_ratio || '16:9'; duration.value = normalizeDuration(settings.duration || 5); resolution.value = settings.resolution || '720p'; audioStrategy.value = settings.audio_strategy || 'reference_only'; keepOriginalAudio.value = !!settings.keep_original_audio; audioVolume.value = settings.audio_volume ?? 1; audioFadeSeconds.value = settings.audio_fade_seconds ?? 0; const ids = (shot.assets || []).map((item) => Number(item.asset_id)).filter((id) => assets.value.some((asset) => asset.id === id)); const firstFrameId = Number(shot.omni_first_frame_asset_id) || null; const lastFrameId = Number(shot.omni_last_frame_asset_id) || null; selected.value = new Set(ids); selectedOrder.value = ids; (shot.assets || []).forEach((saved) => { const asset = assets.value.find((item) => item.id === Number(saved.asset_id)); if (asset) { asset.usage = Number(saved.asset_id) === firstFrameId ? 'first_frame' : Number(saved.asset_id) === lastFrameId ? 'last_frame' : saved.usage || asset.usage; asset.alias = saved.alias || asset.alias } }); promptDocument.value = promptDocumentFor(prompt.value); loadShotHistory(shot); queueMicrotask(() => { loadingShot.value = false }) }
async function loadShotHistory(shot) {
  if (!shot?.id) return
  const shotId = Number(shot.id)
  try {
    const [result, videoResult] = await Promise.all([
      omniVideoAPI.list(isProjectMode.value ? { storyboard_id: shotId } : { shot_id: shotId }),
      isProjectMode.value ? videosAPI.list({ storyboard_id: shotId, episode_id: projectEpisodeId.value, storyboard_number: shot.storyboard_number, page_size: 100 }) : Promise.resolve({ items: [] }),
    ])
    if (Number(currentShot.value?.id) !== shotId) return
    const jobs = (result || []).map(normalizeJob)
    const jobGenerationIds = new Set(jobs.map((job) => Number(job.video_generation_id)))
    const legacy = (videoResult?.items || []).filter((video) => !jobGenerationIds.has(Number(video.id))).map(legacyVideoHistoryItem)
    shotHistory.value = [...jobs, ...legacy].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  } catch (_) { if (Number(currentShot.value?.id) === shotId) shotHistory.value = [] }
}
async function selectShot(shot) { if (shot.id === activeShotId.value) return; await saveCurrentShot(false); loadShot(shot) }
async function saveCurrentShot(showMessage = true) {
  if (!sequence.value || !currentShot.value || loadingShot.value) return
  clearTimeout(saveTimer)
  const settings = { model: model.value, creation_mode: creationMode.value, aspect_ratio: aspectRatio.value, duration: normalizeDuration(duration.value), resolution: resolution.value || '720p', audio_strategy: audioStrategy.value, keep_original_audio: keepOriginalAudio.value, audio_volume: audioVolume.value, audio_fade_seconds: audioFadeSeconds.value }
  if (isProjectMode.value) {
    const ids = chosenAssets.value.map((asset) => Number(asset.id))
    const usage = Object.fromEntries(chosenAssets.value.map((asset) => [asset.id, asset.usage || 'reference']))
    const updated = await storyboardsAPI.update(currentShot.value.id, {
      universal_segment_text: prompt.value, omni_asset_ids: ids, omni_asset_usage_json: usage,
      omni_creation_mode: settings.creation_mode, video_model: settings.model, video_aspect_ratio: settings.aspect_ratio,
      video_resolution: settings.resolution, duration: settings.duration, audio_strategy: settings.audio_strategy,
      keep_original_audio: settings.keep_original_audio, audio_volume: settings.audio_volume, audio_fade_seconds: settings.audio_fade_seconds,
      omni_first_frame_asset_id: chosenAssets.value.find((asset) => asset.usage === 'first_frame')?.id || null,
      omni_last_frame_asset_id: chosenAssets.value.find((asset) => asset.usage === 'last_frame')?.id || null,
    })
    Object.assign(currentShot.value, projectShot(updated))
    if (showMessage) ElMessage.success('当前项目分镜已保存')
    return
  }
  const [updated, savedSequence] = await Promise.all([omniVideoAPI.updateShot(sequence.value.id, currentShot.value.id, { title: currentShot.value.title, prompt: prompt.value, prompt_document: { ...promptDocument.value, text: prompt.value }, assets: chosenAssets.value.map((asset, index) => ({ asset_id: asset.id, alias: asset.alias || asset.name, type: asset.type, usage: asset.usage, ordinal: index + 1 })), settings }), omniVideoAPI.updateSequence(sequence.value.id, { name: sequence.value.name })])
  Object.assign(currentShot.value, updated); sequence.value.name = savedSequence.name; if (showMessage) ElMessage.success('整集与当前镜头已保存')
}
function scheduleSave() { if (loadingShot.value || !currentShot.value) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => saveCurrentShot(false).catch(() => {}), 650) }
async function addShot(afterCurrent) { await saveCurrentShot(false); if (isProjectMode.value) { const index = afterCurrent ? activeShotIndex.value + 1 : shots.value.length; const number = index + 1; const shot = await storyboardsAPI.create({ episode_id: projectEpisodeId.value, storyboard_number: number, title: `镜头 ${number}`, description: '' }); const list = [...shots.value]; list.splice(index, 0, projectShot(shot)); await persistShotOrder(list); await refreshProjectShots(shot.id); emit('changed'); return } const shot = await omniVideoAPI.addShot(sequence.value.id, afterCurrent ? { after_shot_id: activeShotId.value } : {}); const refreshed = await omniVideoAPI.getSequence(sequence.value.id); sequence.value = refreshed; shots.value = refreshed.shots; loadShot(shots.value.find((item) => item.id === shot.id) || shots.value.at(-1)) }
async function copyCurrentShot() { if (!currentShot.value) return; const draft = { prompt: prompt.value, promptDocument: structuredClone(promptDocument.value || { text: prompt.value, refs: [] }), settings: { model: model.value, creationMode: creationMode.value, aspectRatio: aspectRatio.value, duration: duration.value, resolution: resolution.value, audioStrategy: audioStrategy.value, keepOriginalAudio: keepOriginalAudio.value, audioVolume: audioVolume.value, audioFadeSeconds: audioFadeSeconds.value }, selectedOrder: [...selectedOrder.value], assets: chosenAssets.value.map((asset) => ({ id: asset.id, alias: asset.alias, usage: asset.usage })) }; try { await addShot(true); prompt.value = draft.prompt; promptDocument.value = draft.promptDocument; model.value = draft.settings.model; creationMode.value = draft.settings.creationMode; aspectRatio.value = draft.settings.aspectRatio; duration.value = draft.settings.duration; resolution.value = draft.settings.resolution; audioStrategy.value = draft.settings.audioStrategy; keepOriginalAudio.value = draft.settings.keepOriginalAudio; audioVolume.value = draft.settings.audioVolume; audioFadeSeconds.value = draft.settings.audioFadeSeconds; selectedOrder.value = draft.selectedOrder.filter((id) => assets.value.some((asset) => asset.id === id)); selected.value = new Set(selectedOrder.value); for (const saved of draft.assets) { const asset = assets.value.find((item) => item.id === saved.id); if (asset) { asset.alias = saved.alias || asset.alias; asset.usage = saved.usage || asset.usage } } await saveCurrentShot(false); ElMessage.success('已复制为当前镜头后的新镜头') } catch (error) { ElMessage.error(error.message || '复制镜头失败') } }
async function renameShot(shot) { try { const { value } = await ElMessageBox.prompt('输入镜头名称', '重命名镜头', { inputValue: shot.title || '' }); shot.title = value || '未命名镜头'; if (isProjectMode.value) { Object.assign(shot, projectShot(await storyboardsAPI.update(shot.id, { title: shot.title }))); emit('changed'); return } if (shot.id === activeShotId.value) await saveCurrentShot(false); else Object.assign(shot, await omniVideoAPI.updateShot(sequence.value.id, shot.id, { title: shot.title })) } catch (_) {} }
async function removeShot(shot) {
  try {
    await ElMessageBox.confirm(`删除“${shot.title || '未命名镜头'}”？此操作不会删除素材。`, '删除镜头', { type: 'warning', confirmButtonText: '删除镜头', cancelButtonText: '保留' })
    if (isProjectMode.value) {
      const previousIndex = shots.value.findIndex((item) => item.id === shot.id)
      await storyboardsAPI.delete(shot.id)
      const next = shots.value.filter((item) => item.id !== shot.id)
      shots.value = next
      await refreshProjectShots(next[Math.min(previousIndex, next.length - 1)]?.id)
      emit('changed')
      ElMessage.success('镜头已删除')
      return
    }
    await omniVideoAPI.deleteShot(sequence.value.id, shot.id)
    shots.value = shots.value.filter((item) => item.id !== shot.id)
    if (shot.id === activeShotId.value) loadShot(shots.value[Math.min(activeShotIndex.value, shots.value.length - 1)])
    ElMessage.success('镜头已删除')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close' && error?.action !== 'cancel' && error?.action !== 'close') ElMessage.error(error?.message || '删除镜头失败')
  }
}
async function persistShotOrder(list) { const previous = shots.value; shots.value = list; try { const result = isProjectMode.value ? await storyboardsAPI.reorder({ episode_id: projectEpisodeId.value, ids: list.map((shot) => shot.id) }) : await omniVideoAPI.reorderShots(sequence.value.id, list.map((shot) => shot.id)); shots.value = isProjectMode.value ? (result?.storyboards || []).map((item) => { const remote = projectShot(item); const local = list.find((shot) => Number(shot.id) === Number(remote.id)); if (!local) return remote; const localAssets = new Map((local.assets || []).map((asset) => [Number(asset.asset_id), asset])); return { ...remote, prompt: local.prompt, prompt_document: local.prompt_document, settings: local.settings, assets: remote.assets.map((asset) => ({ ...asset, ...localAssets.get(Number(asset.asset_id)) })) } }) : result; if (isProjectMode.value) emit('reordered') } catch (error) { shots.value = previous; ElMessage.error(error.message || '镜头排序保存失败') } }
async function dropShot(targetId) { if (!draggedShotId.value || draggedShotId.value === targetId) return; const list = [...shots.value]; const from = list.findIndex((shot) => shot.id === draggedShotId.value), to = list.findIndex((shot) => shot.id === targetId); const [moved] = list.splice(from, 1); list.splice(to, 0, moved); draggedShotId.value = null; await persistShotOrder(list) }
async function moveShot(index, offset) { const target = index + offset; if (target < 0 || target >= shots.value.length) return; const list = [...shots.value]; [list[index], list[target]] = [list[target], list[index]]; await persistShotOrder(list) }
function selectRelative(offset) { const target = shots.value[activeShotIndex.value + offset]; if (target) selectShot(target) }

function toggle(asset) { const next = new Set(selected.value); if (next.has(asset.id)) { next.delete(asset.id); selectedOrder.value = selectedOrder.value.filter((id) => id !== asset.id) } else { const typeCount = selectionCounts.value[asset.type] || 0; if (chosenAssets.value.length >= shotLimits.value.total || typeCount >= shotLimits.value[asset.type]) { ElMessage.warning(`当前镜头最多选择 ${shotLimits.value[asset.type]} 个${typeName(asset.type)}，总数最多 ${shotLimits.value.total} 个`); return } next.add(asset.id); selectedOrder.value = [...selectedOrder.value, asset.id]; asset.usage ||= asset.type === 'image' ? 'reference' : asset.type === 'video' ? 'motion' : 'ambience' } selected.value = next; scheduleSave() }
function remove(id) { const next = new Set(selected.value); next.delete(id); selected.value = next; selectedOrder.value = selectedOrder.value.filter((item) => item !== id); scheduleSave() }
function dropSelectedAsset(targetId) { if (!draggedAssetId.value || draggedAssetId.value === targetId) return; const order = [...selectedOrder.value], from = order.indexOf(draggedAssetId.value), to = order.indexOf(targetId); const [moved] = order.splice(from, 1); order.splice(to, 0, moved); selectedOrder.value = order; draggedAssetId.value = null; scheduleSave() }
function onAssetDragStart(event, asset) { const payload = JSON.stringify({ id: asset.id, name: asset.name, alias: asset.alias, type: asset.type }); event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('application/x-localminidrama-asset', payload); event.dataTransfer.setData('application/json', payload); event.dataTransfer.setData('text/plain', asset.alias || asset.name) }
function onPickFromEditor(asset) { if (asset && !selected.value.has(asset.id)) toggle(asset) }
function setPromptReferences(value) { promptDocument.value = value || { text: prompt.value, refs: [] } }
function showCertificationError(error) { ElMessage.error(error?.message || 'SD2 认证失败，请检查资产库配置后重试') }
async function refreshCertificationUntilSettled(asset) {
  for (let attempt = 0; attempt < 30 && sd2Status(asset) === 'processing'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const out = await omniVideoAPI.refreshAssetCertification(asset.id)
    if (out?.seedance2_asset) asset.seedance2_asset = out.seedance2_asset
  }
}
async function setRealPerson(asset, value) {
  asset.requires_sd2_identity = !!value
  try {
    const updated = await omniVideoAPI.updateAsset(asset.id, { requires_sd2_identity: !!value })
    Object.assign(asset, updated)
    if (value && asset.type === 'image') {
      const out = await omniVideoAPI.certifyAsset(asset.id)
      if (out?.seedance2_asset) asset.seedance2_asset = out.seedance2_asset
      if (sd2Status(asset) === 'processing') void refreshCertificationUntilSettled(asset).catch(showCertificationError)
    }
  } catch (error) {
    asset.requires_sd2_identity = !value
    ElMessage.error(error.message || '真人声明保存或认证失败')
  }
}
function onUsageChange(asset) { void asset; scheduleSave() }
/** 首尾帧占位选择器：当前目标位置已选的素材（用于对话框高亮） */
const framePickerValue = computed(() => framePicker.value.target === 'first_frame' ? firstFrameAsset.value : lastFrameAsset.value)
function openFramePicker(target) { framePicker.value = { open: true, target } }
function confirmFrame(asset) {
  const target = framePicker.value.target
  // 若该图片尚未加入当前镜头，先加入素材池
  if (!selected.value.has(asset.id)) toggle(asset)
  // 腾出目标位置：把原来占该位置的图改回普通参考
  const occupant = target === 'first_frame' ? firstFrameAsset.value : lastFrameAsset.value
  if (occupant && occupant.id !== asset.id) occupant.usage = 'reference'
  // 如果该图原本占着另一个帧位置，清空那一边（避免一张图既是首帧又是尾帧）
  if (asset.usage === 'first_frame' || asset.usage === 'last_frame') asset.usage = 'reference'
  asset.usage = target
  framePicker.value.open = false
  scheduleSave()
}
function clearFrame(target) {
  const occupant = target === 'first_frame' ? firstFrameAsset.value : lastFrameAsset.value
  if (occupant) { occupant.usage = 'reference'; scheduleSave() }
}
function pickFiles() { fileInput.value?.click() }
function dropFiles(event) { upload(event.dataTransfer.files) }
function uploadFiles(event) { upload(event.target.files); event.target.value = '' }
async function upload(files) { for (const file of Array.from(files || [])) { try { const out = await omniVideoAPI.upload(file, { name: file.name, drama_id: isProjectMode.value ? projectDramaId.value : undefined }); if (out.asset) { const item = { ...out.asset, alias: out.asset.name, usage: out.asset.type === 'image' ? 'reference' : out.asset.type === 'video' ? 'motion' : 'ambience' }; assets.value.unshift(item); toggle(item) } } catch (error) { ElMessage.error(`${file.name}：${error.message || '上传失败'}`) } } }
async function certify(asset) {
  if (!asset || asset.type !== 'image' || certifyingId.value === asset.id) return
  certifyingId.value = asset.id
  try {
    const status = sd2Status(asset)
    const out = ['processing', 'active'].includes(status)
      ? await omniVideoAPI.refreshAssetCertification(asset.id)
      : await omniVideoAPI.certifyAsset(asset.id)
    if (out?.seedance2_asset) asset.seedance2_asset = out.seedance2_asset
    if (sd2Status(asset) === 'processing') void refreshCertificationUntilSettled(asset).catch(showCertificationError)
    ElMessage.success(`「${asset.alias || asset.name}」SD2 认证状态：${sd2StatusLabel(asset)}`)
  } catch (error) {
    showCertificationError(error)
  } finally {
    certifyingId.value = null
  }
}

async function create() { creating.value = true; stagePhase.value = '保存镜头'; try { if (!canCreate.value) throw new Error('请补齐当前视频创作模式所需的素材与模型能力'); await saveCurrentShot(false); stagePhase.value = '提交生成任务'; const res = await omniVideoAPI.create({ ...(isProjectMode.value ? { drama_id: projectDramaId.value, storyboard_id: currentShot.value.id } : { sequence_id: sequence.value.id, shot_id: currentShot.value.id }), prompt: prompt.value, prompt_document: promptDocument.value, creation_mode: creationMode.value, model: model.value, aspect_ratio: aspectRatio.value, duration: normalizeDuration(duration.value), resolution: resolution.value || '720p', audio_strategy: audioStrategy.value, keep_original_audio: keepOriginalAudio.value, audio_volume: audioVolume.value, audio_fade_seconds: audioFadeSeconds.value, assets: chosenAssets.value.map((asset, index) => ({ asset_id: asset.id, alias: asset.alias || asset.name, usage: asset.usage, role: asset.usage === 'primary' ? 'primary' : 'reference', ordinal: index + 1 })) }); const status = res.status || 'processing'; const job = { id: res.omni_job_id, prompt: prompt.value, status, video_generation_id: res.video_generation_id, storyboard_id: isProjectMode.value ? currentShot.value.id : null, shot_id: isProjectMode.value ? null : currentShot.value.id, created_at: new Date().toISOString() }; jobs.value.unshift(job); shotHistory.value.unshift(job); selectedHistoryJobId.value = job.id; currentShot.value.omni_job_id = job.id; currentShot.value.status = status; stagePhase.value = status === 'sd2_waiting' ? '真人素材认证准备中，完成后自动生成' : '正在生成'; poll(job.id) } catch (error) { ElMessage.error(error.message || '任务提交失败') } finally { creating.value = false } }
async function poll(id) { for (let n = 0; n < 450; n++) { await new Promise((resolve) => setTimeout(resolve, 4000)); try { const data = await omniVideoAPI.get(id), job = normalizeJob(data), index = jobs.value.findIndex((item) => String(item.id) === String(id)), historyIndex = shotHistory.value.findIndex((item) => String(item.id) === String(id)); if (index >= 0) jobs.value[index] = job; if (historyIndex >= 0) shotHistory.value[historyIndex] = job; if (String(currentShot.value?.omni_job_id) === String(id)) { currentShot.value.status = job.status; currentShot.value.video_url = job.videoUrl; currentShot.value.generation_error = job.error_msg } if (['completed','failed','retryable'].includes(job.status)) return } catch (_) { return } } }
async function retry(job) { const res = await omniVideoAPI.retry(job.id); const next = { id: res.omni_job_id, prompt: job.prompt, status: 'processing', video_generation_id: res.video_generation_id, storyboard_id: isProjectMode.value ? currentShot.value?.id : null, shot_id: isProjectMode.value ? null : currentShot.value?.id, created_at: new Date().toISOString() }; jobs.value.unshift(next); shotHistory.value.unshift(next); selectedHistoryJobId.value = next.id; currentShot.value.omni_job_id = next.id; currentShot.value.status = 'processing'; poll(next.id) }
function downloadCurrentVideo() { if (!activeVideoUrl.value) return; const link = document.createElement('a'); link.href = activeVideoUrl.value; link.download = `local-mini-drama-${activeJob.value?.video_generation_id || currentShot.value?.id || 'storyboard'}.mp4`; document.body.appendChild(link); link.click(); link.remove() }
async function saveResultAsAsset() { const job = activeJob.value; if (!job?.videoUrl || savedResultJobId.value === job.id) return; try { const generation = job.generation || {}; const asset = await omniVideoAPI.createAsset({ drama_id: projectDramaId.value || null, name: `成片 ${job.video_generation_id || job.id}`, type: 'video', url: generation.video_url || job.video_url || job.videoUrl, local_path: generation.local_path || job.local_path || null, source_type: 'omni_generation', video_gen_id: job.video_generation_id || null, processing_status: 'ready', metadata: { source_omni_job_id: job.id, source_video_generation_id: job.video_generation_id || null } }); const item = { ...asset, alias: asset.name, usage: 'motion' }; assets.value.unshift(item); savedResultJobId.value = job.id; toggle(item); ElMessage.success('成片已加入素材库，并已选入当前镜头') } catch (error) { ElMessage.error(error.message || '加入素材库失败') } }
async function extractFrame(position) { if (!canExtractFrames.value || extractingPosition.value) return; extractingPosition.value = position; try { const asset = await omniVideoAPI.extractVideoFrame(activeJob.value.video_generation_id, position); const item = { ...asset, alias: asset.name, usage: position === 'first' ? 'first_frame' : 'last_frame' }; assets.value.unshift(item); toggle(item); ElMessage.success(position === 'first' ? '首帧已提取到素材库，并设为当前镜头首帧' : '尾帧已提取到素材库，并设为当前镜头尾帧') } catch (error) { ElMessage.error(error.message || '提取视频帧失败') } finally { extractingPosition.value = '' } }

watch([prompt, model, creationMode, aspectRatio, duration, resolution, audioStrategy, keepOriginalAudio, audioVolume, audioFadeSeconds], scheduleSave)
watch(chosenAssets, scheduleSave, { deep: true })
onBeforeUnmount(() => { clearTimeout(saveTimer); saveCurrentShot(false).catch(() => {}) })
onMounted(async () => {
  try {
    if (isProjectMode.value) {
      const [media, caps, history, limits, boards, project] = await Promise.all([loadProjectScopedAssets(), omniVideoAPI.capabilities(), omniVideoAPI.list(), omniVideoAPI.uploadLimits(), dramaAPI.getStoryboards(projectEpisodeId.value), dramaAPI.get(projectDramaId.value)])
      const allAssets = await ensureProjectResourceAssets(project, media.items || [])
      assets.value = allAssets.filter(Boolean).map((item) => ({ ...item, alias: item.name, usage: item.type === 'image' ? 'reference' : item.type === 'video' ? 'motion' : 'ambience' }))
      capabilities.value = caps || []; uploadLimits.value = limits || null; jobs.value = (history || []).map(normalizeJob)
      sequence.value = { id: projectEpisodeId.value, name: `项目剧集 ${projectEpisodeId.value}` }
      const projectStoryboards = boards?.storyboards || []
      applyProjectVideoSources(projectStoryboards, await loadProjectVideos(projectStoryboards))
      if (shots.value[0]) loadShot(shots.value[0])
      return
    }
    const baseRequests = [loadAllAssets(), omniVideoAPI.capabilities(), omniVideoAPI.list(), omniVideoAPI.uploadLimits()]
    const sequenceRequest = route.query.sequence_id ? omniVideoAPI.getSequence(route.query.sequence_id) : omniVideoAPI.defaultSequence()
    const [media, caps, history, limits, seq] = await Promise.all([...baseRequests, sequenceRequest])
    assets.value = (media.items || []).filter((item) => item && Number.isFinite(Number(item.id))).map((item) => ({ ...item, alias: item.name, usage: item.type === 'image' ? 'reference' : item.type === 'video' ? 'motion' : 'ambience' }))
    capabilities.value = caps || []; uploadLimits.value = limits || null; jobs.value = (history || []).map(normalizeJob); sequence.value = seq; shots.value = seq.shots || []; if (shots.value[0]) loadShot(shots.value[0])
  } catch (error) { ElMessage.error(error.message || '全能创作工作台加载失败') }
})
onMounted(() => {
  // 媒体库的“用选中素材创作”会传递 assets=1,2,3；旧实现只识别单个
  // asset_id，导致批量带入这一条 P0 主链路表面可见但实际失效。
  const importedIds = [...new Set([
    Number(route.query.asset_id),
    ...String(route.query.assets || '').split(',').map((id) => Number(id)),
  ].filter((id) => Number.isInteger(id) && id > 0))]
  if (!importedIds.length) return
  const stop = watch(assets, (items) => {
    const imported = importedIds.map((id) => items.find((item) => Number(item.id) === id)).filter(Boolean)
    if (!imported.length) return
    let added = 0
    for (const asset of imported) {
      if (selected.value.has(asset.id)) continue
      const before = selected.value.size
      toggle(asset)
      if (selected.value.size > before) added++
    }
    if (added) ElMessage.success(`已将 ${added} 个素材带入当前镜头`)
    stop()
  }, { deep: true })
})
</script>

<style scoped>
.omni-page{height:100vh;overflow:hidden;background:#171d2d;color:#e7ebf5}.topbar{height:54px;box-sizing:border-box;padding:0 14px;display:flex;align-items:center;justify-content:space-between;background:#20273a;border-bottom:1px solid #323a50}.topbar-left,.topbar-actions{display:flex;align-items:center;gap:8px}.divider{height:26px;width:1px;background:#4a5266}.sequence-name{width:180px}.workbench{height:calc(100vh - 54px);display:grid;grid-template-columns:320px minmax(560px,1fr) 355px}.panel{min-width:0;background:#20273a;border-right:1px solid #333b50;padding:12px;box-sizing:border-box}.shot-panel{display:flex;flex-direction:column}.shot-heading{display:flex;justify-content:space-between;align-items:end}.shot-heading b{font-size:18px}.shot-heading small{color:#8993aa}.shot-actions{display:flex;gap:6px;margin:12px 0}.shot-actions .el-button{flex:1;margin:0}.shot-list{overflow:auto;display:grid;gap:9px;padding-right:3px}.shot-card{border:1px solid #30394e;border-radius:9px;padding:7px;background:#252d42;cursor:pointer}.shot-card.active{border-color:#6c8cff;box-shadow:0 0 0 1px #6c8cff}.shot-card.dragging{opacity:.5}.shot-title{height:28px;display:flex;align-items:center;gap:6px}.shot-title b{flex:1;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.drag-handle{cursor:grab;color:#7c879e}.shot-number{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#f2f4fa;color:#273148;font-weight:700}.shot-preview{position:relative;height:128px;border-radius:7px;overflow:hidden;background:#090d16}.shot-preview img,.shot-preview video{width:100%;height:100%;object-fit:cover}.shot-preview>span{position:absolute;right:7px;bottom:5px;font-size:12px}.shot-empty{height:100%;display:grid;place-items:center;font-size:34px;color:#55617a}.shot-state{margin-top:5px;font-size:11px;color:#919bb0}.shot-state i{display:inline-block;width:6px;height:6px;margin-right:5px;border-radius:50%;background:#7f899d}.shot-state.processing i{background:#e7a83b}.shot-state.completed i{background:#3dbb83}.shot-state.failed i,.shot-state.retryable i{background:#ee6d78}.center-stage{min-width:0;display:flex;flex-direction:column;background:#111621}.player-tools{height:44px;display:flex;align-items:center;padding:0 16px;border-bottom:1px solid #2f374a}.player-tools>span{flex:1}.video-stage{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#05070c;overflow:hidden}.main-video{width:100%;height:100%;object-fit:contain}.selected-mosaic{position:absolute;inset:8%;display:flex;justify-content:center;align-items:center;gap:8px;opacity:.44}.selected-mosaic img{width:17%;max-height:55%;object-fit:cover;border-radius:8px}.empty-play,.render-play{z-index:2;display:grid;place-items:center;width:76px;height:76px;border-radius:50%;background:#747b8bcc;font-size:27px}.video-stage b,.video-stage small,.video-stage .el-button{z-index:2}.stage-warning{z-index:2;font-size:48px;color:#ec6974}.render-ring{position:absolute;border:1px solid #6685f266;border-radius:50%}.ring-one{width:230px;height:230px;animation:spin 8s linear infinite}.ring-two{width:360px;height:360px;animation:spin 14s linear infinite reverse}.time-ruler{height:46px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;padding:0 16px;font-size:12px;color:#adb6c9;background:#171d2b}.time-ruler div{height:5px;background:#3a4256;border-radius:5px;overflow:hidden}.time-ruler i{display:block;height:100%;background:#6d8bff}.shot-tabs{height:42px;display:flex;align-items:center;gap:26px;padding:0 18px;background:#20273a;border-bottom:1px solid #343c50;font-size:13px;color:#96a0b5}.shot-tabs .active{color:#fff}.shot-script{padding:10px 16px 14px;background:#20273a}.creation-panel{border-left:1px solid #333b50;border-right:0;overflow:auto}.panel-title,.materials-title{display:flex;justify-content:space-between;align-items:center}.parameters{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}.parameters label{font-size:11px;color:#9ca7bc}.parameters .el-select{display:block;margin-top:5px}.materials-title{margin:13px 0 7px}.dropzone{height:46px;border:1px dashed #61708d;border-radius:7px;display:flex;align-items:center;justify-content:center;gap:7px;color:#9da8bd;cursor:pointer}.material-pool{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;max-height:150px;overflow:auto;margin:8px 0 12px}.material-card{position:relative;height:72px;border:1px solid #39435a;border-radius:6px;overflow:hidden;background:#161c2b;cursor:pointer}.material-card.selected{border-color:#6d8bff}.material-card img,.material-card video,.material-card>span{width:100%;height:50px;object-fit:cover;display:grid;place-items:center}.material-card small{display:block;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:10px}.material-card .el-icon{position:absolute;right:3px;top:3px;color:#7f9aff}.prompt-label{display:flex;justify-content:space-between;margin:8px 0 6px;font-size:13px}.prompt-label em{font-size:10px;color:#d25e67;font-style:normal}.selected-assets{display:grid;gap:5px;max-height:150px;overflow:auto;margin-top:8px}.selected-assets article{display:grid;grid-template-columns:auto minmax(70px,1fr) 120px auto;gap:5px;align-items:center;background:#293248;border-radius:6px;padding:4px}.selected-assets b{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.audio-options{display:grid;gap:6px;margin-top:8px}.generate-button{width:100%;margin-top:12px}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:1150px){.workbench{grid-template-columns:250px minmax(450px,1fr) 310px}}@media(max-width:850px){.omni-page{height:auto;overflow:auto}.workbench{height:auto;grid-template-columns:1fr}.shot-panel,.creation-panel{max-height:none}.center-stage{min-height:620px}.shot-list{grid-template-columns:repeat(2,1fr)}}
.mode-switch{display:flex;margin-top:10px}.mode-note{display:block;line-height:1.5;color:#a9b3c8;margin-top:6px}
/* 2026 工作台层级：中间成片优先，蓝/铜语义色，无紫色强调 */
.omni-page{background:#10151d;color:#f2f0ea}.topbar{height:58px;background:#181f29;border-color:#2d3947}.topbar .el-button{color:#bfcbd5}.workbench{grid-template-columns:260px minmax(680px,1fr) 320px}.panel{background:#181f29;border-color:#2d3947;padding:12px}.shot-heading b{font-size:16px}.shot-heading small{color:#8f9dab}.shot-actions .el-button{font-size:11px}.shot-card{border-color:#303d4b;background:#151b24;border-radius:8px}.shot-card.active{border-color:#4b91c8;box-shadow:0 0 0 1px #4b91c8;background:#1b2834}.shot-number{background:#dbe6ed;color:#173044}.shot-preview{height:112px}.shot-state{display:flex;align-items:center;gap:3px;color:#9facba}.shot-state.processing i{background:#d6a854}.shot-state.completed i{background:#4fa77a}.shot-state.failed i,.shot-state.retryable i{background:#d66b6b}.center-stage{background:#0c1118}.player-tools{height:48px;background:#151b24;border-color:#2d3947}.video-stage{background:#06090d}.selected-mosaic{opacity:.38}.empty-play,.render-play{background:#315e7b;color:#f2f0ea}.render-ring{border-color:#4b91c866}.time-ruler{background:#151b24;color:#aab4c0}.time-ruler div{background:#303d4b}.time-ruler i{background:#4b91c8}.shot-tabs{height:40px;background:#181f29;border-color:#2d3947;color:#9facba}.shot-tabs .active{color:#f2f0ea}.shot-script{padding:10px 16px 14px;background:#181f29}.creation-panel{border-left-color:#2d3947}.panel-title{padding-bottom:10px;border-bottom:1px solid #2d3947}.mode-switch{width:100%;margin:10px 0 0}.mode-switch :deep(.el-radio-button){flex:1}.mode-switch :deep(.el-radio-button__inner){width:100%;background:#151b24;border-color:#334050;color:#b9c5cf}.mode-switch :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner){background:#264b65;border-color:#4b91c8;color:#eff7fb;box-shadow:-1px 0 0 0 #4b91c8}.mode-note{padding:8px 9px;border-left:2px solid #c48a4a;background:#211d17;color:#cdbfa9}.advanced-settings{margin:10px 0;border:1px solid #303d4b;border-radius:7px;background:#151b24}.advanced-settings summary{padding:9px;cursor:pointer;color:#d3dbe1;font-size:12px}.advanced-settings summary span{display:block;margin-top:3px;color:#8f9dab;font-size:10px}.advanced-settings .parameters{padding:0 9px 9px;margin:0}.parameters label{color:#aab4c0}.materials-title{margin-top:15px}.dropzone{border-color:#526b80;background:#151b24;color:#aab4c0}.material-card{border-color:#303d4b;background:#111720}.material-card.selected{border-color:#4b91c8;box-shadow:inset 0 0 0 1px #4b91c8}.material-card .el-icon{color:#84bddd}.prompt-label em{color:#d6a854}.selected-assets article{background:#202b36}.identity-options{margin-top:8px;padding:8px;border:1px solid #3b4550;border-radius:7px;background:#151b24}.selection-limit-note,.upload-limit-note{display:block;margin-top:5px;color:#93a0af;line-height:1.45}.generate-button{margin-top:14px}.generate-button.el-button--primary{--el-button-bg-color:#4b91c8;--el-button-border-color:#4b91c8;--el-button-hover-bg-color:#5ba1d6;--el-button-hover-border-color:#5ba1d6}@media(max-width:1150px){.workbench{grid-template-columns:230px minmax(460px,1fr) 300px}}@media(max-width:850px){.workbench{grid-template-columns:1fr}.center-stage{order:-1;min-height:570px}.shot-panel{max-height:390px}.creation-panel{max-height:none}.shot-list{display:flex;overflow:auto}.shot-card{min-width:205px}.shot-preview{height:100px}}
/* 石墨工作台可读性：正文、说明与可编辑控件采用三档明确对比，避免灰字沉入深色背景。 */
.omni-page{background:#101010!important;color:#f3f1ec!important;--el-text-color-primary:#f3f1ec;--el-text-color-regular:#d5d2cb;--el-text-color-secondary:#bcb8b0;--el-text-color-placeholder:#96928a;--el-text-color-disabled:#7d7972;--el-border-color:#46443f;--el-border-color-light:#3d3b37;--el-fill-color-blank:#202020;--el-fill-color:#272727;--el-fill-color-light:#2d2d2d;--el-bg-color:#202020;--el-bg-color-overlay:#252525}.topbar{background:#181818!important;border-color:#484641!important}.panel{background:#181818!important;border-color:#484641!important}.center-stage{background:#101010!important}.player-tools,.shot-tabs,.shot-script{background:#1b1b1b!important;border-color:#484641!important}.shot-card{background:#202020!important;border-color:#45433f!important}.shot-card.active,.material-card.selected{border-color:#f0eee8!important;box-shadow:inset 2px 0 0 #f0eee8!important;background:#30302e!important}.shot-number{background:#f0eee8!important;color:#252525!important}.video-stage{background:#0c0c0c!important}.video-stage b{color:#f5f3ee!important}.video-stage small{color:#d1cec7!important}.time-ruler{background:#181818!important;color:#d4d1ca!important}.time-ruler div{background:#494742!important}.time-ruler i{background:#f0eee8!important}.shot-heading small,.shot-state,.shot-tabs,.parameters label,.selection-limit-note,.upload-limit-note{color:#c4c1ba!important}.shot-tabs .active,.panel-title b,.materials-title b,.shot-title b,.selected-assets b{color:#f3f1ec!important}.drag-handle{color:#c4c1ba!important}.mode-switch :deep(.el-radio-button__inner){background:#252525!important;border-color:#4a4843!important;color:#dedbd4!important}.omni-page :deep(.el-button--primary){--el-button-bg-color:#f0eee8!important;--el-button-border-color:#f0eee8!important;--el-button-text-color:#252525!important;--el-button-hover-bg-color:#fffdf7!important;--el-button-hover-border-color:#fffdf7!important;--el-color-primary:#f0eee8!important}.omni-page :deep(.el-button.is-text){color:#dedbd4!important}.omni-page :deep(.el-button.is-text:hover){background:#30302e!important;color:#fffdf7!important}.omni-page :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner){background:#f0eee8!important;border-color:#f0eee8!important;box-shadow:none!important;color:#252525!important}.omni-page :deep(.el-input__wrapper),.omni-page :deep(.el-select__wrapper),.omni-page :deep(.el-textarea__inner),.omni-page :deep(.el-input-number__decrease),.omni-page :deep(.el-input-number__increase){background:#292929!important;box-shadow:0 0 0 1px #55524c inset!important;color:#f3f1ec!important}.omni-page :deep(.el-input__inner),.omni-page :deep(.el-select__selected-item),.omni-page :deep(.el-textarea__inner){color:#f3f1ec!important}.omni-page :deep(.el-input__inner::placeholder),.omni-page :deep(.el-textarea__inner::placeholder){color:#aaa69e!important}.mode-note{border-left-color:#aaa69e!important;background:#292826!important;color:#e2dfd8!important}.advanced-settings,.identity-options{background:#222222!important;border-color:#4a4843!important}.advanced-settings summary,.advanced-settings summary span{color:#d8d5ce!important}.dropzone,.material-card{background:#1e1e1e!important;border-color:#4b4944!important;color:#d2cfc8!important}.dropzone:hover{background:#292826!important;border-color:#aaa69e!important}.selected-assets article{background:#2a2a28!important}.empty-play,.render-play{background:#353532!important;color:#f3f1ec!important}.render-ring{border-color:#f0eee866!important}.material-card .el-icon,.prompt-label em{color:#d1cec7!important}
/* SD2 认证为操作性信息，单独提升文字与状态对比度。 */
.identity-options{display:grid;gap:9px;padding:11px!important}.identity-heading{display:grid;gap:3px;padding-bottom:8px;border-bottom:1px solid #4a4843}.identity-heading b{color:#f5f3ee!important;font-size:13px}.identity-heading small,.identity-help{color:#c8c5be!important;line-height:1.45}.identity-row{display:grid;gap:4px}.identity-row :deep(.el-checkbox__label){color:#f0eee8!important;font-size:12px}.identity-status{display:flex;align-items:center;flex-wrap:wrap;gap:3px;color:#d8d5ce!important;line-height:1.4}.identity-status.is-active{color:#e8f1e9!important}.identity-status.is-processing{color:#f0e1bd!important}.identity-status.is-failed,.identity-status.is-invalid{color:#f1c6c3!important}.identity-status :deep(.el-button){margin-left:3px!important;color:#f3f1ec!important;text-decoration:underline;text-underline-offset:2px}
/* 音频后期控件：显式指定标签、滑杆与数字输入的前景色，避免默认灰色沉入深色面板。 */
.audio-options{color:#f3f1ec!important}
.audio-options :deep(.el-checkbox__label){color:#f3f1ec!important;font-size:12px}
.audio-options :deep(.el-checkbox__inner){background:#292929!important;border-color:#77736b!important}
.audio-options :deep(.el-checkbox.is-checked .el-checkbox__inner){background:#4b91c8!important;border-color:#4b91c8!important}
.audio-options :deep(.el-slider__runway){background:#4a4843!important}
.audio-options :deep(.el-slider__bar){background:#4b91c8!important}
.audio-options :deep(.el-slider__button){background:#f3f1ec!important;border-color:#4b91c8!important}
.audio-options :deep(.el-input-number){width:100%}
.audio-options :deep(.el-input-number .el-input__wrapper){background:#292929!important;box-shadow:0 0 0 1px #55524c inset!important}
.audio-options :deep(.el-input-number .el-input__inner){color:#f3f1ec!important}
.audio-options :deep(.el-input-number__decrease),.audio-options :deep(.el-input-number__increase){background:#292929!important;color:#d5d2cb!important;border-color:#55524c!important}
.generate-button.el-button--primary{background:#4b91c8!important;border-color:#4b91c8!important;color:#fff!important;box-shadow:0 2px 8px #0006}
.generate-button.el-button--primary:hover{background:#5ba1d6!important;border-color:#5ba1d6!important;color:#fff!important}
.generate-button.el-button--primary.is-disabled{background:#3d5262!important;border-color:#3d5262!important;color:#b8c1c7!important;box-shadow:none}
.generation-actions{display:grid;grid-template-columns:1fr 1.6fr;gap:7px;margin-top:14px}.generation-actions .generate-button{margin-top:0}
.identity-expired-warn{display:flex;align-items:flex-start;gap:7px;margin-top:10px;padding:8px 10px;border-radius:7px;background:#3a2a1c!important;border:1px solid #7a5430!important;color:#f0d9b5!important;font-size:12px;line-height:1.5}
.identity-expired-warn .el-icon{color:#e6a23c;font-size:15px;flex-shrink:0;margin-top:1px}.request-preview-note{margin:0 0 10px;color:#9ca7bc;font-size:13px}.request-preview{max-height:440px;margin:0;overflow:auto;padding:12px;border:1px solid #39435a;border-radius:7px;background:#111621;color:#dce6ff;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.55}.request-preview-actions{display:flex;gap:8px;margin-top:10px}.polish-suggestion{margin-top:12px;padding:10px;border:1px solid #39435a;border-radius:7px;background:#151b24;color:#dce6ff;font-size:12px}.polish-suggestion b{display:block;margin-bottom:6px}.polish-suggestion pre{margin:0;white-space:pre-wrap;word-break:break-word}
.frame-actions{position:absolute;right:14px;bottom:14px;z-index:8;display:flex;align-items:center;justify-content:flex-end;gap:6px;max-width:calc(100% - 28px);padding:7px 9px;border:1px solid #69655e;background:#181818e6;border-radius:7px;box-shadow:0 6px 18px #0008}.frame-actions .el-button{margin:0!important}.generation-history{display:grid;gap:7px;margin-top:12px;padding-top:10px;border-top:1px solid #45433f}.generation-history-head{display:flex;align-items:baseline;justify-content:space-between}.generation-history-head b{font-size:12px}.generation-history-head small,.generation-history-empty{margin:0;color:#aaa69e;font-size:11px}.generation-history-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.generation-history-item{position:relative;display:grid;grid-template-rows:92px auto;gap:5px;min-width:0;padding:4px;border:1px solid #4b4944;border-radius:6px;background:#202020;color:#dedbd4;text-align:left;cursor:pointer;font:inherit;overflow:hidden}.generation-history-item video,.history-video-empty{display:block;width:100%;height:92px;object-fit:cover;border-radius:4px;background:#0b0b0b}.history-video-empty{display:grid;place-items:center;color:#96928a;font-size:11px}.generation-history-item:hover,.generation-history-item.active{border-color:#f0eee8;background:#30302e}.generation-history-item.active{box-shadow:inset 0 0 0 1px #f0eee8}.history-card-meta{display:grid;gap:2px;min-width:0;padding:0 2px 2px}.history-card-meta b,.history-card-meta small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.history-card-meta b{font-size:10px}.history-card-meta small{color:#c4c1ba;font-size:10px}.history-dot{position:absolute;top:8px;right:8px;width:7px;height:7px;border:1px solid #111;border-radius:50%;background:#8b8983}.history-dot.completed{background:#7eae85}.history-dot.processing{background:#d6a854}.history-dot.failed,.history-dot.retryable{background:#d66b6b}@media(max-width:520px){.generation-history-grid{grid-template-columns:1fr}.frame-actions{right:8px;bottom:8px;gap:3px;padding:5px;flex-wrap:wrap}.frame-actions .el-button{font-size:11px}}
.asset-scope{width:92px;margin-right:4px}.material-card .asset-scope-label{position:absolute;left:3px;top:3px;padding:1px 3px;border-radius:3px;background:#111c;color:#dbe7f2;font-size:9px;font-style:normal;line-height:1.2}
/* 素材池以图片识别为主：两列大缩略图，避免四列小图难以判断内容。 */
.creation-panel .material-pool{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;max-height:330px;margin:10px 0 14px}
.creation-panel .material-card{height:128px;border-radius:8px}
.creation-panel .material-card img,.creation-panel .material-card video,.creation-panel .material-card>span{height:98px}
.creation-panel .material-card small{padding:5px 6px;font-size:12px;line-height:1.2}
.creation-panel .material-card .asset-scope-label{left:6px;top:6px;padding:2px 5px;font-size:10px}
/* 缩放与窄屏：三栏按可用宽度收缩，避免中间预览被固定最小宽度挤出视口。 */
.omni-page{min-width:0;min-height:100dvh}.topbar{min-width:0;gap:8px}.topbar-left,.topbar-actions{min-width:0}.topbar-left{overflow:hidden}.topbar-left>span{white-space:nowrap}.sequence-name{width:clamp(104px,14vw,180px);min-width:0}.workbench{width:100%;min-width:0;grid-template-columns:minmax(196px,260px) minmax(0,1fr) minmax(270px,320px)}.center-stage,.panel,.player-tools,.shot-tabs,.shot-script{min-width:0}.player-tools,.shot-tabs{overflow:hidden}.shot-tabs{gap:clamp(10px,2vw,26px);white-space:nowrap}.selected-assets article{grid-template-columns:auto minmax(0,1fr) minmax(92px,120px) auto}.selected-assets b{min-width:0}.material-pool{grid-template-columns:repeat(2,minmax(0,1fr))}
@media(max-width:1180px){.workbench{grid-template-columns:minmax(184px,22vw) minmax(0,1fr) minmax(244px,27vw)}.panel{padding:10px}.selected-assets article{grid-template-columns:auto minmax(0,1fr) 92px auto}.player-tools{padding:0 10px}.time-ruler{padding:0 10px}}
@media(max-width:960px){.workbench{grid-template-columns:minmax(176px,23vw) minmax(0,1fr) minmax(226px,29vw)}.shot-actions{gap:4px}.shot-actions .el-button{padding-left:5px;padding-right:5px}.shot-preview{height:94px}.material-pool{grid-template-columns:repeat(3,1fr)}.selected-assets article{grid-template-columns:auto minmax(0,1fr) auto}.selected-assets .el-select{grid-column:2 / -1}.prompt-label{gap:8px}.prompt-label em{max-width:55%;text-align:right}.time-ruler{font-size:11px}}
@media(max-width:760px){.omni-page{height:auto;overflow:auto}.topbar{height:auto;min-height:58px;flex-wrap:wrap;padding:8px 12px}.topbar-left{flex:1}.topbar-actions{margin-left:auto}.workbench{height:auto;grid-template-columns:minmax(0,1fr)}.center-stage{order:-1;min-height:500px}.shot-panel{max-height:380px}.creation-panel{max-height:none}.shot-list{display:flex;overflow:auto}.shot-card{min-width:190px}.shot-preview{height:100px}.shot-tabs,.player-tools{overflow:auto}.sequence-name{width:min(40vw,180px)}}
/* T0 创作输入优先：首屏先给提示词与参数留出稳定可编辑面积；播放器和分镜仅保留足够的预览与操作空间。 */
@media(min-width:761px){
  .workbench{grid-template-columns:minmax(196px,230px) minmax(0,1fr) minmax(292px,350px)}
  .video-stage{flex:0 0 clamp(185px,29vh,250px)}
  .shot-script{flex:1;min-height:214px;display:flex;align-items:stretch}
  .shot-script :deep(.editor){width:100%;min-height:188px;height:100%;display:flex;flex-direction:column}
  .shot-script :deep(.editor) :deep(.el-textarea){flex:1;min-height:0;display:flex}
  .shot-script :deep(.editor) :deep(.el-textarea__inner){flex:1;height:100%!important;min-height:180px;resize:none}
  .shot-preview{height:84px}
  .shot-card{padding:6px}
  .t0-generation-settings{position:relative;margin:12px 0 14px!important;padding:11px!important;border:1px solid #77736b!important;border-radius:8px;background:#242321!important;box-shadow:inset 3px 0 0 #f0eee8}
  .t0-settings-heading{display:flex!important;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:8px}
  .t0-settings-heading b{font-size:14px;color:#fffdf7!important}
  .t0-settings-heading small{font-size:11px;color:#d5d2cb!important}
}
/* 左侧分镜管理：统一纵向流自适应宽度，卡片宽度跟随面板，不出横向滚动条。 */
.shot-list{display:flex!important;flex-direction:column;gap:9px;overflow-y:auto;overflow-x:hidden}
.shot-card{width:100%;min-width:0!important;box-sizing:border-box}
.shot-card .shot-title{height:auto;min-height:28px;flex-wrap:nowrap;gap:3px}
.shot-card .shot-title>b{min-width:0}
.shot-controls{display:flex;align-items:center;flex:none;gap:0}
.shot-controls .el-button{margin:0;padding:3px 4px}
.shot-delete{flex:none;min-width:50px;margin-left:3px!important;padding:4px 6px!important;border-color:#b95d5d!important;background:#3a2022!important;color:#ffd1d1!important}
.shot-delete:hover,.shot-delete:focus-visible{border-color:#f09b9b!important;background:#592b2f!important;color:#fff1f1!important}
.asset-name{display:grid;min-width:0;gap:2px}.asset-name b{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.asset-route-hint{font-size:10px;line-height:1.3;color:var(--text-muted,#aab4c0);white-space:normal}
@media(max-width:760px){.shot-list{display:flex!important;flex-direction:column;overflow-y:auto;overflow-x:hidden}.shot-card{min-width:0!important;width:100%}}
/* 首尾帧强制占位框：高亮、必填强调、filled 态展示缩略图。 */
.frame-slots{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0 4px}
.frame-slot{position:relative;height:120px;border:2px dashed #6b6862;border-radius:9px;overflow:hidden;cursor:pointer;background:#1e1e1e;display:flex;align-items:center;justify-content:center;transition:border-color .15s,background .15s}
.frame-slot:hover{border-color:#aaa69e;background:#292826}
.frame-slot.filled{border-style:solid;border-color:#f0eee8}
.frame-slot.required:not(.filled){border-color:#d6a854;background:#26221a}
.frame-slot.required:not(.filled):hover{border-color:#e6bd6e;background:#2e2a1f}
.frame-slot img{width:100%;height:100%;object-fit:cover}
.frame-empty{display:flex;flex-direction:column;align-items:center;gap:4px;color:#bcb8b0}
.frame-empty .el-icon{font-size:26px;color:#8f8d86}
.frame-label{font-size:13px;color:#dedbd4}
.frame-label .req{color:#d6a854;font-style:normal;margin-left:2px}
.frame-empty small{font-size:10px;color:#96928a}
.frame-tag{position:absolute;left:6px;top:6px;font-size:10px;padding:1px 6px;border-radius:4px;background:#3a3733;color:#c4c1ba}
.frame-tag.req{background:#5a4622;color:#e6bd6e}
.frame-clear{position:absolute;right:3px;top:3px;background:#00000080!important;color:#f3f1ec!important}
.frame-picker-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;max-height:380px;overflow:auto}
.frame-picker-card{border:2px solid #4a4843;border-radius:7px;overflow:hidden;cursor:pointer;background:#1e1e1e}
.frame-picker-card.active{border-color:#f0eee8;box-shadow:0 0 0 1px #f0eee8}
.frame-picker-card img{width:100%;height:72px;object-fit:cover;display:block}
.frame-picker-card small{display:block;padding:3px 4px;font-size:10px;color:#c4c1ba;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.frame-picker-empty{padding:30px 0;text-align:center;color:#96928a}
.project-storyboard-page{height:auto!important;min-height:720px!important;background:#10151d!important;color:#f2f0ea!important}.project-storyboard-page .workbench{height:min(820px,calc(100dvh - 120px));min-height:620px;grid-template-columns:minmax(280px,320px) minmax(0,1fr) minmax(250px,290px)!important;gap:0;border:1px solid #334050;border-radius:10px;overflow:hidden;box-shadow:0 16px 42px #0003}.project-storyboard-page .creation-panel{grid-column:1;grid-row:1;border-left:0;border-right:1px solid #334050;background:#181f29!important;overflow-y:auto}.project-storyboard-page .center-stage{grid-column:2;grid-row:1;background:#10151d!important;min-height:0}.project-storyboard-page .shot-panel{grid-column:3;grid-row:1;border-left:1px solid #334050;border-right:0;background:#181f29!important;min-height:0;overflow:hidden}.project-storyboard-page .shot-list{min-height:0;overflow-y:auto!important;overflow-x:hidden;padding-right:3px}.project-storyboard-page .panel,.project-storyboard-page .player-tools,.project-storyboard-page .shot-tabs,.project-storyboard-page .shot-script,.project-storyboard-page .time-ruler{background:#181f29!important;border-color:#334050!important;color:#f2f0ea!important}.project-storyboard-page .video-stage{background:#0b1016!important}.project-storyboard-page .material-card,.project-storyboard-page .shot-card{background:#151b24!important;border-color:#303d4b!important}.project-storyboard-page .shot-card.active,.project-storyboard-page .material-card.selected{border-color:#f5f5f5!important;box-shadow:inset 2px 0 0 #f5f5f5!important;background:#222!important}.project-storyboard-page .shot-title b,.project-storyboard-page .panel-title b,.project-storyboard-page .materials-title b{color:#f2f0ea!important}.project-storyboard-page .shot-state,.project-storyboard-page .parameters label,.project-storyboard-page .selection-limit-note,.project-storyboard-page .upload-limit-note,.project-storyboard-page .materials-title small{color:#aab4c0!important}.project-storyboard-page .mode-switch :deep(.el-radio-button__inner),.project-storyboard-page :deep(.el-input__wrapper),.project-storyboard-page :deep(.el-select__wrapper),.project-storyboard-page :deep(.el-textarea__inner){background:#151b24!important;color:#f2f0ea!important;box-shadow:0 0 0 1px #3c4958 inset!important}.project-storyboard-page :deep(.el-button--primary){--el-button-bg-color:#f5f5f5!important;--el-button-border-color:#f5f5f5!important;--el-button-text-color:#111!important;--el-button-hover-bg-color:#d4d4d4!important;--el-button-hover-border-color:#d4d4d4!important}.project-storyboard-page .mode-note{background:#202934!important;border-left-color:#aab4c0!important;color:#d6dde4!important}.project-storyboard-page .shot-delete{margin-left:auto!important;color:#f09b9b!important}.project-storyboard-page .shot-delete:hover{background:#4a252a!important;color:#ffd4d4!important}@media(max-width:960px){.project-storyboard-page .workbench{height:auto;grid-template-columns:minmax(220px,34vw) minmax(0,1fr)!important}.project-storyboard-page .creation-panel{grid-column:1;grid-row:1 / span 2}.project-storyboard-page .center-stage{grid-column:2;grid-row:1}.project-storyboard-page .shot-panel{grid-column:2;grid-row:2;border-left:0;border-top:1px solid #334050}}@media(max-width:720px){.project-storyboard-page .workbench{display:flex;flex-direction:column}.project-storyboard-page .creation-panel,.project-storyboard-page .center-stage,.project-storyboard-page .shot-panel{width:100%;border:0;border-bottom:1px solid #334050}}
/* 嵌入模式：滚动停留在工作台所属栏内，不能在栏滚到底后继续带动项目页面。
   否则分镜列表或素材栏的上下滚轮会让整个工作台离开可视区，打断当前编辑。 */
.omni-page.embedded.project-storyboard-page{position:sticky!important;top:58px;z-index:20;height:calc(100dvh - 58px)!important;min-height:520px!important;overflow:hidden!important}
.omni-page.embedded.project-storyboard-page .workbench{height:100%!important;min-height:0!important}
.omni-page.embedded.project-storyboard-page .shot-list,
.omni-page.embedded.project-storyboard-page .creation-panel,
.omni-page.embedded.project-storyboard-page .material-pool,
.omni-page.embedded.project-storyboard-page .selected-assets,
.omni-page.embedded.project-storyboard-page .frame-picker-grid{overscroll-behavior-y:contain;scrollbar-gutter:stable}
.creation-generate-dock{position:sticky;top:0;z-index:12;display:grid;gap:8px;margin:12px -2px 14px;padding:10px;border:1px solid #69655e;border-radius:8px;background:#181818f2;box-shadow:0 6px 18px #0006;backdrop-filter:blur(8px)}.creation-generate-summary{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.creation-generate-summary b{color:#f5f3ee;font-size:13px}.creation-generate-summary small{color:#c4c1ba;font-size:11px;white-space:nowrap}.creation-generate-actions{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.5fr);gap:7px}.creation-generate-actions .generate-button{margin:0!important;min-width:0}.project-storyboard-page .creation-generate-dock{top:-1px;background:#181f29f5;border-color:#3c4958}.project-storyboard-page .creation-generate-summary b{color:#f2f0ea}.project-storyboard-page .creation-generate-summary small{color:#aab4c0}@media(max-width:720px){.creation-generate-dock{position:sticky;top:0;margin-left:0;margin-right:0}.creation-generate-summary{align-items:flex-start;flex-direction:column;gap:3px}.creation-generate-summary small{white-space:normal}}
@media(max-width:960px){.omni-page.embedded.project-storyboard-page{position:static!important;height:auto!important;min-height:0!important;overflow:visible!important}.omni-page.embedded.project-storyboard-page .workbench{height:auto!important;min-height:520px}}
.t0-generation-settings{display:grid;gap:10px;margin:12px -2px 14px;padding:12px;border:1px solid #88837a;border-radius:8px;background:#252525}.t0-settings-heading{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.t0-settings-heading b{font-size:14px;color:#f5f3ee}.t0-settings-heading small{font-size:11px;color:#c4c1ba}.center-stage{grid-template-rows:42px minmax(170px,.8fr) 42px 38px minmax(235px,1fr)}.shot-script{min-height:235px;border-top:2px solid #88837a}.project-storyboard-page .t0-generation-settings{background:#202934;border-color:#506174}.project-storyboard-page .t0-settings-heading b{color:#f2f0ea}.project-storyboard-page .t0-settings-heading small{color:#aab4c0}@media(max-width:760px){.center-stage{grid-template-rows:42px minmax(200px,.8fr) 42px 38px minmax(260px,1fr)}.t0-settings-heading{align-items:flex-start;flex-direction:column;gap:3px}}
</style>
