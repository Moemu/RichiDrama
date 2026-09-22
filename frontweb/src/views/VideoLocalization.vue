<template>
  <main class="localization-page">
    <header class="page-head">
      <button type="button" class="back" @click="$router.push('/ai-tools')">← 返回工具箱</button>
      <div class="heading"><p>LAS · 视频工作流</p><h1>视频本地化</h1><span>先清理原字幕，再制作多语言版本。每一步独立计费，完成后存入项目素材库。</span></div>
    </header>

    <div class="page-body">
      <section class="panel setup" aria-labelledby="setup-title">
        <div class="section-title"><span>01 / 新建任务</span><h2 id="setup-title">选择素材与处理方式</h2></div>
        <p v-if="!ready" class="notice" role="status">LAS 服务尚未配置完成。请由管理员配置 API Key 和同地域 TOS Bucket 及受限读写凭证。</p>
        <label>项目
          <select v-model="dramaId" @change="loadProject"><option value="">选择项目</option><option v-for="project in projects" :key="project.id" :value="String(project.id)">{{ project.title }}</option></select>
        </label>
        <label>视频素材
          <select v-model="assetId" @change="clearQuote"><option value="">选择已归档的视频</option><option v-for="asset in videos" :key="asset.id" :value="String(asset.id)">{{ asset.name }} · {{ durationText(asset.duration) }}</option></select>
        </label>
        <label>处理方式
          <select v-model="stage" @change="clearQuote"><option value="inpaint">擦除原字幕</option><option value="translate">翻译配音</option></select>
        </label>
        <label v-if="stage === 'inpaint'">擦除档位
          <select v-model="modelLevel" @change="clearQuote"><option value="lite">快速版</option><option value="pro">专业版</option></select>
        </label>
        <label v-else>目标语言
          <select v-model="outputLanguage" @change="clearQuote"><option value="en-US">英语</option><option value="ja-JP">日语</option><option value="ko-KR">韩语</option><option value="es-MX">西班牙语</option><option value="pt-BR">葡萄牙语</option><option value="id-ID">印尼语</option><option value="th-TH">泰语</option><option value="vi-VN">越南语</option><option value="fr-FR">法语</option><option value="de-DE">德语</option></select>
        </label>
        <div class="estimate"><span>本阶段预估</span><strong>{{ quote ? `${quote.amount} 积分` : '待报价' }}</strong><small>实际扣费以完成后的计费快照为准。</small></div>
        <div class="actions"><button type="button" class="secondary" :disabled="!assetId || quoting" @click="loadQuote">{{ quoting ? '报价中…' : '查看报价' }}</button><button type="button" class="primary" :disabled="!ready || !quote || submitting" @click="submit">{{ submitting ? '提交中…' : '确认并提交' }}</button></div>
        <p class="hint">仅支持已本地归档、5GB 以内、1080p／30fps 以内的视频。翻译须带音轨且至少 10 秒。</p>
      </section>

      <section class="panel history" aria-labelledby="history-title">
        <div class="section-title"><span>02 / 项目记录</span><h2 id="history-title">处理进度</h2></div>
        <p v-if="!dramaId" class="empty">先选择项目，查看处理记录。</p>
        <p v-else-if="!jobs.length" class="empty">这个项目还没有视频本地化任务。</p>
        <article v-for="job in jobs" :key="job.id" class="job">
          <div class="job-top"><strong>{{ job.stage === 'inpaint' ? '字幕擦除' : `翻译 · ${languageName(job.input.output_language)}` }}</strong><span :class="['status', job.status]">{{ statusName(job.status) }}</span></div>
          <p>源素材 #{{ job.source_asset_id }} <span>·</span> {{ formatChinaDateTime(job.created_at) }}</p>
          <p v-if="job.error_msg" class="error">{{ job.error_msg }}</p>
          <div v-if="job.status === 'completed'" class="job-actions"><button type="button" @click="$router.push(`/media-library?scope=project&drama_id=${job.drama_id}`)">查看成片 ↗</button><a v-if="job.caption_url" :href="job.caption_url" download>下载字幕 ↧</a><button v-if="job.stage === 'inpaint'" type="button" @click="continueTranslation(job)">用成片继续翻译 →</button></div>
          <p v-else-if="job.status === 'reconciliation'" class="reconcile">任务已转待对账，不会自动重复调用供应商。</p>
        </article>
      </section>
    </div>
  </main>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { dramaAPI } from '@/api/drama'
import { lasMediaJobsAPI } from '@/api/lasMediaJobs'
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
const submitting = ref(false)
const pendingKey = ref('')
let timer

