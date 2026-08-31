<template>
  <section class="price-sync-panel" aria-labelledby="price-sync-title">
    <header>
      <div><p>火山账户价</p><h3 id="price-sync-title">价格同步与人工发布</h3><small>每小时只读检查。系统不会自动发布价格。</small></div>
      <div class="actions"><el-button :loading="probing" @click="probe">权限诊断</el-button><el-button type="primary" :loading="syncing" @click="runSync">立即同步</el-button></div>
    </header>

    <el-alert v-if="probeResult" :type="probeReady ? 'success' : 'warning'" :closable="false" show-icon>
      <template #title>方舟价格：{{ statusLabel(probeResult.ark_status) }} · 费用中心：{{ statusLabel(probeResult.billing_status) }}</template>
      <p v-if="!probeReady">账单读取失败时，请给当前 IAM 身份增加 BillingCenterBillReadOnlyAccess。</p>
      <p v-else>已验证 {{ probeResult.activation_count }} 个已开通模型。账期 {{ probeResult.bill_period }} 有 {{ probeResult.bill_rows }} 条按日计费项；本次保存 {{ probeResult.bill_summary_count }} 条脱敏汇总，并保存平台日志的日期、模型、计费项和用量汇总。<span v-if="probeResult.bill_summary_truncated">账单结果超过单页，当前核对样本未覆盖全部记录。</span></p>
    </el-alert>

    <div class="candidate-area">
        <div v-if="detail" class="detail-toolbar"><div><b>当前生效价目 → 最新火山账户价</b><small>{{ formatTime(detail.fetched_at || detail.created_at) }} · {{ detail.changed_count }} 项变化 · {{ detail.mapped_count }}/{{ detail.candidate_count }} 已映射</small></div><el-button type="success" :disabled="!canCreateDraft" :loading="creatingDraft" @click="createDraft">生成价目草稿</el-button></div>
        <div v-if="detail" class="candidate-table"><el-table :data="detail.candidates" row-key="id" size="small">
          <el-table-column prop="provider_model" label="火山模型" min-width="190" show-overflow-tooltip/>
          <el-table-column prop="charge_type" label="计费项" min-width="145"/>
          <el-table-column label="供应商价" min-width="135"><template #default="{row}"><span class="provider-price-value">{{ row.provider_unit_price ?? '—' }} CNY / {{ row.unit_code || '未知单位' }}</span></template></el-table-column>
          <el-table-column label="本地映射" min-width="330"><template #default="{row}"><div class="mapping-fields"><el-input v-model="row.service_type" placeholder="服务"/><el-input v-model="row.billing_key" placeholder="billing_key"/><el-select v-model="row.meter" placeholder="计量器"><el-option v-for="meter in meters" :key="meter" :label="meter" :value="meter"/></el-select><el-input-number v-model="row.unit_size" :min="1" controls-position="right"/></div><small v-if="row.error_summary" class="error">{{ row.error_summary }}</small></template></el-table-column>
          <el-table-column label="积分变化" min-width="280"><template #default="{row}"><div>{{ points(row.current_unit_price_micro) }} → {{ points(row.new_unit_price_micro) }}</div><div v-if="row.new_conditions" class="condition-change"><span>{{ conditionSummary(row.current_conditions) }}</span><b>→</b><span>{{ conditionSummary(row.new_conditions) }}</span></div></template></el-table-column>
          <el-table-column label="审核" width="150"><template #default="{row}"><el-tag :type="reviewTone(row)">{{ reviewLabel(row) }}</el-tag><div class="review-actions"><el-button link type="primary" @click="accept(row)">接受</el-button><el-button link type="danger" @click="reject(row)">排除</el-button></div></template></el-table-column>
        </el-table></div>
        <p v-else class="empty">尚无同步结果。点击“立即同步”读取当前火山账户价。</p>
    </div>

    <section class="notice-admin" aria-labelledby="price-notice-title">
      <div><h4 id="price-notice-title">价格通知</h4><small>归档会停止显示横幅。用户确认历史仍会保留。</small></div>
      <el-table :data="notices" size="small">
        <el-table-column prop="title" label="标题" min-width="220" show-overflow-tooltip/>
        <el-table-column prop="status" label="状态" width="90"/>
        <el-table-column label="生效时间" min-width="170"><template #default="{row}">{{ formatTime(row.effective_at) }}</template></el-table-column>
        <el-table-column prop="acknowledgement_count" label="已确认" width="90"/>
        <el-table-column label="操作" width="90"><template #default="{row}"><el-button v-if="row.status === 'active'" link type="danger" @click="archive(row)">归档</el-button></template></el-table-column>
      </el-table>
    </section>

    <el-dialog v-model="showPublish" title="审核并发布价目" width="min(620px, 94vw)">
      <el-form label-position="top">
        <el-form-item label="价目版本"><el-input :model-value="draft?.name" disabled/></el-form-item>
        <el-form-item label="发布原因"><el-input v-model="publishForm.reason" maxlength="200" show-word-limit/></el-form-item>
        <el-form-item label="用户通知标题"><el-input v-model="publishForm.notice_title" maxlength="80" show-word-limit/></el-form-item>
        <el-form-item label="用户通知正文"><el-input v-model="publishForm.notice_body" type="textarea" :rows="7" maxlength="1600" show-word-limit/></el-form-item>
        <el-alert type="warning" :closable="false" title="发布后立即生效。进行中任务继续使用原价格快照。"/>
      </el-form>
      <template #footer><el-button @click="showPublish=false">稍后发布</el-button><el-button type="primary" :loading="publishing" @click="publish">确认发布</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { adminAPI } from '@/api/account'
