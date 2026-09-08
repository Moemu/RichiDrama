<template>
  <section class="model-catalog" v-loading="loading">
    <header class="catalog-heading">
      <div><h2>模型目录</h2><p>在这里维护模型、价格和上下架。现有配置沿用原行为，主动上下架后纳入目录管理。</p></div>
      <div class="catalog-actions"><el-button @click="load">刷新</el-button><el-button @click="$emit('connection')">供应商连接</el-button><el-button @click="showDiscovery = true">获取模型</el-button><el-button type="primary" @click="openAdd">添加模型</el-button></div>
    </header>
    <div v-if="error" role="alert" class="catalog-error">{{ error }} <el-button link @click="load">重试</el-button></div>
    <div class="catalog-filters">
      <el-input v-model="search" placeholder="搜索模型名称、ID 或供应商" clearable aria-label="搜索模型" />
      <el-select v-model="typeFilter" clearable placeholder="全部类型" aria-label="筛选服务类型"><el-option v-for="(label, key) in types" :key="key" :label="label" :value="key" /></el-select>
      <el-select v-model="statusFilter" clearable placeholder="全部状态" aria-label="筛选模型状态"><el-option v-for="(label, key) in statuses" :key="key" :label="label" :value="key" /></el-select>
      <span>{{ filtered.length }} 个模型</span>
    </div>
    <div class="catalog-table">
      <el-table :data="filtered" row-key="catalog_key">
        <el-table-column label="模型" min-width="220"><template #default="{ row }"><strong>{{ row.display_name }}</strong><small>{{ row.model }}</small></template></el-table-column>
        <el-table-column label="类型" width="100"><template #default="{ row }">{{ types[row.service_type] }}</template></el-table-column>
        <el-table-column label="连接" min-width="170"><template #default="{ row }"><span v-for="connection in row.connections" :key="connection.id" class="connection-name">{{ connection.name }}{{ connection.is_active ? '' : '（停用）' }}</span></template></el-table-column>
        <el-table-column label="状态" width="115"><template #default="{ row }"><el-tag :type="row.status === 'active' ? 'success' : 'info'">{{ statuses[row.status] }}</el-tag></template></el-table-column>
        <el-table-column label="定价" width="110"><template #default="{ row }"><el-tag :type="row.price_ready ? 'success' : 'warning'">{{ row.price_ready ? '已有价格' : '待定价' }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="140"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row)">管理 / 定价</el-button></template></el-table-column>
        <template #empty>{{ rows.length ? '未找到匹配模型，请调整筛选条件。' : '暂无模型。先添加供应商连接，再添加模型。' }}</template>
      </el-table>
    </div>

    <el-dialog class="catalog-dialog" top="5vh" v-model="showAdd" title="添加模型" width="min(620px, 94vw)" append-to-body>
      <el-form label-position="top">
        <el-form-item label="供应商连接"><el-select v-model="add.config_id" filterable placeholder="选择已有连接" class="full"><el-option v-for="config in configs" :key="config.id" :value="config.id" :label="`${config.name} · ${types[config.service_type]}`" /></el-select></el-form-item>
        <el-button link type="primary" @click="showAdd = false; $emit('connection')">添加或编辑供应商连接</el-button>
        <el-form-item label="模型 ID"><el-input v-model="add.model" placeholder="填写供应商使用的模型 ID" /></el-form-item>
        <el-form-item label="显示名称"><el-input v-model="add.display_name" placeholder="可选，留空使用模型 ID" /></el-form-item>
        <p>保存为待上架。发布完整价格后，再上架供创作使用。</p>
      </el-form>
      <template #footer><el-button @click="showAdd = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveAdd">保存模型</el-button></template>
    </el-dialog>

    <el-dialog class="catalog-dialog" top="5vh" v-model="showDetail" :title="selected?.display_name || '模型管理'" width="min(860px, 94vw)" append-to-body>
      <template v-if="selected">
        <div class="model-summary"><span>{{ types[selected.service_type] }}</span><el-tag size="small">{{ statuses[selected.status] }}</el-tag><span v-if="selected.display_name !== selected.model" class="model-identity">{{ selected.model }}</span></div>
        <el-tabs v-model="detailTab">
        <el-tab-pane label="价格配置" name="pricing">
        <div class="pricing-intro">保存草稿后审核发布，新请求才会使用新价格。</div>
        <el-form label-position="top" class="price-book-form"><el-form-item label="调整的价目表">
        <el-select v-model="bookId" placeholder="选择已发布价目表" class="full" @change="loadPriceItems"><el-option v-for="book in publishedBooks" :key="book.id" :label="book.name" :value="book.id" /></el-select>
        </el-form-item></el-form>
        <p class="pricing-help">仅调整当前模型。各项目组继续使用各自绑定的价目表。</p>
        <p v-if="!publishedBooks.length">尚无已发布价目表，请先在运营工作台初始化价目。</p>
        <el-select v-if="billingKeys.length > 1" v-model="billingKey" class="full" @change="loadPriceItems"><el-option v-for="key in billingKeys" :key="key" :label="key" :value="key" /></el-select>
        <div v-for="(item, index) in priceItems" :key="index" class="catalog-price-item">
          <div class="price-item-heading"><strong>计价项 {{ index + 1 }}</strong><el-button link type="danger" @click="priceItems.splice(index, 1)">删除</el-button></div>
          <div class="price-inputs"><label class="price-field"><span>计量单位</span><el-select v-model="item.meter" aria-label="计量单位"><el-option v-for="meter in meters" :key="meter" :value="meter" :label="meterNames[meter]" /></el-select></label><label class="price-field"><span>单价（积分）</span><el-input-number v-model="item.unit_price" :disabled="item.is_free" :min="0" :precision="4" controls-position="right" aria-label="单价积分" /></label><el-checkbox v-model="item.is_free">免费</el-checkbox></div>
          <el-collapse><el-collapse-item title="计价条件（单位数量、分档与规格）" :name="index"><el-input v-model="item.conditions_text" type="textarea" :rows="4" placeholder='可选 JSON，例如 {"unit_size": 1000000}' /></el-collapse-item></el-collapse>
        </div>
        <el-button @click="addPriceItem">添加计价项</el-button>
        <el-collapse class="price-history"><el-collapse-item :title="`价格版本（${selected.prices.length}）`" name="versions">
        <p v-if="!selected.prices.length" class="pricing-help">此模型暂无价格版本。保存草稿后可在这里查看。</p>
        <div v-for="book in selected.prices" :key="book.id" class="price-version"><strong>{{ book.name }} · {{ book.status === 'published' ? '已发布' : book.status === 'draft' ? '草稿' : '历史版本' }}</strong><small v-for="item in book.items" :key="item.id">{{ meterNames[item.meter] }}：{{ item.is_free ? '免费' : `${item.unit_price} 积分` }} / {{ item.conditions_json?.unit_size || 1 }} 单位</small><el-button v-if="book.status === 'draft'" link type="primary" @click="reviewDraft(book)">审核草稿</el-button></div>
        </el-collapse-item></el-collapse>
        </el-tab-pane>
        <el-tab-pane label="模型管理" name="management">
        <p class="pricing-help">上下架仅影响新请求。历史记录和已预授权任务保持原价格。</p>
        <p v-if="selected.status === 'legacy'">此模型沿用现有配置。主动上下架后纳入目录管理。</p>
        <div class="detail-actions"><el-button v-if="selected.status !== 'active'" type="primary" :loading="saving" @click="setStatus('active')">上架模型</el-button><el-button v-if="selected.status !== 'retired'" type="danger" plain :loading="saving" @click="setStatus('retired')">下架模型</el-button><el-button @click="$emit('connection', selected.connections[0]?.id); showDetail = false">编辑连接 / 默认模型</el-button></div>
        </el-tab-pane>
        </el-tabs>
      </template>
      <template #footer><el-button @click="showDetail = false">关闭</el-button><el-button v-if="detailTab === 'pricing'" type="primary" :disabled="!bookId" :loading="saving" @click="saveDraft">保存调价草稿</el-button></template>
    </el-dialog>

    <el-dialog class="catalog-dialog" top="5vh" v-model="showPublish" title="审核调价草稿" width="min(680px, 94vw)" append-to-body>
      <p>{{ draft?.name }}</p><p>下列计价项将在发布后立即生效。已预授权任务保持原价格。</p>
      <div v-for="item in draftItems" :key="`${item.service_type}:${item.model}:${item.meter}`" class="price-version"><strong>{{ item.model }} · {{ meterNames[item.meter] }}：{{ item.is_free ? '免费' : `${item.unit_price} 积分` }}</strong><small>{{ JSON.stringify(item.conditions_json || {}) }}</small></div>
      <el-form label-position="top"><el-form-item label="发布原因"><el-input v-model="publishReason" /></el-form-item></el-form>
      <template #footer><el-button @click="showPublish = false">保留草稿</el-button><el-button type="primary" :loading="saving" @click="publish">确认发布</el-button></template>
    </el-dialog>
    <ModelDiscoveryDialog v-model="showDiscovery" @imported="load(); emit('changed')" />
    <details class="provider-sync"><summary>供应商价格同步（火山）</summary><ProviderPriceSyncPanel @published="load" @draft-created="load" /></details>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/utils/request'
