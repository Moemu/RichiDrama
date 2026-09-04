<template>
  <main class="history-detail-page">
    <header class="detail-header">
      <el-button text class="back-button" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
      <div>
        <p class="eyebrow">VIDEO GENERATION</p>
        <h1>生成记录详情</h1>
        <p v-if="detail">视频记录 #{{ detail.id }}<span v-if="detail.omni_job_id"> · 全能任务 #{{ detail.omni_job_id }}</span></p>
      </div>
      <el-tag v-if="detail" :type="statusType(detail.status)" effect="dark">{{ statusLabel(detail.status) }}</el-tag>
    </header>

    <el-skeleton v-if="loading" :rows="10" animated class="detail-loading" />
    <el-result v-else-if="error" icon="error" title="无法读取生成记录" :sub-title="error">
      <template #extra><el-button type="primary" @click="loadDetail">重新加载</el-button></template>
    </el-result>

    <template v-else-if="detail">
      <section v-if="detail.output?.video_url" class="detail-card result-card">
        <div class="section-heading"><div><span>生成结果</span><h2>视频预览</h2></div><small>{{ outputSize }}</small></div>
        <video :src="detail.output.video_url" :poster="mediaUrl(detail.output.poster_local_path)" controls preload="metadata" />
      </section>

      <section class="detail-card prompt-card">
        <div class="section-heading">
          <div><span>PROMPT</span><h2>提示词</h2></div>
          <el-button :icon="CopyDocument" @click="copyPrompt(detail.original_prompt)">复制原始提示词</el-button>
        </div>
        <article class="prompt-block primary-prompt">
          <b>原始提示词</b>
          <small>用户提交或失败任务快照中保存的原文</small>
          <pre>{{ detail.original_prompt || '未保存原始提示词' }}</pre>
        </article>
        <article v-if="showProviderPrompt" class="prompt-block provider-prompt">
          <b>模型实际接收的提示词</b>
          <small>系统加入素材引用约束后的内容</small>
          <pre>{{ detail.provider_prompt }}</pre>
        </article>
        <article v-if="detail.negative_prompt" class="prompt-block">
          <b>负向提示词</b><pre>{{ detail.negative_prompt }}</pre>
        </article>
      </section>

      <div class="detail-grid">
        <section class="detail-card">
          <div class="section-heading"><div><span>REQUEST</span><h2>生成参数</h2></div></div>
          <dl class="fact-list">
            <div><dt>请求模型</dt><dd>{{ value(detail.request.model_requested) }}</dd></div>
            <div><dt>实际模型</dt><dd>{{ value(detail.request.model_resolved) }}</dd></div>
            <div><dt>供应商</dt><dd>{{ value(detail.request.provider) }}</dd></div>
            <div><dt>创作模式</dt><dd>{{ creationMode(detail.request.creation_mode) }}</dd></div>
            <div><dt>时长</dt><dd>{{ unit(detail.request.duration, '秒') }}</dd></div>
            <div><dt>画幅</dt><dd>{{ value(detail.request.aspect_ratio) }}</dd></div>
            <div><dt>请求分辨率</dt><dd>{{ value(detail.request.resolution) }}</dd></div>
            <div><dt>目标超分</dt><dd>{{ value(detail.request.upscale_resolution) }}</dd></div>
            <div><dt>目标帧率</dt><dd>{{ unit(detail.request.target_fps, 'fps') }}</dd></div>
            <div><dt>音频策略</dt><dd>{{ audioStrategy(detail.request.audio_strategy) }}</dd></div>
            <div><dt>素材选择</dt><dd>{{ assetPolicy(detail.request.asset_selection_policy) }}</dd></div>
          </dl>
        </section>

        <section class="detail-card">
          <div class="section-heading"><div><span>OUTPUT</span><h2>输出信息</h2></div></div>
          <dl class="fact-list">
            <div><dt>输出分辨率</dt><dd>{{ value(detail.output.resolution) }}</dd></div>
            <div><dt>像素尺寸</dt><dd>{{ pixelSize }}</dd></div>
            <div><dt>实际帧率</dt><dd>{{ unit(detail.output.fps, 'fps') }}</dd></div>
            <div><dt>实际时长</dt><dd>{{ outputDuration }}</dd></div>
            <div><dt>超分状态</dt><dd>{{ value(detail.output.upscale_status) }}</dd></div>
            <div><dt>插帧状态</dt><dd>{{ value(detail.output.interpolation_status) }}</dd></div>
            <div><dt>本地文件</dt><dd>{{ detail.output.persisted_locally ? '已保存' : '无本地文件' }}</dd></div>
            <div><dt>归档状态</dt><dd>{{ value(detail.output.archive_status) }}</dd></div>
          </dl>
          <p v-if="detail.output.archive_error" class="inline-error">{{ detail.output.archive_error }}</p>
        </section>

        <section class="detail-card">
          <div class="section-heading"><div><span>BILLING</span><h2>计费信息</h2></div></div>
          <dl class="fact-list">
            <div><dt>计费状态</dt><dd>{{ billingStatus(detail.billing.status) }}</dd></div>
            <div><dt>实际扣费</dt><dd class="points">{{ detail.billing.actual_points == null ? '暂无结算记录' : `${formatNumber(detail.billing.actual_points, 4)} 积分` }}</dd></div>
            <div><dt>预授权 ID</dt><dd class="break-value">{{ value(detail.billing.authorization_id) }}</dd></div>
            <div><dt>供应商请求 ID</dt><dd class="break-value">{{ value(detail.billing.provider_request_id) }}</dd></div>
            <div><dt>结算时间</dt><dd>{{ formatTime(detail.billing.settled_at) }}</dd></div>
          </dl>
          <details v-if="detail.billing.usage || detail.billing.price_snapshot" class="json-details">
            <summary>查看用量与计费快照</summary>
            <pre>{{ prettyJson({ usage: detail.billing.usage, price_snapshot: detail.billing.price_snapshot }) }}</pre>
          </details>
        </section>

        <section class="detail-card">
          <div class="section-heading"><div><span>TASK</span><h2>任务信息</h2></div></div>
          <dl class="fact-list">
            <div><dt>本地任务 ID</dt><dd class="break-value">{{ value(detail.task.id) }}</dd></div>
            <div><dt>供应商任务 ID</dt><dd class="break-value">{{ value(detail.task.provider_task_id) }}</dd></div>
            <div><dt>任务进度</dt><dd>{{ detail.task.progress == null ? '—' : `${detail.task.progress}%` }}</dd></div>
            <div><dt>任务消息</dt><dd>{{ value(detail.task.message) }}</dd></div>
            <div><dt>创建时间</dt><dd>{{ formatTime(detail.created_at) }}</dd></div>
            <div><dt>更新时间</dt><dd>{{ formatTime(detail.updated_at) }}</dd></div>
            <div><dt>完成时间</dt><dd>{{ formatTime(detail.completed_at) }}</dd></div>
          </dl>
        </section>
      </div>

      <section v-if="detail.assets?.length" class="detail-card">
        <div class="section-heading"><div><span>MATERIALS</span><h2>参考素材</h2></div><small>{{ detail.assets.length }} 项</small></div>
        <div class="asset-grid">
          <article v-for="asset in detail.assets" :key="asset.id" class="asset-card">
            <img v-if="asset.media_type === 'image' && assetPreview(asset)" :src="assetPreview(asset)" alt="" />
            <div v-else class="asset-placeholder">{{ mediaLabel(asset.media_type) }}</div>
            <div><b>{{ asset.alias || asset.snapshot?.alias || `素材 ${asset.ordinal}` }}</b><small>{{ mediaLabel(asset.media_type) }} · {{ asset.send_to_model ? '已发送给模型' : '未发送给模型' }}</small><small>{{ asset.usage || asset.role || 'reference' }}</small></div>
          </article>
        </div>
      </section>

      <section v-if="detail.error_msg" class="detail-card error-card">
        <div class="section-heading"><div><span>ERROR</span><h2>失败信息</h2></div></div>
        <pre>{{ detail.error_msg }}</pre>
      </section>
    </template>
  </main>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, CopyDocument } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { omniVideoAPI } from '@/api/omniVideo'
