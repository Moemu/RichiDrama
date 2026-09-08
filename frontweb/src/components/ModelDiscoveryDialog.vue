<template>
  <el-dialog :model-value="modelValue" class="catalog-dialog discovery-dialog" title="获取模型" top="5vh" width="min(820px, 94vw)" append-to-body :close-on-click-modal="false" :before-close="close">
    <p class="discovery-intro">读取供应商列表，选择后导入当前连接。新型号保存为待上架。</p>
    <div v-if="error" class="discovery-error" role="alert">{{ error }}<el-button v-if="!connections.length" link @click="loadConnections">重试</el-button></div>
    <div v-if="fetched" class="discovery-current"><div><strong>{{ target?.name }}</strong><small>{{ types[target?.service_type] }} · {{ source === 'openai' ? 'OpenAI / OpenAI 兼容' : '火山方舟 · 已部署模型' }}</small></div><el-button link :disabled="fetching || saving" @click="showSource = !showSource">{{ showSource ? '收起来源' : '更改来源' }}</el-button><el-button link :loading="fetching" :disabled="saving" @click="fetchModels()">重新获取</el-button></div>
    <el-form v-show="showSource || !fetched" label-position="top" v-loading="loading">
      <el-form-item label="导入到连接">
        <el-select v-model="configId" filterable placeholder="选择已保存的连接" :disabled="fetching || saving" @change="changeConnection" class="discovery-full">
          <el-option v-for="config in connections" :key="config.id" :value="config.id" :label="`${config.name} · ${types[config.service_type]}`" />
        </el-select>
      </el-form-item>
      <div class="discovery-source-fields">
        <el-form-item label="模型列表来源">
          <el-select v-model="source" :disabled="fetching || saving" @change="resetResults" class="discovery-full">
            <el-option label="OpenAI / OpenAI 兼容" value="openai" />
            <el-option label="火山方舟 · 已部署模型" value="volcengine_endpoints" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="source === 'volcengine_endpoints'" label="ModelArk 管理凭据">
          <el-select v-model="credentialId" placeholder="选择同一火山账号的 AK/SK 配置" :disabled="fetching || saving" @change="resetResults" class="discovery-full">
            <el-option v-for="config in availableCredentials" :key="config.id" :label="config.name" :value="config.id" />
          </el-select>
        </el-form-item>
      </div>
      <p class="discovery-help" v-if="source === 'openai'">使用连接中已保存的地址和 API Key 读取 /models。仅适用于支持该接口的供应商。</p>
      <p class="discovery-help" v-else>读取已部署的 ep-… 模型 ID。请选择与目标连接同账号、同区域的 ModelArk 配置；不包含未部署的公共模型。</p>
      <p class="discovery-help" v-if="source === 'volcengine_endpoints' && !availableCredentials.length">暂无可用管理凭据。请先在供应商连接中保存 ModelArk 资产库的长期 AK/SK，并授予 ListEndpoints 读取权限。</p>
      <div class="discovery-fetch"><el-button type="primary" :loading="fetching" :disabled="!configId || saving || (source === 'volcengine_endpoints' && !credentialId)" @click="fetchModels()">{{ fetched ? '重新获取' : '获取模型列表' }}</el-button><span v-if="target">将导入为「{{ types[target.service_type] }}」模型，请确认所选型号支持该用途。</span></div>
    </el-form>

    <section v-if="fetched" class="discovery-results" aria-label="获取结果">
      <div class="discovery-results-heading"><h3>获取结果 <small>{{ models.length }} 个</small></h3><span>已选 {{ chosen.length }} / 200</span></div>
      <p v-if="ignored" class="discovery-help">{{ ignored }} 条无效型号已跳过。</p>
      <el-input v-model="search" placeholder="搜索已获取的模型 ID 或名称" clearable aria-label="搜索获取结果" :disabled="saving" />
      <div class="discovery-selection"><el-button link :disabled="saving || !visibleModels.length" @click="selectPage">选择本页</el-button><el-button link :disabled="saving || !chosen.length" @click="chosen = []">清空选择</el-button><span>{{ matching.length }} 个匹配</span></div>
      <div v-if="!matching.length" class="discovery-empty">{{ models.length ? '没有匹配型号，请调整搜索条件。' : '供应商未返回模型。请检查账号权限或部署状态。' }}</div>
      <div v-for="model in visibleModels" :key="model.id" class="discovery-model">
        <el-checkbox :model-value="chosen.includes(model.id)" :disabled="saving || model.configured || (chosen.length >= 200 && !chosen.includes(model.id))" :aria-label="`选择 ${model.id}`" @change="checked => toggle(model.id, checked)" />
        <div class="discovery-model-name"><strong>{{ model.id }}</strong><small v-if="model.display_name !== model.id">{{ model.display_name }}</small><small v-if="model.provider_status">供应商状态：{{ model.provider_status }}</small></div>
        <el-tag v-if="model.configured" size="small" type="info">已在连接中</el-tag>
      </div>
      <el-pagination v-if="matching.length > 20" v-model:current-page="page" :page-size="20" :total="matching.length" layout="prev, pager, next" :pager-count="5" :disabled="saving" class="discovery-pagination" />
      <el-button v-if="nextPage" :loading="fetching" :disabled="saving" @click="fetchModels(nextPage)">继续获取（已读取 {{ models.length }} / {{ total }}）</el-button>
    </section>
    <template #footer><span class="discovery-footer-note">保留已有模型、默认值和价格。</span><el-button :disabled="saving" @click="close()">取消</el-button><el-button type="primary" :disabled="!chosen.length || fetching" :loading="saving" @click="importModels">导入所选（{{ chosen.length }}）</el-button></template>
  </el-dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { modelDiscoveryAPI } from '@/api/modelDiscovery'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue', 'imported'])