import { formatChinaDateTime } from '@/utils/time'
import { compactQuantity } from '@/utils/units'

const emit = defineEmits(['published', 'draft-created'])
const meters = ['request', 'image', 'second', 'millisecond', 'character', 'input_token', 'output_token']
const detail = ref(null); const probeResult = ref(null); const draft = ref(null); const notices = ref([])
const probing = ref(false); const syncing = ref(false); const creatingDraft = ref(false); const publishing = ref(false); const showPublish = ref(false)
const publishForm = reactive({ reason: '', notice_title: '模型调用价格已更新', notice_body: '' })
const probeReady = computed(() => probeResult.value?.ark_status === 'success' && probeResult.value?.billing_status === 'success')
const canCreateDraft = computed(() => detail.value?.status === 'completed' && detail.value.candidates?.length && detail.value.candidates.every((row) => row.review_status !== 'pending' && (row.review_status === 'rejected' || row.mapping_status === 'mapped')))

function statusLabel(value) { return ({ success: '通过', failed: '失败', completed: '已读取', unchanged: '无变化', processing: '读取中' })[value] || value || '未知' }
function formatTime(value) { return value ? formatChinaDateTime(value) : '—' }
function points(value) { return Number.isSafeInteger(value) ? `${value / 10000} 积分` : '未定价' }
function conditionSummary(value) { const rates = value?.rates || []; const tiers = value?.usage_tiers || []; if (tiers.length) return tiers.map((tier) => `${compactQuantity(tier.min_inclusive)}-${compactQuantity(tier.max_inclusive)}: ${tier.unit_price_points}`).join('\n'); if (rates.length) return rates.map((rate) => `${rate.id}: ${rate.unit_price_points}`).join('\n'); return value?.unit_size ? `每 ${compactQuantity(value.unit_size)}` : '无条件价' }
function candidateChange(row) { const base = `${row.provider_model} / ${row.meter}: ${points(row.current_unit_price_micro)} → ${points(row.new_unit_price_micro)}（每 ${compactQuantity(row.unit_size)}）`; return row.new_conditions ? `${base}\n  条件价：${conditionSummary(row.current_conditions)} → ${conditionSummary(row.new_conditions)}` : base }
function reviewLabel(row) { return row.review_status === 'accepted' ? '已接受' : row.review_status === 'rejected' ? '已排除' : row.mapping_status === 'mapped' ? '待审核' : '待映射' }
function reviewTone(row) { return row.review_status === 'accepted' ? 'success' : row.review_status === 'rejected' ? 'info' : 'warning' }
async function load() { const [latestSyncs, noticeRows, lastProbe] = await Promise.all([adminAPI.providerPriceSyncs({ limit: 1 }), adminAPI.notices({ limit: 50 }), adminAPI.volcenginePriceProbeStatus()]); notices.value = noticeRows; probeResult.value = lastProbe; detail.value = latestSyncs.length ? await adminAPI.providerPriceSync(latestSyncs[0].id) : null }
async function openSync(id) { detail.value = await adminAPI.providerPriceSync(id) }
async function probe() { probing.value = true; try { probeResult.value = await adminAPI.probeVolcenginePrices(); ElMessage.success(probeReady.value ? '只读权限诊断通过' : '诊断完成，请检查权限提示') } finally { probing.value = false } }
async function runSync() { syncing.value = true; try { const result = await adminAPI.syncVolcenginePrices(); await load(); await openSync(result.id); ElMessage.success(result.status === 'unchanged' ? '价格没有变化' : '价格同步完成，请人工审核') } finally { syncing.value = false } }
async function review(row, status) { const updated = await adminAPI.updateProviderPriceCandidate(detail.value.id, row.id, { service_type: row.service_type, billing_key: row.billing_key, meter: row.meter, unit_size: row.unit_size, review_status: status }); Object.assign(row, updated); ElMessage.success(status === 'accepted' ? '候选价格已接受' : '候选价格已排除') }
async function accept(row) { await review(row, 'accepted') }
async function reject(row) { await review(row, 'rejected') }
async function createDraft() { creatingDraft.value = true; try { draft.value = await adminAPI.createProviderPriceDraft(detail.value.id); publishForm.reason = `审核并发布火山价目同步批次 ${detail.value.id.slice(0, 8)}`; const changed = detail.value.candidates.filter((row) => row.review_status === 'accepted').map(candidateChange); publishForm.notice_body = `生效时间：发布后立即生效。\n受影响价格：\n${changed.join('\n')}\n进行中的任务继续使用原价格快照。`; showPublish.value = true; emit('draft-created', draft.value) } finally { creatingDraft.value = false } }
async function publish() { if (!publishForm.reason.trim() || !publishForm.notice_title.trim() || !publishForm.notice_body.trim()) return ElMessage.warning('请填写发布原因和通知内容'); publishing.value = true; try { await adminAPI.publishPriceBook(draft.value.id, { confirm: true, reason: publishForm.reason.trim(), idempotency_key: `provider-price-publish:${draft.value.id}:${Date.now()}`, notice_title: publishForm.notice_title.trim(), notice_body: publishForm.notice_body.trim() }); showPublish.value = false; await load(); emit('published'); ElMessage.success('新价格已发布，用户横幅已生效') } finally { publishing.value = false } }
async function archive(row) { await adminAPI.archiveNotice(row.id); await load(); ElMessage.success('通知已归档，确认历史已保留') }

