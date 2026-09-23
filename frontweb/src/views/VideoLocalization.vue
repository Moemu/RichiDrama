<template>
  <main class="localization-page">
    <header class="page-head">
      <button type="button" class="back" @click="$router.push('/ai-tools')">← 返回工具箱</button>
      <div class="heading"><p>LAS · 视频工作流</p><h1>视频本地化</h1><span>选取项目视频，擦除原字幕或制作译制版。成片可在这里预览，也会保存到项目素材库。</span></div>
    </header>

    <div class="page-body">
      <section class="panel setup" aria-labelledby="setup-title">
        <div class="section-title"><span>01 / 新建任务</span><h2 id="setup-title">准备视频</h2><p>每次只处理一个阶段。选择后会自动计算预估费用。</p></div>
        <p v-if="!ready" class="notice" role="status">LAS 服务尚未配置完成。请由管理员配置 API Key 和同地域 TOS Bucket 及受限读写凭证。</p>
        <label>项目
          <select v-model="dramaId" @change="loadProject"><option value="">选择项目</option><option v-for="project in projects" :key="project.id" :value="String(project.id)">{{ project.title }}</option></select>
        </label>
        <label>视频素材
          <select v-model="assetId" @change="clearQuote"><option value="">选择已归档的视频</option><option v-for="asset in videos" :key="asset.id" :value="String(asset.id)">{{ asset.name }} · {{ durationText(asset.duration) }}</option></select>
        </label>
        <div class="upload-row">
          <input ref="uploadInput" type="file" accept="video/mp4,video/*" style="display:none" @change="onUpload" />
          <button type="button" class="upload" :disabled="!dramaId || uploading" @click="triggerUpload">{{ uploading ? '上传中…' : '＋ 上传本地视频' }}</button>
          <span class="upload-hint">{{ uploadHint }}</span>
        </div>
        <div class="stage-picker" role="group" aria-label="处理方式">
          <button type="button" :class="{ selected: stage === 'inpaint' }" :aria-pressed="stage === 'inpaint'" @click="stage = 'inpaint'">擦除原字幕<small>去除画面中的原字幕</small></button>
          <button type="button" :class="{ selected: stage === 'translate' }" :aria-pressed="stage === 'translate'" @click="stage = 'translate'">翻译配音<small>制作目标语言版本</small></button>
        </div>
        <label v-if="stage === 'inpaint'">擦除档位
          <select v-model="modelLevel" @change="clearQuote"><option value="lite">快速版</option><option value="pro">专业版</option></select>
        </label>
        <label v-else>目标语言
          <select v-model="outputLanguage" @change="clearQuote"><option value="en-US">英语</option><option value="ja-JP">日语</option><option value="ko-KR">韩语</option><option value="es-MX">西班牙语</option><option value="pt-BR">葡萄牙语</option><option value="id-ID">印尼语</option><option value="th-TH">泰语</option><option value="vi-VN">越南语</option><option value="fr-FR">法语</option><option value="de-DE">德语</option></select>
        </label>
        <div class="estimate" aria-live="polite"><div><span>本阶段预估</span><strong>{{ quoting ? '计算中…' : quote ? `${quote.amount} 积分` : quoteError ? '暂不可报价' : '选择视频后自动计算' }}</strong></div><small v-if="quoteError" class="quote-error">{{ quoteError }} <button type="button" @click="loadQuote">重试</button></small><small v-else>提交前会再次确认；实际扣费以完成后的计费快照为准。</small></div>
        <div class="actions"><button type="button" class="primary" :disabled="!ready || !quote || quoting || submitting" @click="submit">{{ submitting ? '提交中…' : '确认费用并提交任务 →' }}</button></div>
        <p class="hint">仅支持已本地归档、5GB 以内、1080p／30fps 以内的视频。翻译须带音轨且至少 10 秒。</p>
      </section>

      <section class="panel history" aria-labelledby="history-title">
        <div class="section-title"><span>02 / 项目记录</span><h2 id="history-title">处理进度与成片</h2><p>完成后可直接预览；刷新页面也能继续查看。</p></div>
        <p v-if="!dramaId" class="empty">先选择项目，查看处理记录。</p>
        <p v-else-if="!jobs.length" class="empty">这个项目还没有视频本地化任务。</p>
        <article v-for="job in jobs" :key="job.id" class="job">
          <div class="job-top"><div><strong>{{ job.stage === 'inpaint' ? '字幕擦除' : `翻译 · ${languageName(job.input.output_language)}` }}</strong><p>{{ formatChinaDateTime(job.created_at) }} · 源视频 {{ job.source_asset_name || `#${job.source_asset_id}` }}<template v-if="job.output_asset_name"> → 成片 {{ job.output_asset_name }}</template></p></div><span :class="['status', job.status]">{{ statusName(job.status) }}</span></div>
          <p v-if="billingText(job)" class="billing">{{ billingText(job) }}</p>
          <p v-if="job.error_msg" class="error">{{ job.error_msg }}</p>
          <div v-if="job.status === 'completed'" class="job-actions"><button type="button" class="preview-action" @click="openPreview(job)">▶ 预览成片</button><button v-if="job.stage === 'inpaint'" type="button" @click="continueTranslation(job)">用成片继续翻译 →</button><a v-if="job.caption_url" :href="job.caption_url" download>下载字幕 ↧</a></div>
          <p v-else-if="job.status === 'reconciliation'" class="reconcile">任务已转待对账，不会自动重复调用供应商；运营核验用量后这里会更新为最终结果。</p>
          <div v-else-if="job.status === 'failed'" class="job-actions"><button type="button" @click="retryJob(job)">按原参数重新提交 →</button><span class="retry-hint">将创建新任务并重新预授权{{ job.billing?.state === 'released' ? '；上次冻结已释放' : '' }}</span></div>
        </article>
      </section>
    </div>
    <el-dialog :model-value="!!previewJobId" title="成片预览" width="min(960px, 94vw)" append-to-body destroy-on-close @update:model-value="value => { if (!value) closePreview() }">
      <div class="result-preview" v-loading="previewLoading">
        <p v-if="previewError" role="alert">{{ previewError }} <button type="button" @click="openPreview(previewJob)">重试</button></p>
        <video v-else-if="previewVideoUrl" :src="previewVideoUrl" controls playsinline preload="metadata" @error="previewError = '成片播放失败，请检查本地文件是否仍可访问'" />
      </div>
      <template v-if="previewVideoUrl" #footer><a :href="previewVideoUrl" download>下载成片</a></template>
    </el-dialog>
  </main>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { dramaAPI } from '@/api/drama'