const types = { text: '文本', image: '图片', storyboard_image: '分镜图片', video: '视频', tts: '语音' }
const connections = ref([]); const credentials = ref([]); const configId = ref(null); const credentialId = ref(null); const source = ref('openai')
const loading = ref(false); const fetching = ref(false); const saving = ref(false); const error = ref('')
const models = ref([]); const chosen = ref([]); const fetched = ref(false); const nextPage = ref(null); const total = ref(0); const ignored = ref(0)
const search = ref(''); const page = ref(1); const showSource = ref(true)
let requestVersion = 0
const target = computed(() => connections.value.find(config => config.id === configId.value))
const availableCredentials = computed(() => credentials.value.filter(config => !config.owner_tenant_id || config.owner_tenant_id === target.value?.owner_tenant_id))
const matching = computed(() => models.value.filter(model => `${model.id} ${model.display_name}`.toLowerCase().includes(search.value.trim().toLowerCase())))
const visibleModels = computed(() => matching.value.slice((page.value - 1) * 20, page.value * 20))
watch(search, () => { page.value = 1 })
watch(() => props.modelValue, open => { if (open) loadConnections(); else { requestVersion++; fetching.value = false } })
function resetResults() { requestVersion++; models.value = []; chosen.value = []; fetched.value = false; nextPage.value = null; total.value = 0; ignored.value = 0; search.value = ''; page.value = 1; error.value = ''; showSource.value = true }
function changeConnection() { source.value = target.value?.source || 'openai'; credentialId.value = null; resetResults() }
async function loadConnections() {
  resetResults(); configId.value = null; credentialId.value = null; source.value = 'openai'; connections.value = []; credentials.value = []; loading.value = true
  const version = requestVersion
  try { const data = await modelDiscoveryAPI.connections(); if (version !== requestVersion) return; connections.value = data.connections; credentials.value = data.credentials; if (!connections.value.length) error.value = '暂无连接，请先在供应商连接中保存接入信息' }
  catch (e) { if (version === requestVersion) error.value = e.message || '读取连接失败' }
  finally { if (version === requestVersion) loading.value = false }
}
async function fetchModels(next = 1) {
  if (next === 1) resetResults()
  const version = requestVersion; fetching.value = true; error.value = ''
  try {
    const data = await modelDiscoveryAPI.fetch(configId.value, { source: source.value, credential_config_id: credentialId.value, page: next })
    if (version !== requestVersion) return
    models.value = [...new Map([...models.value, ...data.models].map(model => [model.id, model])).values()]
    nextPage.value = data.next_page; total.value = data.total; ignored.value += data.ignored; fetched.value = true; showSource.value = false
  } catch (e) { if (version === requestVersion) error.value = e.message || '获取失败，请重试' }
  finally { if (version === requestVersion) fetching.value = false }
}
function toggle(id, checked) { chosen.value = checked ? [...chosen.value, id] : chosen.value.filter(value => value !== id) }
function selectPage() { chosen.value = [...new Set([...chosen.value, ...visibleModels.value.filter(model => !model.configured).map(model => model.id)])].slice(0, 200) }
function close(done) { if (saving.value) return; emit('update:modelValue', false); if (typeof done === 'function') done() }
async function importModels() {
  saving.value = true; error.value = ''
  try { const result = await modelDiscoveryAPI.import(configId.value, chosen.value); ElMessage.success(`已导入 ${result.added.length} 个模型${result.skipped ? `，跳过 ${result.skipped} 个已有型号` : ''}`); emit('imported'); emit('update:modelValue', false) }
  catch (e) { error.value = e.message || '导入失败，请重试' }
  finally { saving.value = false }
}
</script>