import { safeRedirectPath } from '@/utils/routeRecovery'
import { formatChinaDateTime } from '@/utils/time'

const route = useRoute()
const router = useRouter()
const loading = ref(true)
const error = ref('')
const detail = ref(null)

const showProviderPrompt = computed(() => Boolean(detail.value?.provider_prompt && detail.value.provider_prompt !== detail.value.original_prompt))
const pixelSize = computed(() => detail.value?.output?.width && detail.value?.output?.height ? `${detail.value.output.width} × ${detail.value.output.height}` : '—')
const outputSize = computed(() => [detail.value?.output?.resolution, pixelSize.value !== '—' ? pixelSize.value : '', detail.value?.output?.fps ? `${formatNumber(detail.value.output.fps, 2)}fps` : ''].filter(Boolean).join(' · '))
const outputDuration = computed(() => detail.value?.output?.duration_ms == null ? '—' : `${formatNumber(detail.value.output.duration_ms / 1000, 2)} 秒`)

async function loadDetail() {
  loading.value = true
  error.value = ''
  try { detail.value = await omniVideoAPI.historyDetail(route.params.id) }
  catch (err) { error.value = err?.message || '生成记录不存在或无权查看' }
  finally { loading.value = false }
}
function goBack() { router.push(safeRedirectPath(route.query.return_to, '/free-create')) }
async function copyPrompt(text) {
  try { await navigator.clipboard.writeText(String(text || '')); ElMessage.success('已复制原始提示词') }
  catch (_) { ElMessage.error('复制失败，请手动选择提示词') }
}
function value(input) { return input === null || input === undefined || input === '' ? '—' : String(input) }
function unit(input, suffix) { return input === null || input === undefined || input === '' ? '—' : `${input}${suffix}` }
function formatNumber(input, digits) { return Number(input).toFixed(digits).replace(/0+$/, '').replace(/\.$/, '') }
function formatTime(input) { return formatChinaDateTime(input, '—') }
function prettyJson(input) { return JSON.stringify(input, null, 2) }
function statusLabel(status) { return ({ completed:'已完成',sd2_waiting:'真人素材认证中',processing:'生成中',upscale_pending:'等待画质增强',upscaling:'画质增强中',interpolation_pending:'等待补帧',interpolating:'画面补帧中',persisting:'保存中',billing_reconciliation:'等待结算',failed:'失败',retryable:'可重试',invalid:'无效' })[status] || value(status) }
function statusType(status) { return status === 'completed' ? 'success' : ['failed','invalid'].includes(status) ? 'danger' : status === 'retryable' ? 'warning' : 'info' }
function creationMode(mode) { return ({ multi_reference:'多参考图',first_last_frame:'首尾帧',single_reference:'单参考图' })[mode] || value(mode) }
function audioStrategy(strategy) { return ({ reference_only:'音频参考',post_mix:'生成后混音' })[strategy] || value(strategy) }
function assetPolicy(policy) { return ({ prompt_references:'仅提示词引用素材',all_selected:'全部已选素材' })[policy] || value(policy) }
function billingStatus(status) { return ({ settled:'已结算',pending:'处理中或待对账',not_charged:'未发现扣费记录' })[status] || value(status) }
function mediaLabel(type) { return ({ image:'图片',video:'视频',audio:'音频' })[type] || value(type) }
function mediaUrl(path) { const text = String(path || ''); if (!text) return ''; return /^https?:\/\//.test(text) || text.startsWith('/static/') ? text : `/static/${text.replace(/^\/+/, '')}` }
function assetPreview(asset) { return mediaUrl(asset.snapshot?.preview_url || asset.snapshot?.url || asset.snapshot?.local_path) }

onMounted(loadDetail)
</script>

<style scoped>
.history-detail-page { min-height: 100vh; padding: 28px clamp(20px, 4vw, 64px) 56px; color: #172033; background: radial-gradient(circle at 82% 0%, #e8efff 0, transparent 34%), #f4f6fa; }
.detail-header { max-width: 1480px; margin: 0 auto 20px; display: grid; grid-template-columns: auto 1fr auto; gap: 18px; align-items: center; }
.history-detail-page .detail-header h1 { margin: 2px 0 4px; color: #172033 !important; -webkit-text-fill-color: #172033 !important; background: none !important; font-size: clamp(26px, 3vw, 40px); line-height: 1.1; }
:global(html body #app .history-detail-page .detail-header h1), :global(html body #app .history-detail-page .section-heading h2) { color: #172033 !important; -webkit-text-fill-color: #172033 !important; background-image: none !important; }
.detail-header p { margin: 0; color: #68738a; }
.detail-header .eyebrow, .section-heading span { color: #6b7fae; font-size: 11px; font-weight: 700; letter-spacing: .13em; }
.back-button { align-self: start; margin-top: 4px; color: #52617b; }
.detail-loading, .detail-card, .detail-grid { max-width: 1480px; margin-left: auto; margin-right: auto; }
.detail-card { margin-bottom: 18px; padding: 22px; border: 1px solid #dfe4ee; border-radius: 16px; background: rgba(255,255,255,.94); box-shadow: 0 10px 30px rgba(32,49,84,.06); }
.detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.detail-grid .detail-card { width: auto; margin: 0; }
.section-heading { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 18px; }
.history-detail-page .section-heading h2 { margin: 3px 0 0; color: #172033 !important; -webkit-text-fill-color: #172033 !important; background: none !important; font-size: 20px; }
.section-heading small { color: #758097; }
.result-card video { display: block; width: min(100%, 980px); max-height: 62vh; margin: auto; border-radius: 12px; background: #0d111b; }
.prompt-block { margin-top: 12px; padding: 16px; border: 1px solid #e1e6ef; border-radius: 12px; background: #f8f9fc; }
.prompt-block b, .prompt-block small { display: block; }
.prompt-block small { margin-top: 4px; color: #788399; }
.primary-prompt { border-color: #a9bff4; background: #f2f6ff; }
.provider-prompt { border-color: #dfd7f6; background: #f8f5ff; }
pre { margin: 12px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 1.72; }
.fact-list { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 20px; }
.fact-list div { min-width: 0; padding: 11px 0; border-top: 1px solid #edf0f5; }
.fact-list dt { color: #7a8498; font-size: 12px; }
.fact-list dd { margin: 5px 0 0; line-height: 1.45; }
.fact-list .points { color: #266b43; font-weight: 700; }
.break-value { overflow-wrap: anywhere; }
.json-details { margin-top: 14px; border-top: 1px solid #edf0f5; padding-top: 14px; }
.json-details summary { cursor: pointer; color: #526a9f; }
.json-details pre { max-height: 360px; overflow: auto; padding: 12px; border-radius: 10px; background: #111827; color: #dbe7ff; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }
.asset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.asset-card { min-width: 0; display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 12px; align-items: center; padding: 10px; border: 1px solid #e3e7ef; border-radius: 12px; }
.asset-card img, .asset-placeholder { width: 72px; height: 64px; border-radius: 8px; object-fit: cover; background: #edf0f6; }
.asset-placeholder { display: grid; place-items: center; color: #6e7890; }
.asset-card b, .asset-card small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.asset-card small { margin-top: 4px; color: #7d8799; }
.error-card { border-color: #efc3c3; background: #fff7f7; }
.inline-error { color: #b23d3d; overflow-wrap: anywhere; }
@media (max-width: 900px) {
  .history-detail-page { padding: 18px 14px 40px; }
  .detail-header { grid-template-columns: auto 1fr; }
  .detail-header > .el-tag { grid-column: 2; justify-self: start; }
  .detail-grid { grid-template-columns: 1fr; }
}
@media (max-width: 560px) {
  .detail-card { padding: 16px; border-radius: 12px; }
  .fact-list { grid-template-columns: 1fr; }
  .section-heading { align-items: flex-start; }
}
</style>