import { lasMediaJobsAPI } from '@/api/lasMediaJobs'
import { omniVideoAPI } from '@/api/omniVideo'
import { createClientRequestId } from '@/utils/requestId'
import { formatChinaDateTime } from '@/utils/time'

const projects = ref([])
const videos = ref([])
const jobs = ref([])
const ready = ref(false)
const dramaId = ref('')
const assetId = ref('')
const stage = ref('inpaint')
const modelLevel = ref('lite')
const outputLanguage = ref('en-US')
const quote = ref(null)
const quoting = ref(false)
const quoteError = ref('')
const submitting = ref(false)
const pendingKey = ref('')
const uploadInput = ref(null)
const uploading = ref(false)
const uploadLimitMb = ref(0)
const previewJob = ref(null)
const previewJobId = computed(() => previewJob.value?.id || '')
const previewAsset = ref(null)
const previewLoading = ref(false)
const previewError = ref('')
const previewVideoUrl = computed(() => previewAsset.value?.local_path ? `/static/${String(previewAsset.value.local_path).replace(/^\/+/, '')}` : '')
let timer
let quoteTimer
let quoteVersion = 0
let previewVersion = 0

const selectedAsset = computed(() => videos.value.find((asset) => String(asset.id) === assetId.value))
const model = computed(() => stage.value === 'translate' ? 'las-video-translate' : `las-video-inpaint-${modelLevel.value}`)
const languageName = (code) => ({ 'en-US': '英语', 'ja-JP': '日语', 'ko-KR': '韩语', 'es-MX': '西班牙语', 'pt-BR': '葡萄牙语', 'id-ID': '印尼语', 'th-TH': '泰语', 'vi-VN': '越南语', 'fr-FR': '法语', 'de-DE': '德语' })[code] || code
const statusName = (status) => ({ queued: '排队中', submitting: '提交中', processing: '处理中', finalizing: '归档中', completed: '已完成', failed: '失败', reconciliation: '待对账' })[status] || status
const durationText = (seconds) => Number.isFinite(Number(seconds)) ? `${Math.ceil(Number(seconds))} 秒` : '时长未知'
const creditsText = (value) => Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 10000) / 10000} 积分` : ''
function billingText(job) {
  const billing = job.billing
  if (!billing) return ''
  if (billing.state === 'settled') return billing.charged_credits != null ? `实际扣费 ${creditsText(billing.charged_credits)}（按供应商实测用量结算）` : '已结算'
  if (billing.state === 'reconciling') return `对账中：${creditsText(billing.reserved_credits)}冻结中，等待运营核验用量`
  if (billing.state === 'released') return '预授权已释放，未扣费'
  return billing.reserved_credits != null ? `预授权 ${creditsText(billing.reserved_credits)}，完成后按实际用量结算` : ''
}
function retryJob(job) {
  stage.value = job.stage
  if (job.stage === 'inpaint') modelLevel.value = job.input.model_level || 'lite'
  else outputLanguage.value = job.input.output_language || 'en-US'
  if (videos.value.some((asset) => String(asset.id) === String(job.source_asset_id))) assetId.value = String(job.source_asset_id)
  document.querySelector('.setup')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
const uploadHint = computed(() => !dramaId.value
  ? '先选择项目，上传的视频会归档为该项目素材'
  : `上传后自动归档为项目素材并选中；单文件${uploadLimitMb.value ? ` ≤ ${uploadLimitMb.value}MB` : '大小以平台上传限制为准'}`)

function clearQuote() { quote.value = null; quoteError.value = ''; pendingKey.value = ''; ++quoteVersion; clearTimeout(quoteTimer) }
async function loadProject() {
  assetId.value = ''
  clearQuote()
  videos.value = []
  jobs.value = []
  if (!dramaId.value) return
  try {
    const [assets, history] = await Promise.all([lasMediaJobsAPI.videos(dramaId.value), lasMediaJobsAPI.list(dramaId.value)])
    videos.value = assets?.items || []
    jobs.value = history || []
  } catch (error) { ElMessage.error(error.message) }
}
async function refreshJobs() {
  if (!dramaId.value) return
  try {
    const history = await lasMediaJobsAPI.list(dramaId.value)
    if (history?.some((job) => job.status === 'completed' && !jobs.value.some((old) => old.id === job.id && old.status === 'completed'))) {
      const assets = await lasMediaJobsAPI.videos(dramaId.value)
      videos.value = assets?.items || []
    }
    jobs.value = history || []
  } catch (_) {}
}
// 与素材库共用同一条上传路径（POST /media/upload → 本地归档 + 项目素材登记）：
// LAS 只接受已本地归档（有 local_path）的项目视频，所以本地环境缺素材时在这里补传即可。
function triggerUpload() { if (!dramaId.value) return; uploadInput.value?.click() }
async function onUpload(event) {
  const file = (event.target.files || [])[0]
  event.target.value = ''
  if (!file || !dramaId.value) return
  if (!file.type.startsWith('video/')) { ElMessage.warning('请选择视频文件'); return }
  if (uploadLimitMb.value > 0 && file.size > uploadLimitMb.value * 1024 * 1024) { ElMessage.warning(`文件超过 ${uploadLimitMb.value}MB 上传限制`); return }
  uploading.value = true
  try {
    const payload = await omniVideoAPI.upload(file, { drama_id: dramaId.value })
    const asset = payload?.asset || payload
    const assets = await lasMediaJobsAPI.videos(dramaId.value)
    videos.value = assets?.items || []
    if (asset?.id && videos.value.some((item) => String(item.id) === String(asset.id))) assetId.value = String(asset.id)
    clearQuote()
    ElMessage.success(`${file.name} 已上传并归档为项目素材`)
  } catch (error) { ElMessage.error(error.message) }
  finally { uploading.value = false }
}
async function loadQuote() {
  const version = ++quoteVersion
  const duration = Number(selectedAsset.value?.duration)
  if (!Number.isFinite(duration) || duration <= 0) { quoteError.value = '素材时长不可用，请选择已归档的视频'; return }
  quoting.value = true
  quote.value = null
  quoteError.value = ''
  try {
    const result = await lasMediaJobsAPI.quote(model.value, Math.ceil(duration * 1000))
    if (version === quoteVersion) quote.value = result
  } catch (error) { if (version === quoteVersion) quoteError.value = error.message || '报价失败' }
  finally { if (version === quoteVersion) quoting.value = false }
}
// 目标语言虽不改变模型，但 clearQuote 会清空报价；不在依赖里就会出现
// 「切换语言后报价永不重算、提交按钮永久禁用」。stage 同 reason 一并监听。
watch([dramaId, assetId, model, outputLanguage, stage], () => {
  clearQuote()
  quoting.value = false
  if (dramaId.value && selectedAsset.value) quoteTimer = setTimeout(loadQuote, 250)
})
async function openPreview(job) {
  if (!job?.output_asset_id) { ElMessage.error('成片素材不存在'); return }
  const version = ++previewVersion
  previewJob.value = job
  previewAsset.value = null
  previewError.value = ''
  previewLoading.value = true
  try {
    const asset = await omniVideoAPI.getAsset(job.output_asset_id)
    if (version !== previewVersion) return
    if (!asset?.local_path || asset.type !== 'video') throw new Error('成片尚无可播放的本地文件')
    previewAsset.value = asset
  } catch (error) { if (version === previewVersion) previewError.value = error.message || '成片加载失败' }
  finally { if (version === previewVersion) previewLoading.value = false }
}
function closePreview() { ++previewVersion; previewJob.value = null; previewAsset.value = null; previewError.value = '' }
async function submit() {
  if (!quote.value || !selectedAsset.value) return
  try { await ElMessageBox.confirm(`本阶段预授权约 ${quote.value.amount} 积分。确认提交 ${stage.value === 'inpaint' ? '字幕擦除' : '翻译配音'}任务？`, '确认付费调用', { type: 'warning', confirmButtonText: '确认提交', cancelButtonText: '取消' }) }
  catch (_) { return }
  submitting.value = true
  if (!pendingKey.value) pendingKey.value = createClientRequestId()
  try {
    await lasMediaJobsAPI.create({ drama_id: Number(dramaId.value), asset_id: Number(assetId.value), stage: stage.value, model_level: modelLevel.value, output_language: outputLanguage.value, idempotency_key: pendingKey.value })
    pendingKey.value = ''
    quote.value = null
    await refreshJobs()
    loadQuote()
    ElMessage.success('任务已提交')
  } catch (error) { ElMessage.error(error.message) }
  finally { submitting.value = false }
}
async function continueTranslation(job) {
  stage.value = 'translate'
  await loadProject()
  assetId.value = String(job.output_asset_id)
  clearQuote()
  document.querySelector('.setup')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
onMounted(async () => {
  try {
    const [capabilities, response] = await Promise.all([lasMediaJobsAPI.capabilities(), dramaAPI.list({ page_size: 100 })])
    ready.value = !!capabilities?.ready
    projects.value = response?.items || response || []
  } catch (error) { ElMessage.error(error.message) }
  omniVideoAPI.uploadLimits().then((limits) => { uploadLimitMb.value = Number(limits?.files?.video?.max_mb || 0) }).catch(() => {})
  timer = setInterval(refreshJobs, 15000)
})
onUnmounted(() => { clearInterval(timer); clearTimeout(quoteTimer); ++quoteVersion; ++previewVersion })
</script>

<style scoped>
.localization-page{min-height:100vh;padding:clamp(20px,3vw,48px);background:var(--bg-page);color:var(--text-primary)}
.page-head,.page-body{max-width:1320px;margin-inline:auto}
.back{padding:0 0 7px;border:0;border-bottom:1px solid var(--border-strong);background:transparent;color:var(--text-muted);cursor:pointer}
.heading{padding:30px 0 34px}.heading p,.section-title span{margin:0;color:var(--accent-teal);font-size:12px;font-weight:700;letter-spacing:.12em}.heading h1{margin:7px 0 9px;font-size:clamp(34px,4vw,54px);line-height:1.08}.heading>span{color:var(--text-muted);line-height:1.6}
.page-body{display:grid;grid-template-columns:minmax(350px,.82fr) minmax(0,1.18fr);gap:20px;align-items:start}
.panel{min-width:0;padding:clamp(20px,2.5vw,32px);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);background:var(--bg-surface);box-shadow:var(--shadow-sm)}
.section-title{margin-bottom:23px}.section-title h2{margin:7px 0 5px;font-size:22px}.section-title p{margin:0;color:var(--text-muted);font-size:13px;line-height:1.5}
.setup label{display:block;margin:0 0 18px;color:var(--text-regular);font-size:13px;font-weight:600}.setup select{display:block;width:100%;min-height:44px;margin-top:8px;padding:8px 12px;border:1px solid var(--border-strong);border-radius:8px;background:var(--bg-raised);color:var(--text-primary);font:inherit}
.notice{padding:13px 15px;border:1px solid var(--border-strong);border-radius:8px;color:var(--text-regular);line-height:1.6}
.upload-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:-6px 0 20px}.upload-row .upload{min-height:36px;padding:0 14px;border:1px dashed var(--border-strong);border-radius:8px;background:var(--bg-raised);color:var(--text-primary);font:inherit;font-size:13px;cursor:pointer}.upload-row .upload:disabled{cursor:not-allowed;opacity:.5}.upload-hint{flex:1;min-width:12rem;color:var(--text-faint);font-size:12px;line-height:1.5}
.stage-picker{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:0 0 20px}.stage-picker button{display:grid;gap:6px;min-width:0;min-height:72px;padding:13px;border:1px solid var(--border-strong);border-radius:10px;background:var(--bg-raised);color:var(--text-primary);font:inherit;font-weight:700;text-align:left;cursor:pointer}.stage-picker button.selected{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--bg-raised))}.stage-picker small{color:var(--text-muted);font-size:11px;font-weight:400;line-height:1.4}
.estimate{display:grid;gap:9px;margin-top:22px;padding:18px;border:1px solid var(--border-subtle);border-radius:10px;background:var(--bg-raised)}.estimate>div{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.estimate span{color:var(--text-muted);font-size:13px}.estimate strong{font-size:21px;text-align:right}.estimate small{color:var(--text-faint);line-height:1.5}.estimate .quote-error{color:var(--el-color-warning)}.quote-error button{border:0;background:transparent;color:var(--accent);text-decoration:underline;cursor:pointer}
.actions{display:flex;margin-top:14px}.actions button{flex:1;min-height:46px;border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:var(--bg-page);font:inherit;font-weight:700;cursor:pointer}.actions button:disabled{cursor:not-allowed;opacity:.5}.hint,.empty{color:var(--text-muted);font-size:13px;line-height:1.6}
.job{margin-top:12px;padding:17px;border:1px solid var(--border-subtle);border-radius:11px;background:var(--bg-raised)}.job-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.job-top>div{min-width:0}.job-top strong{font-size:16px}.job-top p{margin:6px 0 0;color:var(--text-muted);font-size:12px}.status{flex:0 0 auto;padding:5px 10px;border-radius:999px;background:var(--bg-active);color:var(--text-regular);font-size:12px;white-space:nowrap}.status.completed{color:var(--accent-teal)}.status.failed,.status.reconciliation{color:var(--el-color-warning)}.job>.error,.job>.reconcile{margin:12px 0 0;color:var(--el-color-warning);font-size:12px;line-height:1.5;overflow-wrap:anywhere}
.job>.billing{margin:10px 0 0;color:var(--text-muted);font-size:12px;line-height:1.5}.retry-hint{color:var(--text-faint);font-size:12px}
.job-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;margin-top:15px}.job-actions button,.job-actions a{padding:5px 0;border:0;background:transparent;color:var(--accent);font:inherit;font-size:13px;text-decoration:none;cursor:pointer}.job-actions .preview-action{padding:8px 12px;border:1px solid var(--accent);border-radius:7px;font-weight:700}.result-preview{display:grid;place-items:center;min-height:240px;background:#080d14}.result-preview video{display:block;max-width:100%;max-height:68vh}.result-preview p{padding:20px;color:var(--el-color-danger);text-align:center}.result-preview button{border:0;background:transparent;color:var(--accent);cursor:pointer}
button:focus-visible,a:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media(max-width:900px){.page-body{grid-template-columns:1fr}.panel{padding:20px}}@media(max-width:480px){.localization-page{padding:16px}.heading h1{font-size:36px}.job-top{align-items:flex-start}.estimate>div{align-items:flex-start;flex-direction:column}.estimate strong{text-align:left}}
</style>