<style scoped>
.discovery-current{display:flex;align-items:center;flex-wrap:wrap;gap:.75rem;padding:.85rem;border:1px solid var(--el-border-color);border-radius:8px;margin-bottom:1rem}.discovery-current>div{flex:1;min-width:9rem;overflow-wrap:anywhere}.discovery-current small{display:block;margin-top:.3rem;color:var(--text-muted);font-size:12px}
.discovery-intro{margin:0 0 1.25rem;line-height:1.6}.discovery-full{width:100%}.discovery-source-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.discovery-help,.discovery-fetch>span,.discovery-footer-note{color:var(--text-muted);font-size:13px;line-height:1.6}.discovery-help{margin:0 0 1rem}.discovery-fetch{display:flex;align-items:center;flex-wrap:wrap;gap:.8rem}.discovery-fetch>span{flex:1;min-width:12rem}.discovery-error{padding:.8rem;margin-bottom:1rem;border:1px solid var(--el-color-danger);border-radius:8px;color:var(--el-color-danger);overflow-wrap:anywhere}.discovery-results{margin-top:1.5rem}.discovery-results-heading,.discovery-selection{display:flex;align-items:center;justify-content:space-between;gap:.7rem}.discovery-results-heading h3{margin:.5rem 0}.discovery-results-heading small{color:var(--text-muted);font-weight:400}.discovery-selection{justify-content:flex-start;margin:.65rem 0}.discovery-selection>span{margin-left:auto;color:var(--text-muted);font-size:13px}.discovery-model{display:flex;align-items:center;gap:.8rem;padding:.8rem 0;border-bottom:1px solid var(--el-border-color)}.discovery-model-name{flex:1;min-width:0;overflow-wrap:anywhere}.discovery-model-name strong{font-size:14px}.discovery-model-name small{display:block;color:var(--text-muted);margin-top:.3rem}.discovery-model>.el-checkbox{margin:0}.discovery-pagination{margin:1rem 0;justify-content:center}.discovery-empty{padding:1.5rem 0;color:var(--text-muted)}.discovery-footer-note{margin-right:auto;text-align:left}@media(max-width:600px){.discovery-source-fields{grid-template-columns:minmax(0,1fr);gap:0}.discovery-model{flex-wrap:wrap}.discovery-model>.el-tag{margin-left:2rem}.discovery-footer-note{flex-basis:100%}}
</style>
<style>
.discovery-dialog .el-dialog__footer{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:.5rem}.discovery-dialog .el-dialog__footer .el-button{margin-left:0}
</style>