onMounted(load)
</script>

<style scoped>
.price-sync-panel{display:grid;gap:1rem;margin-bottom:1.2rem;padding:1rem;border:1px solid var(--border-subtle);border-radius:.9rem;background:var(--bg-raised)}
.notice-admin{display:grid;gap:.7rem;padding-top:.8rem;border-top:1px solid var(--border-subtle)}.notice-admin h4{margin:0 0 .2rem}
.price-sync-panel>header,.detail-toolbar{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem}.price-sync-panel h3{margin:.2rem 0;font-size:1.1rem}.price-sync-panel p,.price-sync-panel small{margin:0;color:var(--text-muted)}.actions,.review-actions{display:flex;gap:.4rem}.candidate-area{min-width:0;padding:.8rem;border-top:1px solid var(--border-subtle)}.candidate-table{margin-top:.8rem;overflow-x:auto}.detail-toolbar small{display:block;margin-top:.25rem}.mapping-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:.35rem}.error{display:block;margin-top:.3rem;color:var(--status-danger,#c2413b)}.condition-change{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:start;gap:.35rem;margin-top:.25rem;line-height:1.35}.condition-change span{white-space:pre-line}.review-actions{margin-top:.25rem}.empty{padding:1rem;text-align:center}
.candidate-table :deep(.el-table){font-size:.75rem}.candidate-table :deep(.el-table th.el-table__cell){font-size:.7rem;letter-spacing:.02em}.candidate-table :deep(.cell){line-height:1.3}.candidate-table :deep(.el-input__inner),.candidate-table :deep(.el-select__selected-item),.candidate-table :deep(.el-input-number){font-size:.74rem}.condition-change{font-size:.68rem}
.provider-price-value{display:block;font-size:.68rem;line-height:1.25;overflow-wrap:anywhere;word-break:break-word}
</style>
