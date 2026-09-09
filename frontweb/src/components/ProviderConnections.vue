<template>
  <section class="provider-connections" v-loading="loading">
    <header class="connections-heading">
      <div><h2>供应商连接</h2><p>一个连接保存一份地址和凭据。模型按能力归类，角色图与分镜图共用图片模型。</p></div>
      <div class="connection-actions"><el-button @click="load">刷新</el-button><el-button type="primary" :disabled="locked" @click="edit()">添加连接</el-button></div>
    </header>
    <div v-if="error" role="alert" class="connection-error">{{ error }}</div>
    <div class="connection-guide"><span>① 连接供应商</span><span>② 导入模型并发布价格</span><span>③ 在业务场景选择模型</span></div>
    <div v-if="!rows.length" class="connection-empty">还没有共享连接。可以新增连接，或从下方现有配置转换。</div>
    <article v-for="row in rows" :key="row.id" class="connection-card">
      <header><div><h3>{{ row.name }}</h3><p>{{ row.provider }} · {{ row.base_url }}</p></div><el-tag :type="row.is_active ? 'success' : 'info'">{{ row.is_active ? '已启用' : '已停用' }}</el-tag></header>
      <p class="connection-key">{{ row.has_api_key ? '凭据已保存' : '尚未填写凭据' }}</p>
      <div class="connection-models" v-if="row.bindings.length">
        <div v-for="binding in row.bindings" :key="binding.id"><strong>{{ types[binding.service_type] || binding.service_type }}</strong><span><small class="binding-name">{{ binding.name }}</small>{{ binding.model.join('、') || '暂无模型' }}</span><el-button link @click="$emit('binding', binding.id)">模型调用设置</el-button></div>
      </div>
      <p v-else class="connection-key">导入模型后，它们会出现在模型目录中。</p>
      <footer><el-button :disabled="locked" @click="edit(row)">编辑连接</el-button><el-button :disabled="locked" @click="openAttachment(row)">关联现有配置</el-button><el-button :disabled="locked" @click="manual(row)">添加模型</el-button><el-button type="primary" :disabled="locked" @click="discover(row)">获取模型</el-button><el-button link @click="$emit('catalog')">模型目录与价格</el-button></footer>
    </article>
    <details class="legacy-connections" :open="!rows.length">
      <summary>现有配置（{{ legacy.length }}）</summary>
      <p>转换会共享凭据并保留原配置 ID、历史记录和默认值。能力不符的旧型号不再用于新请求，可重新导入到正确能力。不同凭据不会自动合并。</p>
      <p>多条配置共用同一 Key 和地址时，先转换其中一条，再在该连接中点击“关联现有配置”。两条图片配置可同时保留。</p>
      <div v-for="row in legacy" :key="row.id" class="legacy-row"><div><strong>{{ row.name }}</strong><small>{{ row.provider }} · {{ types[row.service_type] || row.service_type }}</small></div><el-button :disabled="locked || converting !== null" :loading="converting === row.id" @click="convert(row)">转换为共享连接</el-button></div>
      <p v-if="!legacy.length">没有可转换的旧配置。</p>
    </details>
    <el-dialog v-model="editing" :title="form.id ? '编辑供应商连接' : '添加供应商连接'" class="provider-connection-dialog" width="min(600px, 94vw)" top="5vh" append-to-body :close-on-click-modal="false">
      <el-form label-position="top" @submit.prevent="save">
        <el-form-item label="连接名称"><el-input v-model="form.name" aria-label="连接名称" maxlength="200" /></el-form-item>
        <el-form-item label="供应商"><el-select v-model="form.provider" filterable allow-create default-first-option :disabled="!!form.id" aria-label="供应商" @change="selectProvider"><el-option v-for="preset in presets" :key="preset.value" :label="preset.label" :value="preset.value" /></el-select></el-form-item>
        <el-form-item label="Base URL"><el-input v-model="form.base_url" aria-label="连接地址" /></el-form-item>
        <el-form-item label="API Key"><el-input v-model="form.api_key" type="password" show-password autocomplete="new-password" :placeholder="form.id ? '留空保留已保存凭据' : '填写供应商凭据'" aria-label="连接凭据" /></el-form-item>
        <el-switch v-model="form.is_active" active-text="启用连接" />
        <p v-if="form.id" class="connection-key">地址与凭据的修改会用于此连接下所有模型的新请求。</p>
        <p v-if="formError" role="alert" class="connection-error">{{ formError }}</p>
      </el-form>
      <template #footer><el-button :disabled="saving" @click="editing = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存连接</el-button></template>
    </el-dialog>
    <el-dialog v-model="adding" title="添加模型" class="provider-connection-dialog" width="min(600px, 94vw)" top="5vh" append-to-body :close-on-click-modal="false">
      <el-form label-position="top"><el-form-item label="模型 ID"><el-input v-model="newModel" aria-label="模型 ID" /></el-form-item><el-form-item label="模型能力"><el-select v-model="newCapability" aria-label="模型能力"><el-option v-for="type in ['text','image','video','tts']" :key="type" :value="type" :label="types[type]" /></el-select></el-form-item></el-form>
      <p class="connection-key">按供应商声明选择能力。系统会校验已知型号，新增模型保存为待上架。</p><p v-if="formError" role="alert" class="connection-error">{{ formError }}</p>
      <template #footer><el-button :disabled="saving" @click="adding = false">取消</el-button><el-button type="primary" :loading="saving" @click="addModel">添加模型</el-button></template>
    </el-dialog>
    <el-dialog v-model="attaching" title="关联现有配置" class="provider-connection-dialog attachment-dialog" width="min(720px, 94vw)" top="5vh" append-to-body :close-on-click-modal="false" :close-on-press-escape="!attachmentSaving" :show-close="!attachmentSaving">
      <p class="attachment-target">目标连接：<strong>{{ attachmentTarget?.name }}</strong></p>
      <p class="attachment-intro">只关联供应商、Base URL 和 API Key 一致的配置。保留原配置 ID、协议、端点和默认模型；两条图片配置不会合并。能力不符的旧型号不再用于新请求。</p>
      <p v-if="attachmentError" role="alert" class="connection-error">{{ attachmentError }}</p>
      <div class="attachment-actions"><el-button :disabled="attachmentLoading || attachmentSaving" @click="loadCandidates">刷新列表</el-button><el-button :disabled="attachmentLoading || attachmentSaving || !candidates.some(row => row.eligible)" @click="attachmentSelection = candidates.filter(row => row.eligible).map(row => row.id)">选择全部可关联</el-button><span>已选 {{ attachmentSelection.length }} 条</span></div>
      <div v-loading="attachmentLoading" class="attachment-list">
        <div v-for="row in candidates" :key="row.id" class="attachment-row" :class="{ 'attachment-unavailable': !row.eligible }">
          <el-checkbox :model-value="attachmentSelection.includes(row.id)" :disabled="!row.eligible || attachmentSaving || attachmentLoading" :aria-label="row.name" @change="checked => toggleAttachment(row.id, checked)" />
          <div><strong>{{ row.name }}</strong><small>{{ types[row.service_type] }} · {{ row.provider }}</small><small>{{ row.base_url }}</small><small v-if="row.reason" class="attachment-reason">{{ row.reason }}</small><small v-else>默认模型：{{ row.default_model || '沿用现有选择' }}</small></div>
        </div>
        <p v-if="!attachmentLoading && !candidates.length" class="connection-key">没有可关联的旧配置。</p>
      </div>
      <template #footer><el-button :disabled="attachmentSaving" @click="attaching = false">取消</el-button><el-button type="primary" :disabled="attachmentLoading || !attachmentSelection.length" :loading="attachmentSaving" @click="attachSelected">关联所选（{{ attachmentSelection.length }}）</el-button></template>
    </el-dialog>
    <ModelDiscoveryDialog v-model="discovering" :initial-connection-id="discoveryId" @imported="changed" />
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { aiAPI } from '@/api/ai'
import { providerConnectionsAPI as api } from '@/api/providerConnections'
import { modelDiscoveryAPI } from '@/api/modelDiscovery'
import ModelDiscoveryDialog from './ModelDiscoveryDialog.vue'
defineProps({ locked: Boolean })
const emit = defineEmits(['changed', 'binding', 'catalog'])
const types = { text: '文本', image: '图片', storyboard_image: '图片（旧分镜配置）', video: '视频', tts: '语音' }
const presets = [{ value: 'volcengine', label: '火山方舟', url: 'https://ark.cn-beijing.volces.com/api/v3' }, { value: 'openai', label: 'OpenAI / OpenAI 兼容', url: 'https://api.openai.com/v1' }, { value: 'agnes', label: 'Agnes', url: 'https://apihub.agnes-ai.com/v1' }, { value: 'qwen', label: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }, { value: 'gemini', label: 'Google Gemini', url: 'https://generativelanguage.googleapis.com' }]
const rows = ref([]); const legacy = ref([]); const loading = ref(false); const error = ref(''); const formError = ref('')
const editing = ref(false); const adding = ref(false); const saving = ref(false); const converting = ref(null)
const form = ref({}); const newModel = ref(''); const newCapability = ref(''); const selectedId = ref(null)
const discovering = ref(false); const discoveryId = ref(null)
const attaching = ref(false); const attachmentTarget = ref(null); const candidates = ref([]); const attachmentSelection = ref([])
const attachmentLoading = ref(false); const attachmentSaving = ref(false); const attachmentError = ref('')
let attachmentRequest = 0
async function openAttachment(row) { attachmentTarget.value = row; attaching.value = true; await loadCandidates() }
async function loadCandidates() {
  const version = ++attachmentRequest
  candidates.value = []; attachmentSelection.value = []; attachmentError.value = ''; attachmentLoading.value = true
  try { const result = await api.candidates(attachmentTarget.value.id); if (version === attachmentRequest) candidates.value = result }
  catch (e) { if (version === attachmentRequest) attachmentError.value = e.message || '读取现有配置失败' }
  finally { if (version === attachmentRequest) attachmentLoading.value = false }
}
function toggleAttachment(id, checked) { attachmentSelection.value = checked ? [...new Set([...attachmentSelection.value, id])] : attachmentSelection.value.filter(value => value !== id) }
async function attachSelected() {
  attachmentSaving.value = true; attachmentError.value = ''
  try { const result = await api.attach(attachmentTarget.value.id, attachmentSelection.value); attaching.value = false; await changed(); ElMessage.success(`已关联 ${result.attached.length} 条配置，原默认模型和历史记录已保留`) }
  catch (e) { attachmentError.value = e.message || '关联失败' }
  finally { attachmentSaving.value = false }
}
async function load() {
  loading.value = true; error.value = ''
  try { const [connections, configs] = await Promise.all([api.list(), aiAPI.list(null, { platform: true })]); rows.value = connections; legacy.value = configs.filter(row => !row.provider_connection_id && !row.owner_tenant_id && Object.hasOwn(types, row.service_type)) }
  catch (e) { error.value = e.message || '读取连接失败' }
  finally { loading.value = false }
}
async function changed() { await load(); emit('changed') }
function edit(row) { form.value = row ? { id: row.id, name: row.name, provider: row.provider, base_url: row.base_url, api_key: '', is_active: row.is_active } : { name: '', provider: 'volcengine', base_url: presets[0].url, api_key: '', is_active: true }; formError.value = ''; editing.value = true }
function selectProvider(value) { const preset = presets.find(item => item.value === value); if (preset) form.value.base_url = preset.url }
async function save() { saving.value = true; formError.value = ''; try { await api.save(form.value, form.value.id); editing.value = false; await changed(); ElMessage.success('连接已保存') } catch (e) { formError.value = e.message || '保存失败' } finally { saving.value = false } }
async function convert(row) { converting.value = row.id; error.value = ''; try { await api.convert(row.id); await changed(); ElMessage.success('已转换，原配置与默认值已保留；现在可以按能力导入模型') } catch (e) { error.value = e.message || '转换失败' } finally { converting.value = null } }
function discover(row) { discoveryId.value = `provider-${row.id}`; discovering.value = true }
function manual(row) { selectedId.value = row.id; newModel.value = ''; newCapability.value = ''; formError.value = ''; adding.value = true }
async function addModel() {
  saving.value = true; formError.value = ''
  try { const model = newModel.value.trim(); await modelDiscoveryAPI.import(`provider-${selectedId.value}`, [model], { [model]: newCapability.value }); adding.value = false; await changed(); ElMessage.success('模型已保存，请到模型目录配置价格和上架') }
  catch (e) { formError.value = e.message || '添加失败' } finally { saving.value = false }
}
onMounted(load)
defineExpose({ load })
</script>

