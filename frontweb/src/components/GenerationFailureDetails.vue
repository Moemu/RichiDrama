<template>
  <div class="generation-failure-details">
    <b>{{ failure.title }}</b>
    <p>{{ failure.message }}</p>
    <small>{{ failure.action }}</small>
    <section v-if="target?.found" class="real-person-target" aria-label="模型标记的参考图">
      <img v-if="target.preview_url" :src="target.preview_url" :alt="target.alias || '模型标记的参考图'" width="160" height="100" />
      <div class="real-person-target-copy">
        <b>已定位：第 {{ target.reference_image_number }} 张参考图</b>
        <span>{{ target.alias || `参考图 ${target.reference_image_number}` }}</span>
        <small>火山字段：content[{{ target.provider_content_index }}]</small>
        <el-tag v-if="certificationStatus === 'active'" size="small" type="success">真人素材已认证</el-tag>
        <el-tag v-else-if="target.in_asset_library" size="small" type="info">已在本地素材库</el-tag>
        <el-tag v-else size="small" type="warning">尚未加入本地素材库</el-tag>
      </div>
      <div v-if="certificationStatus !== 'active' && (target.asset_id || target.can_import)" class="real-person-target-actions">
        <el-button v-if="!target.in_asset_library" type="primary" size="small" :loading="importing" @click="importOnly">仅加入素材库</el-button>
        <el-button plain size="small" :loading="preparing" @click="prepareCertification">声明含真人并认证</el-button>
      </div>
    </section>
    <div v-else-if="locating" class="real-person-locating">正在定位失败图片…</div>
    <div v-else-if="failure.realPersonContentIndex && lookupFinished" class="real-person-unresolved">火山指出第 {{ failure.realPersonContentIndex }} 张参考图，但任务快照中没有可预览文件。请复制技术详情给管理员。</div>
    <section v-if="failure.copyrightRestriction && copyrightSummary" class="copyright-bulk-target" aria-label="版权限制参考图批量导入">
      <div>
        <b>本次包含 {{ copyrightSummary.total }} 张参考图</b>
        <small>已在素材库 {{ copyrightSummary.in_asset_library }} 张。火山没有指出具体图片。</small>
        <small v-if="copyrightSummary.unavailable">另有 {{ copyrightSummary.unavailable }} 张没有可导入的本地文件。</small>
      </div>
      <el-button v-if="copyrightSummary.importable" type="primary" size="small" :loading="copyrightImporting" @click="importCopyrightAll">批量加入素材库（{{ copyrightSummary.importable }}）</el-button>
      <el-tag v-else size="small" type="success">参考图均已在素材库</el-tag>
    </section>
    <div v-else-if="failure.copyrightRestriction && locating" class="real-person-locating">正在读取本次参考图…</div>
    <div v-else-if="failure.copyrightRestriction && lookupFinished" class="real-person-unresolved">任务快照中没有可预览的参考图。请检查提示词中的名称、品牌或受版权保护内容。</div>
    <div v-if="failure.requestId" class="generation-failure-trace"><span>火山响应 ID</span><code :title="failure.requestId">{{ failure.shortRequestId }}</code><el-button text size="small" @click="copyRequestId">复制响应 ID</el-button></div>
    <details><summary>查看技术详情</summary><div class="generation-failure-raw"><code>{{ failure.rawReason }}</code><el-button size="small" plain @click="copyFullDetails">复制完整失败信息</el-button></div></details>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { generationFailureCopyText, presentGenerationFailure } from '@/utils/generationFailure'
