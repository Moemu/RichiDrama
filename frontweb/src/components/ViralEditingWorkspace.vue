<template>
  <section class="viral-workspace">
    <div class="section-header">
      <h3 class="section-title">投流素材（爆款剪辑）</h3>
      <span class="section-count">多集输入 → 多条投流成片 + 镜头评级</span>
    </div>
    <p v-if="!ready" class="notice">LAS 服务尚未配置完成。请管理员在「AI 配置 · 视频本地化（LAS）」中启用并配置 API Key 与同地域 TOS Bucket（该配置与投流剪辑共用）。</p>
    <div class="viral-layout">
      <div class="panel setup-panel">
        <h4>新建剪辑任务</h4>
        <p class="sub">选择已归档的剧集视频并按顺序排列（第一个即第 1 集）；输入需携带内嵌字幕，否则高光识别可能失效。</p>
        <div class="picker">
          <div class="picker-col">
            <p class="col-label">项目视频素材</p>
            <label v-for="video in availableVideos" :key="video.id" class="video-row">
              <input type="checkbox" :checked="isSelected(video.id)" @change="toggleVideo(video)" />
              <span class="name">{{ video.name }}</span><span class="meta">{{ viralDurationText(video.duration * 1000) }}</span>
            </label>
            <p v-if="!videos.length" class="empty">暂无已归档视频，请先在「制作资源 · 媒体」上传或归档剧集。</p>
          </div>
          <div class="picker-col">
            <p class="col-label">剪辑顺序（{{ selected.length }}/{{ MAX_EPISODES }} 集）</p>
            <div v-for="(episode, index) in selected" :key="episode.id" class="video-row ordered">
              <span class="seq">{{ index + 1 }}</span><span class="name">{{ episode.name }}</span>
              <span class="order-actions">
                <button type="button" title="上移" :disabled="index === 0" @click="move(index, 'up')">↑</button>
                <button type="button" title="下移" :disabled="index === selected.length - 1" @click="move(index, 'down')">↓</button>
                <button type="button" title="移除" @click="toggleVideo(episode)">✕</button>
              </span>
            </div>
          </div>
        </div>
        <div class="params">
          <label class="field">
            <span class="field-top">剪辑策略</span>
            <select v-model="params.mode"><option value="sequential">顺剪（叙事完整）</option><option value="jump_cut">跳剪（保留高光）</option></select>
          </label>
          <label class="field">
            <span class="field-top">目标条数<small>（实际产出可能更少）</small></span>
            <input v-model.number="params.max_clip_count" type="number" min="1" :max="MAX_CLIP_COUNT" />
          </label>
          <label class="field">
            <span class="field-top">单条时长（秒）</span>
            <span class="range"><input v-model.number="params.min_clip_duration" type="number" min="5" :max="MAX_CLIP_SECONDS" aria-label="单条最短时长" /><span class="dash">–</span><input v-model.number="params.max_clip_duration" type="number" :min="params.min_clip_duration || 5" :max="MAX_CLIP_SECONDS" aria-label="单条最长时长" /></span>
          </label>
          <label class="field">
            <span class="field-top">输出画幅</span>
            <select v-model="params.aspect_ratio"><option :value="null">跟随输入</option><option value="9:16">统一竖屏 9:16（横屏补黑边）</option></select>
          </label>
          <label class="field">
            <span class="field-top">精彩前置<small>（部分成片开头补高光）</small></span>
            <span class="switch"><input id="viral-preset-intro" v-model="params.preset_intro" type="checkbox" /><span>{{ params.preset_intro ? '已启用' : '未启用' }}</span></span>
          </label>
        </div>
        <div class="estimate" aria-live="polite">
          <p v-if="quoting" class="calc">正在按实测素材时长计算预估费用…</p>
          <template v-else-if="quote">
            <p class="amount"><strong>{{ quote.amount }}</strong> 积分<small>（冻结上限）</small></p>
            <p class="breakdown">输入 {{ viralDurationText(quote.totals.total_input_ms) }} 按分析价计费；输出预留 {{ params.max_clip_count }} 条 × ≤{{ params.max_clip_duration }} 秒按合成价计费；完成后按实测输出时长结算，差额自动释放。</p>
          </template>
          <p v-else-if="quoteError" class="error-text">报价失败：{{ quoteError }} <button type="button" class="link" @click="loadQuote">重试</button></p>
          <p v-else class="empty">{{ selected.length ? '参数已更新，稍候…' : '勾选剧集后将自动计算预估费用' }}</p>
        </div>
        <button type="button" class="primary" :disabled="!ready || !quote || submitting" @click="submit">{{ submitting ? '提交中…' : '确认费用并提交' }}</button>
      </div>
      <div class="panel jobs-panel">
        <h4>任务与成片<small>{{ jobs.length }} 个</small></h4>
        <p v-if="!jobs.length" class="empty">还没有投流剪辑任务。</p>
        <article v-for="job in jobs" :key="job.id" class="job">
          <div class="job-top">
            <div><strong>{{ viralModeName(job.params.mode) }} · 目标 {{ job.params.max_clip_count }} 条 × ≤{{ job.params.max_clip_duration }} 秒<template v-if="job.params.preset_intro"> · 精彩前置</template></strong>
              <p>{{ formatChinaDateTime(job.created_at) }} · 输入 {{ job.episodes.length }} 集（{{ job.episodes.map((episode) => episode.asset_name || `#${episode.asset_id}`).join('、') }}）<a v-if="job.storyboard_url" class="storyboard-link" :href="job.storyboard_url" download>分镜数据 ↧</a></p>
            </div>
            <span :class="['status', job.status]">{{ viralStatusName(job.status) }}</span>
          </div>
          <p v-if="viralBillingText(job)" class="billing">{{ viralBillingText(job) }}</p>
          <p v-if="job.error_msg" class="error-text">{{ job.error_msg }}</p>
          <p v-if="job.status === 'reconciliation'" class="billing">已转待对账，不会自动重复调用供应商；运营核验用量后更新。</p>
          <div v-if="job.status === 'completed' && job.outputs.length" class="clips">
            <div v-for="output in job.outputs" :key="output.clip_index" class="clip">
              <video v-if="output.url" :src="output.url" controls preload="metadata" />
              <div class="clip-meta">
                <p class="clip-line"><strong>成片 #{{ output.clip_index }}</strong><span class="spec">{{ viralDurationText(output.duration_ms) }} · {{ output.width }}×{{ output.height }}<template v-if="output.file_size"> · {{ Math.round(output.file_size / 1024 / 1024) }} MB</template></span></p>
                <p class="grades">
                  <span v-for="chip in viralGradeChips(output.rating_summary)" :key="chip.grade" :class="['grade', `grade-${chip.grade}`]">{{ chip.grade }} ×{{ chip.count }}</span>
                  <span v-if="output.rating_summary.avg_highlight_score != null" class="grade-avg">精彩度均分 {{ output.rating_summary.avg_highlight_score }}</span>
                </p>
                <p v-if="output.rating_summary.top_tags?.length" class="tags"><span v-for="tag in output.rating_summary.top_tags.slice(0, 4)" :key="tag" class="tag-chip">{{ tag }}</span></p>
                <div class="timeline-strip" title="色块=分镜评级（S/A/B/C），半透明段为精彩前置复制；悬停查看剧情" :aria-label="`片段时间线，共 ${output.timeline.length} 段`">
                  <span v-for="(segment, segmentIndex) in viralTimelineSegments(output.timeline)" :key="`${output.clip_index}-${segmentIndex}`" :class="['seg', segment.rating && `r-${segment.rating}`, segment.is_intro_dup && 'intro']" :title="`${segment.ref} ${segment.content_desc}`" :style="{ flexGrow: Math.max(segment.end - segment.start, 0.2) }" />
                </div>
                <p class="actions">
                  <a v-if="output.url" :href="output.url" download>下载 ↧</a>
                  <button v-if="output.status !== 'saved'" type="button" :disabled="!canEdit" @click="saveAsset(job, output)">保存为素材</button>
                  <span v-else class="saved">已存为「{{ output.asset_name }}」</span>
                </p>
              </div>
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { viralEditJobsAPI } from '@/api/viralEditJobs'
import { lasMediaJobsAPI } from '@/api/lasMediaJobs'
import { createClientRequestId } from '@/utils/requestId'
import { formatChinaDateTime } from '@/utils/time'
import { moveViralEpisode, viralBillingText, viralDurationText, viralGradeChips, viralModeName, viralStatusName, viralTimelineSegments } from '@/utils/viralEditing'