<style scoped>
.binding-name{display:block;color:var(--text-muted);margin-bottom:.2rem}
.attachment-intro{line-height:1.7;color:var(--text-muted)}.attachment-target{overflow-wrap:anywhere}.attachment-actions{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin:1rem 0}.attachment-actions .el-button{margin-left:0}.attachment-actions span{color:var(--text-muted);font-size:13px}.attachment-list{min-height:70px}.attachment-row{display:flex;gap:.8rem;align-items:flex-start;padding:1rem 0;border-top:1px solid var(--el-border-color);cursor:pointer}.attachment-row>div{min-width:0;overflow-wrap:anywhere;flex:1}.attachment-row small{display:block;margin-top:.3rem;color:var(--text-muted);line-height:1.5}.attachment-row .el-checkbox{margin:0;flex-shrink:0}.attachment-unavailable{cursor:default}.attachment-row .attachment-reason{color:var(--el-color-warning)}
.provider-connections{max-width:1200px;margin:0 auto;width:100%;box-sizing:border-box;padding:1.25rem}.connections-heading,.connection-card>header{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem}.connections-heading h2,.connection-card h3{margin:0 0 .5rem}.connections-heading p,.connection-card p,.legacy-connections p{margin:.3rem 0 .8rem;color:var(--text-muted);line-height:1.6;overflow-wrap:anywhere}.connection-actions,.connection-card footer{display:flex;gap:.6rem;flex-wrap:wrap}.connection-actions{flex-shrink:0}.connection-actions .el-button,.connection-card footer .el-button{margin-left:0}.connection-guide{display:flex;gap:1.5rem;flex-wrap:wrap;padding:1rem 0;color:var(--text-secondary)}.connection-card{border:1px solid var(--el-border-color);border-radius:12px;padding:1.2rem;margin:1rem 0;background:var(--bg-secondary)}.connection-card header>div{min-width:0}.connection-card h3{overflow-wrap:anywhere}.connection-models>div{display:flex;gap:.8rem;padding:.6rem 0;border-top:1px solid var(--el-border-color);align-items:flex-start;flex-wrap:wrap}.connection-models strong{min-width:4rem}.connection-models span{flex:1;min-width:10rem;overflow-wrap:anywhere;line-height:1.6}.connection-card footer{margin-top:1rem}.connection-key{font-size:13px}.connection-error{padding:.8rem;border:1px solid var(--el-color-danger);color:var(--el-color-danger);border-radius:8px;overflow-wrap:anywhere}.legacy-connections{margin:1.5rem 0;border-top:1px solid var(--el-border-color);padding-top:1rem}.legacy-connections summary{cursor:pointer;font-weight:600;padding:.6rem 0}.legacy-row{display:flex;justify-content:space-between;gap:1rem;align-items:center;padding:.8rem 0;border-bottom:1px solid var(--el-border-color)}.legacy-row>div{min-width:0;overflow-wrap:anywhere}.legacy-row small{display:block;color:var(--text-muted);margin-top:.3rem}.connection-empty{padding:2rem 0;color:var(--text-muted)}@media(max-width:600px){.provider-connections{padding:.75rem}.connections-heading{flex-direction:column}.legacy-row{flex-wrap:wrap}.connection-guide{gap:.5rem}.connection-guide span{width:100%}}
</style>
<style>
.el-dialog.provider-connection-dialog{max-height:90dvh;display:flex;flex-direction:column}.provider-connection-dialog .el-dialog__body{overflow-y:auto;min-height:0}.provider-connection-dialog .el-dialog__header,.provider-connection-dialog .el-dialog__footer{flex-shrink:0}.provider-connection-dialog .el-select{width:100%}
</style>