import { omniVideoAPI } from '@/api/omniVideo'
const props = defineProps({ job: { type: Object, required: true } })
const failure = computed(() => presentGenerationFailure(props.job))
const target = ref(null)
const locating = ref(false)
const lookupFinished = ref(false)
const preparing = ref(false)
const importing = ref(false)
const copyrightSummary = ref(null)
const copyrightImporting = ref(false)
const certificationStatus = computed(() => String(target.value?.seedance2_asset?.status || 'none').toLowerCase())
function omniJobId() { return props.job.omni_job_id || (props.job.request_snapshot ? props.job.id : null) }
watch(() => [omniJobId(), failure.value.realPersonContentIndex, failure.value.copyrightRestriction], async ([jobId, contentIndex, copyrightRestriction]) => {
  target.value = props.job.real_person_failure_asset || null
  copyrightSummary.value = props.job.copyright_failure_asset_summary || null
  lookupFinished.value = false
  const needsRealPersonLookup = !!contentIndex && !target.value
  const needsCopyrightLookup = !!copyrightRestriction && !copyrightSummary.value
  if (!jobId || (!needsRealPersonLookup && !needsCopyrightLookup)) { lookupFinished.value = true; return }
  locating.value = true
  try {
    const detail = await omniVideoAPI.get(jobId)
    target.value = detail?.real_person_failure_asset || target.value
    copyrightSummary.value = detail?.copyright_failure_asset_summary || copyrightSummary.value
  } catch (_) {}
  finally { locating.value = false; lookupFinished.value = true }
}, { immediate: true })
async function prepareCertification() {
  if (!target.value || preparing.value) return
  preparing.value = true
  try {
    if (!target.value.asset_id) target.value = await omniVideoAPI.importRealPersonAsset(omniJobId(), { identity_required: true })
    const updated = await omniVideoAPI.updateAsset(target.value.asset_id, { requires_sd2_identity: true })
    target.value = { ...target.value, in_asset_library: true, requires_sd2_identity: true, seedance2_asset: updated?.seedance2_asset || target.value.seedance2_asset }
    const result = await omniVideoAPI.certifyAsset(target.value.asset_id)
    if (result?.seedance2_asset) target.value.seedance2_asset = result.seedance2_asset
    ElMessage.success(certificationStatus.value === 'active' ? '真人素材认证已完成' : '真人素材已提交认证，系统将继续处理')
  } catch (error) { ElMessage.error(error.message || '真人素材认证失败') }
  finally { preparing.value = false }
}
async function importCopyrightAll() {
  if (copyrightImporting.value) return
  copyrightImporting.value = true
  try {
    copyrightSummary.value = await omniVideoAPI.importCopyrightAssets(omniJobId())
    ElMessage.success('可用参考图已批量加入素材库')
  } catch (error) { ElMessage.error(error.message || '批量加入素材库失败') }
  finally { copyrightImporting.value = false }
}
async function importOnly() {
  if (!target.value || importing.value) return
  importing.value = true
  try {
    if (!target.value.asset_id) target.value = await omniVideoAPI.importRealPersonAsset(omniJobId(), { identity_required: false })
    target.value = { ...target.value, in_asset_library: true, requires_sd2_identity: false }
    ElMessage.success('图片已加入素材库，未声明为真人素材')
  } catch (error) { ElMessage.error(error.message || '加入素材库失败') }
  finally { importing.value = false }
}
async function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value)
  const input = document.createElement('textarea'); input.value = value; input.style.position = 'fixed'; input.style.opacity = '0'; document.body.appendChild(input); input.select(); document.execCommand('copy'); input.remove()
}
async function copyRequestId() { try { await copyText(failure.value.requestId); ElMessage.success('已复制完整响应 ID') } catch { ElMessage.error('复制失败，请在技术详情中手动复制') } }
async function copyFullDetails() { try { await copyText(generationFailureCopyText(props.job)); ElMessage.success('已复制完整失败信息') } catch { ElMessage.error('复制失败，请手动复制技术详情') } }
</script>

<style scoped>
.generation-failure-details{display:grid;min-width:0;gap:4px}.generation-failure-details>b{color:var(--text-primary);font-size:14px}.generation-failure-details p{margin:0;color:var(--text-regular);font-size:13px;line-height:1.55}.generation-failure-details>small{color:var(--text-muted);font-size:12px;line-height:1.55}.generation-failure-trace{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin-top:5px;color:var(--text-muted);font-size:11px}.generation-failure-trace code{max-width:100%;padding:3px 6px;border:1px solid var(--border-subtle);border-radius:5px;background:var(--bg-raised);color:var(--text-regular);font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.generation-failure-details details{margin-top:3px}.generation-failure-details summary{width:max-content;max-width:100%;color:var(--text-muted);font-size:11px;cursor:pointer}.generation-failure-raw{display:grid;gap:8px;margin-top:7px;padding:9px;border:1px solid var(--border-subtle);border-radius:7px;background:color-mix(in srgb,var(--bg-page) 45%,transparent)}.generation-failure-raw code{max-height:120px;overflow:auto;color:var(--text-muted);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;line-height:1.5;overflow-wrap:anywhere;white-space:pre-wrap}.generation-failure-raw .el-button{justify-self:start}
.real-person-target{display:grid;grid-template-columns:112px minmax(0,1fr) auto;align-items:center;gap:10px;margin-top:8px;padding:10px;border:1px solid color-mix(in srgb,var(--status-warning,#d89b36) 42%,var(--border-subtle));border-radius:10px;background:color-mix(in srgb,var(--status-warning,#d89b36) 8%,var(--bg-raised))}.real-person-target img{width:112px;height:72px;border-radius:7px;background:var(--bg-page);object-fit:cover}.real-person-target-copy{display:grid;min-width:0;gap:3px}.real-person-target-copy>b{color:var(--text-primary);font-size:12px}.real-person-target-copy>span{overflow:hidden;color:var(--text-regular);font-size:12px;text-overflow:ellipsis;white-space:nowrap}.real-person-target-copy>small,.real-person-locating,.real-person-unresolved{color:var(--text-muted);font-size:11px}.real-person-target-copy .el-tag{justify-self:start}.real-person-target-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap}.real-person-target-actions .el-button{margin:0}.real-person-unresolved{margin-top:6px;padding:8px;border-radius:7px;background:var(--bg-raised);line-height:1.5}@media(max-width:720px){.real-person-target{grid-template-columns:82px minmax(0,1fr)}.real-person-target img{width:82px;height:62px}.real-person-target-actions{grid-column:1/-1}.real-person-target-actions .el-button{flex:1 1 auto}}
.copyright-bulk-target{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px;padding:10px;border:1px solid color-mix(in srgb,var(--status-warning,#d89b36) 42%,var(--border-subtle));border-radius:10px;background:color-mix(in srgb,var(--status-warning,#d89b36) 8%,var(--bg-raised))}.copyright-bulk-target>div{display:grid;min-width:0;gap:2px}.copyright-bulk-target b{color:var(--text-primary);font-size:12px}.copyright-bulk-target small{color:var(--text-muted);font-size:11px}.copyright-bulk-target>.el-button{flex:none;margin:0}@media(max-width:720px){.copyright-bulk-target{align-items:stretch;flex-direction:column}.copyright-bulk-target>.el-button{width:100%}}
</style>