const selectedAsset = computed(() => videos.value.find((asset) => String(asset.id) === assetId.value))
const model = computed(() => stage.value === 'translate' ? 'las-video-translate' : `las-video-inpaint-${modelLevel.value}`)
const languageName = (code) => ({ 'en-US': '英语', 'ja-JP': '日语', 'ko-KR': '韩语', 'es-MX': '西班牙语', 'pt-BR': '葡萄牙语', 'id-ID': '印尼语', 'th-TH': '泰语', 'vi-VN': '越南语', 'fr-FR': '法语', 'de-DE': '德语' })[code] || code
const statusName = (status) => ({ queued: '排队中', submitting: '提交中', processing: '处理中', finalizing: '归档中', completed: '已完成', failed: '失败', reconciliation: '待对账' })[status] || status
const durationText = (seconds) => Number.isFinite(Number(seconds)) ? `${Math.ceil(Number(seconds))} 秒` : '时长未知'

function clearQuote() { quote.value = null; pendingKey.value = '' }
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
async function loadQuote() {
  const duration = Number(selectedAsset.value?.duration)
  if (!Number.isFinite(duration) || duration <= 0) { ElMessage.warning('素材时长不可用，请选择已归档的视频'); return }
  quoting.value = true
  quote.value = null
  try { quote.value = await lasMediaJobsAPI.quote(model.value, Math.ceil(duration * 1000)) }
  catch (error) { ElMessage.error(error.message) }
  finally { quoting.value = false }
}
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
  timer = setInterval(refreshJobs, 15000)
})
onUnmounted(() => clearInterval(timer))
</script>

<style scoped>
.localization-page{min-height:100vh;padding:clamp(20px,3vw,48px);background:var(--bg-page);color:var(--text-primary)}.page-head,.page-body{max-width:1320px;margin:auto}.back{padding:0 0 7px;border:0;border-bottom:1px solid var(--border-strong);background:transparent;color:var(--text-muted);cursor:pointer}.heading{padding:36px 0 38px}.heading p,.section-title span{color:var(--accent-teal);font-size:12px;font-weight:700;letter-spacing:.14em}.heading h1{margin:6px 0 9px;font-size:clamp(34px,4vw,58px);line-height:1.05}.heading>span{color:var(--text-muted);line-height:1.6}.page-body{display:grid;grid-template-columns:minmax(360px,.85fr) minmax(0,1.15fr);gap:20px;align-items:start}.panel{min-width:0;padding:clamp(20px,2.5vw,32px);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);background:var(--bg-surface);box-shadow:var(--shadow-sm)}.section-title{margin-bottom:24px}.section-title h2{margin:8px 0 0;font-size:22px}.setup label{display:block;margin:0 0 18px;color:var(--text-regular);font-size:13px;font-weight:600}.setup select{display:block;width:100%;min-height:44px;margin-top:8px;padding:8px 12px;border:1px solid var(--border-strong);border-radius:8px;background:var(--bg-raised);color:var(--text-primary);font:inherit}.notice{padding:13px 15px;border:1px solid var(--border-strong);border-radius:8px;color:var(--text-regular);line-height:1.6}.estimate{display:grid;grid-template-columns:1fr auto;gap:4px;margin-top:24px;padding:18px 0;border-top:1px solid var(--border-subtle);border-bottom:1px solid var(--border-subtle)}.estimate span{color:var(--text-muted)}.estimate strong{font-size:21px}.estimate small{grid-column:1/-1;color:var(--text-faint)}.actions{display:flex;gap:10px;margin-top:20px}.actions button{flex:1;min-height:44px;border-radius:8px;font-weight:700;cursor:pointer}.actions button:disabled{cursor:not-allowed;opacity:.5}.secondary{border:1px solid var(--border-strong);background:transparent;color:var(--text-primary)}.primary{border:1px solid var(--accent);background:var(--accent);color:var(--bg-page)}.hint,.empty{color:var(--text-muted);font-size:13px;line-height:1.6}.job{padding:18px 0;border-top:1px solid var(--border-subtle)}.job-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.job-top strong{font-size:16px}.status{padding:5px 10px;border-radius:999px;background:var(--bg-active);color:var(--text-regular);font-size:12px;white-space:nowrap}.status.completed{color:var(--accent-teal)}.status.failed,.status.reconciliation{color:var(--el-color-warning)}.job p{margin:9px 0 0;color:var(--text-muted);font-size:12px}.job p span{padding:0 4px}.job .error{color:var(--el-color-warning)}.job-actions{display:flex;flex-wrap:wrap;gap:14px;margin-top:15px}.job-actions button,.job-actions a{padding:0 0 5px;border:0;border-bottom:1px solid var(--accent);background:transparent;color:var(--accent);font:inherit;font-size:13px;text-decoration:none;cursor:pointer}.job .reconcile{color:var(--el-color-warning)}@media(max-width:900px){.page-body{grid-template-columns:1fr}.heading{padding:30px 0}.panel{padding:20px}}@media(max-width:480px){.localization-page{padding:16px}.actions{flex-direction:column}.heading h1{font-size:36px}.job-top{align-items:flex-start}}
</style>