import { adminAPI } from '@/api/account'
import ProviderPriceSyncPanel from './ProviderPriceSyncPanel.vue'
import ModelDiscoveryDialog from './ModelDiscoveryDialog.vue'

const emit = defineEmits(['connection', 'changed'])
const types = { text: '文本', image: '图片', storyboard_image: '分镜图片', video: '视频', video_postprocess: '视频后处理', tts: '语音' }
const statuses = { legacy: '现有配置', draft: '待上架', active: '已上架', retired: '已下架' }
const meterNames = { request: '请求', image: '图片', input_image: '输入图', second: '秒', millisecond: '毫秒', character: '字符', input_token: '输入 Token', output_token: '输出 Token' }
const meters = Object.keys(meterNames)
const rows = ref([]); const configs = ref([]); const books = ref([]); const error = ref(''); const loading = ref(false); const saving = ref(false)
const search = ref(''); const typeFilter = ref(''); const statusFilter = ref('')
const showAdd = ref(false); const showDetail = ref(false); const showPublish = ref(false); const selected = ref(null)
const detailTab = ref('pricing')
const showDiscovery = ref(false)
const add = reactive({ config_id: null, model: '', display_name: '' })
const bookId = ref(null); const billingKey = ref(''); const priceItems = ref([]); const draft = ref(null); const publishReason = ref('')
const filtered = computed(() => rows.value.filter(row => (!typeFilter.value || row.service_type === typeFilter.value) && (!statusFilter.value || row.status === statusFilter.value) && `${row.display_name} ${row.model} ${row.connections.map(c => c.provider).join(' ')}`.toLowerCase().includes(search.value.trim().toLowerCase())))
const publishedBooks = computed(() => books.value.filter(book => book.status === 'published'))
const billingKeys = computed(() => [...new Set((selected.value?.connections || []).map(c => c.billing_key))])
const draftItems = computed(() => {
  const base = books.value.find(book => book.id === draft.value?.parent_price_book_id)
  return (draft.value?.items || []).filter(item => {
    const old = base?.items.find(prior => prior.service_type === item.service_type && prior.model === item.model && prior.meter === item.meter)
    return !old || old.unit_price !== item.unit_price || old.is_free !== item.is_free || JSON.stringify(old.conditions_json) !== JSON.stringify(item.conditions_json)
  })
})
async function load() {
  loading.value = true; error.value = ''
  try {
    const [catalog, priceBooks] = await Promise.all([request.get('/admin/model-catalog'), adminAPI.priceBooks()])
    rows.value = catalog.map(row => ({ ...row, catalog_key: `${row.service_type}:${row.model}` }))
    configs.value = [...new Map(catalog.flatMap(row => row.connections.map(connection => [connection.id, { ...connection, service_type: row.service_type }]))).values()]
    books.value = priceBooks
    if (selected.value) selected.value = rows.value.find(row => row.model === selected.value.model && row.service_type === selected.value.service_type) || selected.value
  } catch (e) { error.value = e.message || '读取模型目录失败' } finally { loading.value = false }
}
function openAdd() { Object.assign(add, { config_id: null, model: '', display_name: '' }); showAdd.value = true }
async function saveAdd() {
  const config = configs.value.find(c => c.id === add.config_id)
  if (!config || !add.model.trim()) return ElMessage.warning('请选择连接并填写模型 ID')
  if (rows.value.some(row => row.service_type === config.service_type && row.model === add.model.trim())) return ElMessage.warning('此模型已在目录中，请从列表进入管理')
  saving.value = true
  try { await request.post('/admin/model-catalog', { ...add, service_type: config.service_type, status: 'draft' }); showAdd.value = false; await load(); emit('changed'); ElMessage.success('模型已保存，请完成定价后上架') } catch (e) { ElMessage.error(e.message) } finally { saving.value = false }
}
function openDetail(row) { selected.value = row; detailTab.value = 'pricing'; billingKey.value = row.connections[0]?.billing_key || row.model; bookId.value = row.prices.find(b => b.status === 'published')?.id || publishedBooks.value[0]?.id || null; loadPriceItems(); showDetail.value = true }
function loadPriceItems() {
  const source = books.value.find(b => b.id === bookId.value)?.items.filter(item => item.service_type === selected.value.service_type && item.model === billingKey.value) || []
  priceItems.value = source.map(item => ({ ...item, conditions_text: item.conditions_json ? JSON.stringify(item.conditions_json, null, 2) : '' }))
  if (!priceItems.value.length) {
    const defaults = selected.value.service_type === 'text' ? ['input_token', 'output_token'] : selected.value.service_type.includes('image') ? ['image'] : selected.value.service_type === 'tts' ? ['character'] : selected.value.service_type === 'video_postprocess' ? ['millisecond'] : ['second']
    priceItems.value = defaults.map(meter => ({ meter, unit_price: 0, is_free: false, conditions_text: '' }))
  }
}
function addPriceItem() { priceItems.value.push({ meter: 'request', unit_price: 0, is_free: false, conditions_text: '' }) }
function reviewDraft(book) { draft.value = books.value.find(item => item.id === book.id); publishReason.value = `调整 ${selected.value.display_name} 价格`; showPublish.value = true }
async function setStatus(status) {
  try { await ElMessageBox.confirm(status === 'retired' ? '下架后禁止新的生成请求。请确认已处理默认模型和业务场景。' : '确认上架此模型？项目组权限和价目表仍分别生效。', status === 'retired' ? '下架模型' : '上架模型', { type: 'warning' }) } catch { return }
  saving.value = true
  try { await request.post('/admin/model-catalog', { service_type: selected.value.service_type, model: selected.value.model, display_name: selected.value.display_name, status }); await load(); emit('changed'); ElMessage.success('模型状态已更新') } catch (e) { ElMessage.error(e.message) } finally { saving.value = false }
}
async function saveDraft() {
  saving.value = true
  try {
    const items = priceItems.value.map(item => ({ meter: item.meter, unit_price: item.unit_price, is_free: item.is_free, conditions_json: item.conditions_text.trim() ? JSON.parse(item.conditions_text) : null }))
    draft.value = await request.post('/admin/model-catalog/price-draft', { service_type: selected.value.service_type, model: selected.value.model, billing_key: billingKey.value, price_book_id: bookId.value, items })
    publishReason.value = `调整 ${selected.value.display_name} 价格`; showPublish.value = true; await load()
  } catch (e) { ElMessage.error(e instanceof SyntaxError ? '计价条件必须是有效 JSON' : e.message) } finally { saving.value = false }
}
async function publish() {
  if (!publishReason.value.trim()) return ElMessage.warning('请填写发布原因')
  saving.value = true
  try { await adminAPI.publishPriceBook(draft.value.id, { confirm: true, reason: publishReason.value, idempotency_key: `catalog-publish:${draft.value.id}`, notice_title: '模型价格已更新', notice_body: `${selected.value.display_name} 价格已更新。新请求立即生效，已预授权任务保持原价格。` }); showPublish.value = false; await load(); emit('changed'); ElMessage.success('价格已发布'); bookId.value = draft.value.id; loadPriceItems() } catch (e) { ElMessage.error(e.message) } finally { saving.value = false }
}
onMounted(load)
defineExpose({ load })
</script>