const MAX_EPISODES = 10
const MAX_CLIP_COUNT = 10
const MAX_CLIP_SECONDS = 300

const props = defineProps({ dramaId: { type: [Number, String], required: true }, canEdit: { type: Boolean, default: true } })

const videos = ref([])
const jobs = ref([])
const selected = ref([])
const ready = ref(false)
const quoting = ref(false)
const submitting = ref(false)
const quote = ref(null)
const quoteError = ref('')
let pendingKey = ''
let timer
let quoteTimer
let quoteVersion = 0
const params = ref({ mode: 'sequential', max_clip_count: 5, min_clip_duration: 60, max_clip_duration: 180, preset_intro: false, aspect_ratio: null })

const availableVideos = computed(() => videos.value)
const isSelected = (id) => selected.value.some((episode) => String(episode.id) === String(id))
function toggleVideo(video) {
  const index = selected.value.findIndex((episode) => String(episode.id) === String(video.id))
  if (index >= 0) selected.value.splice(index, 1)
  else {
    if (selected.value.length >= MAX_EPISODES) { ElMessage.warning(`MVP 阶段单次最多 ${MAX_EPISODES} 集`); return }
    selected.value.push(video)
  }
}
function move(index, direction) { selected.value = moveViralEpisode(selected.value, index, direction) }
async function loadAll() {
  if (!props.dramaId) return
  try {
    const [assets, history] = await Promise.all([viralEditJobsAPI.videos(props.dramaId), viralEditJobsAPI.list(props.dramaId)])
    videos.value = (assets?.items || []).filter((asset) => asset.local_path)
    jobs.value = history || []
    const visible = new Set(videos.value.map((video) => String(video.id)))
    selected.value = selected.value.filter((episode) => visible.has(String(episode.id)))
  } catch (error) { ElMessage.error(error.message) }
}
async function refreshJobs() {
  try { jobs.value = await viralEditJobsAPI.list(props.dramaId) || [] } catch (_) {}
}
function currentBody() {
  return {
    drama_id: Number(props.dramaId),
    asset_ids: selected.value.map((episode) => Number(episode.id)),
    ...params.value,
  }
}
async function loadQuote() {
  if (!selected.value.length) { quote.value = null; quoteError.value = ''; return }
  const version = ++quoteVersion
  quoting.value = true
  quoteError.value = ''
  quote.value = null
  try {
    const result = await viralEditJobsAPI.quote(currentBody())
    if (version !== quoteVersion) return
    // 后端载荷是 { episodes, totals, params, quote }；拍平让 amount 与 totals 同级可绑定
    quote.value = result ? { ...result.quote, totals: result.totals, episodes: result.episodes } : null
  } catch (error) { if (version === quoteVersion) { quote.value = null; quoteError.value = error.message } }
  finally { if (version === quoteVersion) quoting.value = false }
}
// 报价自动计算：勾选剧集或调整参数后防抖重算，用户不需要手动点「报价」按钮。
function scheduleQuote() {
  clearTimeout(quoteTimer)
  ++quoteVersion
  quoting.value = false
  quote.value = null
  quoteError.value = ''
  pendingKey = ''
  if (selected.value.length) quoteTimer = setTimeout(loadQuote, 400)
}
async function submit() {
  if (!quote.value) return
  try {
    await ElMessageBox.confirm(`本次预授权约 ${quote.value.amount} 积分（冻结上限），完成后按实际输出时长结算。确认提交投流剪辑任务？`, '确认付费调用', { type: 'warning', confirmButtonText: '确认提交', cancelButtonText: '取消' })
  } catch (_) { return }
  submitting.value = true
  if (!pendingKey) pendingKey = createClientRequestId()
  try {
    await viralEditJobsAPI.create({ ...currentBody(), idempotency_key: pendingKey })
    pendingKey = ''
    await refreshJobs()
    scheduleQuote()
    ElMessage.success('任务已提交')
  } catch (error) { ElMessage.error(error.message) }
  finally { submitting.value = false }
}
async function saveAsset(job, output) {
  try {
    const result = await viralEditJobsAPI.saveAsset(job.id, output.clip_index)
    output.asset_id = result.output.asset_id
    output.status = result.output.status
    output.asset_name = result.output.asset_name
    ElMessage.success('已保存为项目素材')
  } catch (error) { ElMessage.error(error.message) }
}
watch(() => [selected.value.map((episode) => String(episode.id)).join(','), params.value.mode, params.value.max_clip_count, params.value.min_clip_duration, params.value.max_clip_duration, params.value.aspect_ratio, params.value.preset_intro], scheduleQuote)
onMounted(async () => {
  ready.value = !!(await lasMediaJobsAPI.capabilities().then((result) => result?.ready).catch(() => false))
  await loadAll()
  timer = setInterval(refreshJobs, 15000)
})
onUnmounted(() => { clearInterval(timer); clearTimeout(quoteTimer) })
</script>

<style scoped>
.viral-workspace{padding:4px 0}
.section-header{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.section-title{margin:0;font-size:18px}.section-count{color:var(--text-muted);font-size:12px}
.notice{margin:0 0 14px;padding:12px 14px;border:1px solid var(--border-strong);border-radius:8px;color:var(--text-regular);font-size:13px;line-height:1.6}
.viral-layout{display:grid;grid-template-columns:minmax(340px,1fr) minmax(0,1.2fr);gap:16px;align-items:start}
.panel{min-width:0;padding:18px 20px;border:1px solid var(--border-subtle);border-radius:12px;background:var(--bg-surface)}
.panel h4{margin:0 0 4px;font-size:15px}.panel h4 small{margin-left:8px;color:var(--text-muted);font-weight:400}
.sub{margin:0 0 12px;color:var(--text-muted);font-size:12px;line-height:1.6}
.picker{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:14px}
.col-label{margin:0 0 6px;color:var(--text-faint);font-size:12px}
.picker-col{min-width:0;max-height:260px;overflow:auto;border:1px solid var(--border-subtle);border-radius:8px;padding:10px}
.video-row{display:flex;align-items:center;gap:8px;min-width:0;padding:5px 0;font-size:13px}
.video-row .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.video-row .meta{color:var(--text-faint);font-size:12px;flex:0 0 auto}
.seq{width:18px;flex:0 0 auto;color:var(--accent-teal);font-weight:700;font-size:12px;text-align:center}
.order-actions{display:flex;gap:4px;flex:0 0 auto}
.order-actions button{border:1px solid var(--border-strong);border-radius:5px;background:var(--bg-raised);color:var(--text-regular);font-size:11px;line-height:1;padding:3px 6px;cursor:pointer}
.order-actions button:disabled{opacity:.4;cursor:not-allowed}
.params{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px 14px;margin-bottom:12px}
.params .field{display:grid;align-content:start;gap:6px;min-width:0}
.params .field-top{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;font-size:12px;color:var(--text-muted)}
.params .field-top small{color:var(--text-faint);font-weight:400}
.params select,.params input[type=number]{width:100%;box-sizing:border-box;min-height:34px;padding:5px 8px;border:1px solid var(--border-strong);border-radius:7px;background:var(--bg-raised);color:var(--text-primary);font:inherit;font-size:13px}
.params .range{display:flex;align-items:center;gap:6px}.params .range input{width:100%;min-width:0}.params .dash{color:var(--text-faint);flex:0 0 auto}
.params .switch{display:flex;align-items:center;gap:8px;min-height:34px;font-size:13px;color:var(--text-primary)}
.params .switch input{width:16px;height:16px;accent-color:var(--accent);flex:0 0 auto}
.estimate{margin:4px 0 12px;padding:12px 14px;border:1px solid var(--border-subtle);border-radius:8px;background:var(--bg-raised);display:grid;gap:6px}
.estimate .amount{margin:0;display:flex;align-items:baseline;gap:4px;flex-wrap:wrap}
.estimate .amount strong{font-size:22px}
.estimate .amount small{color:var(--text-faint);font-weight:400}
.estimate .breakdown,.estimate .calc,.estimate .empty{margin:0;font-size:12px;line-height:1.6;color:var(--text-muted)}
.estimate .link{border:0;background:transparent;color:var(--accent);font:inherit;font-size:12px;text-decoration:underline;cursor:pointer;padding:0}
.error-text{margin:0;color:var(--el-color-warning);font-size:12px;line-height:1.5;overflow-wrap:anywhere}
.primary{width:100%;min-height:42px;border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:var(--bg-page);font:inherit;font-weight:700;cursor:pointer}
.primary:disabled{cursor:not-allowed;opacity:.5}
.jobs-panel{max-height:none}
.job{margin-top:12px;padding:14px;border:1px solid var(--border-subtle);border-radius:10px;background:var(--bg-raised)}
.job-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.job-top>div{min-width:0}.job-top strong{font-size:14px}.job-top p{margin:5px 0 0;color:var(--text-muted);font-size:12px;line-height:1.5;overflow-wrap:anywhere}
.status{flex:0 0 auto;padding:4px 9px;border-radius:999px;background:var(--bg-active);color:var(--text-regular);font-size:12px;white-space:nowrap}
.status.completed{color:var(--accent-teal)}.status.failed,.status.reconciliation{color:var(--el-color-warning)}
.billing{margin:9px 0 0;color:var(--text-muted);font-size:12px;line-height:1.5}
.clips{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr));gap:12px;margin-top:12px}
.clip{border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden;background:var(--bg-surface);min-width:0}
.clip video{display:block;width:100%;max-height:300px;background:#080d14}
.clip-meta{padding:10px 12px;display:grid;gap:8px}
.clip-line{margin:0;display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:13px}
.clip-line .spec{color:var(--text-muted);font-size:12px}
.grades{margin:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.grades .grade{padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;line-height:1.6}
.grades .grade-S{background:color-mix(in srgb,var(--el-color-danger) 16%,transparent);color:var(--el-color-danger)}
.grades .grade-A{background:color-mix(in srgb,var(--el-color-warning) 16%,transparent);color:var(--el-color-warning)}
.grades .grade-B{background:color-mix(in srgb,var(--accent-teal) 14%,transparent);color:var(--accent-teal)}
.grades .grade-C{background:var(--bg-active);color:var(--text-muted)}
.grades .grade-avg{color:var(--text-faint);font-size:11px}
.tags{margin:0;display:flex;gap:6px;flex-wrap:wrap}
.tags .tag-chip{padding:2px 8px;border:1px solid var(--border-subtle);border-radius:999px;color:var(--text-muted);font-size:11px;line-height:1.6}
.timeline-strip{display:flex;gap:2px;height:8px;border-radius:4px;overflow:hidden;background:var(--bg-active)}
.timeline-strip .seg{min-width:3px;background:var(--border-strong)}.timeline-strip .seg.r-S{background:var(--el-color-danger)}.timeline-strip .seg.r-A{background:var(--el-color-warning)}.timeline-strip .seg.r-B{background:var(--accent-teal)}.timeline-strip .seg.intro{opacity:.65}
.actions{margin:0;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.actions a,.actions button{border:0;background:transparent;color:var(--accent);font:inherit;font-size:12px;text-decoration:none;cursor:pointer;padding:0}
.actions .saved{color:var(--text-faint)}
.storyboard-link{margin-left:8px;color:var(--accent);font-size:12px}
.empty{color:var(--text-faint);font-size:12px}
button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media(max-width:1100px){.viral-layout{grid-template-columns:1fr}}
</style>