<style scoped>
.model-summary{display:flex;align-items:center;flex-wrap:wrap;gap:.6rem;margin:0 0 1rem;color:var(--text-muted);font-size:13px}.pricing-intro{margin:.25rem 0 1.25rem;line-height:1.6}.pricing-help{font-size:13px;color:var(--text-muted);line-height:1.6;margin:.5rem 0 1rem}.price-book-form :deep(.el-form-item){margin-bottom:0}.price-book-form .full{margin:0}.price-item-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:.8rem}.catalog-dialog .catalog-price-item{padding:1rem;margin:1rem 0;border:1px solid var(--el-border-color);border-radius:10px}.price-field{display:grid;gap:.5rem;min-width:0;flex:1}.price-field>span{font-size:13px;color:var(--text-muted)}.price-field .el-select,.price-field .el-input-number{width:100%}.catalog-dialog .price-inputs{align-items:end;margin-bottom:.75rem}.catalog-dialog .price-inputs>.el-checkbox{margin:0 0 .2rem .25rem}.price-history{margin-top:1.5rem}.catalog-dialog :deep(.el-tabs__content){overflow:visible}.catalog-dialog :deep(.el-collapse-item__header){line-height:1.5;height:auto;min-height:44px;padding:.5rem 0}@media(max-width:600px){.price-field{flex-basis:100%}}
.model-catalog{min-width:0}.catalog-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem}.catalog-heading h2{margin:0 0 .5rem}.catalog-heading p,.model-catalog p{color:var(--text-muted);line-height:1.6}.catalog-actions,.catalog-filters,.detail-actions{display:flex;flex-wrap:wrap;gap:.65rem;align-items:center}.catalog-actions{flex-shrink:0}.catalog-filters{margin:1.25rem 0}.catalog-filters>.el-input{width:18rem}.catalog-filters>.el-select{width:9rem}.catalog-table{width:100%;overflow-x:auto}.catalog-table small,.price-version small{display:block;overflow-wrap:anywhere;color:var(--text-muted);margin-top:.3rem}.connection-name{display:block;overflow-wrap:anywhere}.catalog-error{color:var(--el-color-danger);padding:1rem 0}.full{width:100%;margin-bottom:.7rem}.detail-actions{margin:1rem 0}.catalog-price-item{padding:.8rem 0;border-bottom:1px solid var(--el-border-color)}.price-inputs{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center}.price-inputs>.el-select{width:10rem}.price-version{padding:.75rem 0;border-bottom:1px solid var(--el-border-color)}.model-identity{overflow-wrap:anywhere}.provider-sync{margin-top:1.5rem}.provider-sync>summary{cursor:pointer;padding:1rem 0;font-weight:600}@media(max-width:900px){.catalog-heading{flex-direction:column}.catalog-actions{flex-shrink:1}}@media(max-width:600px){.catalog-filters>.el-input{width:100%}.catalog-filters>.el-select{flex:1}.price-inputs>.el-select{width:100%}}
</style>

<style>
.catalog-dialog{display:flex;flex-direction:column;max-height:90dvh;margin-bottom:5vh}.catalog-dialog .el-dialog__body{min-height:0;overflow-y:auto}.catalog-dialog .el-dialog__header,.catalog-dialog .el-dialog__footer{flex-shrink:0}
</style>
