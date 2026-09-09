<template>
  <main class="cost-workspace" :aria-busy="busy">
    <header class="page-heading">
      <div><p class="eyebrow">瑞池传媒 · 运营核算</p><h1>消耗与成本</h1><p>本平台调用日志确定项目用量，审核价格用于成本估算；全部时间为北京时间。</p></div>
      <router-link class="button" to="/admin">返回运营工作台</router-link>
    </header>
    <nav class="tabs" aria-label="成本工作区">
      <button v-for="item in tabs" :key="item.key" :aria-current="tab === item.key ? 'page' : undefined" @click="tab = item.key; error = ''; notice = ''">{{ item.label }}</button>
    </nav>
    <p v-if="error" ref="errorPanel" tabindex="-1" class="feedback error" role="alert">{{ error }}</p>
    <p v-if="notice" class="feedback" role="status">{{ notice }}</p>

    <template v-if="tab === 'query'">
      <form class="panel filters" @submit.prevent="refresh(true)">
        <label>开始日期<input v-model="filters.date_from" type="date" required></label>
        <label>结束日期<input v-model="filters.date_to" type="date" required></label>
        <label>客户<select v-model="filters.organization_id" @change="filters.customer_kind = ''"><option value="">全部客户与个人</option><option v-for="c in customers" :key="c.id" :value="String(c.id)">{{ c.name }} #{{ c.id }}</option></select></label>
        <label>项目 ID<input v-model="filters.drama_id" type="number" min="0" placeholder="全部项目"></label>
        <label>执行用户 ID<input v-model="filters.user_id" type="number" min="0" placeholder="全部用户"></label>
        <label>供应商账号<select v-model="filters.account_id"><option value="">全部账号</option><option value="0">账号未确定</option><option v-for="a in accounts.items" :key="a.id" :value="String(a.id)">{{ a.name }}</option></select></label>
        <label>模型<input v-model="filters.model" placeholder="输入完整模型名"></label>
        <label>操作类型<input v-model="filters.source_kind" placeholder="全部操作"></label>
        <label>成本状态<select v-model="filters.cost_status"><option value="">全部状态</option><option v-for="(label, key) in costStatuses" :key="key" :value="key">{{ label }}</option></select></label>
        <div class="form-actions"><button class="primary" :disabled="busy">查询</button><button type="button" :disabled="busy" @click="reset">重置筛选</button></div>
        <p v-if="filters.customer_kind" class="full">归属筛选：{{ filters.customer_kind === 'personal' ? '个人账户' : '未知客户' }}</p>
      </form>
      <template v-if="summary">
        <section class="metrics" aria-label="成本汇总">
          <article><span>已计算成本估算</span><strong>{{ costMoney(summary.cny_micro) }}</strong><small>{{ summary.calculated_calls || 0 }} / {{ summary.calls }} 次已计算</small></article>
          <article><span>已记录 Token</span><strong>{{ number(summary.total_tokens) }}</strong><small>输入、缓存和输出不重复累加</small></article>
          <article><span>未完成调用</span><strong>{{ summary.processing_calls || 0 }}</strong><small>按原提交月份归属</small></article>
          <article><span>缺用量 / 缺价格</span><strong>{{ summary.missing_usage_calls || 0 }} / {{ summary.missing_price_calls || 0 }}</strong><small>待核实 {{ summary.unverified_calls || 0 }} 次</small></article>
        </section>
        <section class="panel coverage">
          <p :class="{ warning: summary.incomplete }">{{ summary.empty_message || (summary.incomplete ? '汇总尚不完整：未确定项未计入已计算成本。' : '当前记录范围内的调用均已计算。') }}</p>
          <p>归属未确定：客户 {{ summary.unknown_customer_calls || 0 }} 次 · 供应商账号 {{ summary.unknown_account_calls || 0 }} 次。</p>
          <p>自动记录起点：{{ chinaTime(summary.coverage_start) }}。更早的数据仅包含显式补算记录。</p>
          <p>文本输入 {{ number(summary.input_token) }} · 缓存 {{ number(summary.cache_token) }} · 文本输出 {{ number(summary.text_output_token) }} · 视频输出 {{ number(summary.video_output_token) }} Token</p>
          <p>图片 {{ number(summary.image) }} 张 · 处理时长 {{ number(summary.millisecond / 1000 + summary.second) }} 秒 · 字符 {{ number(summary.character) }}</p>
          <p v-for="currency in summary.currencies.filter(c => c.currency !== 'CNY')" :key="currency.currency">原币成本：{{ costMoney(currency.amount_micro, currency.currency) }}（不换算）</p>
          <p>平台扣费 {{ summary.platform_points == null ? '归属未确定' : number(summary.platform_points) }} 积分，按结算时间统计。{{ summary.platform_points_scope }}。跨月差额不代表毛利。</p>
        </section>
      </template>
      <section class="panel">
        <div class="section-heading"><h2>消耗构成</h2><label>分组<select v-model="groupBy" :disabled="busy" @change="groupPage = 1; loadGroups()"><option v-for="g in groups" :key="g.key" :value="g.key">{{ g.label }}</option></select></label></div>
        <div class="table-scroll" tabindex="0" aria-label="消耗构成表，可横向滚动"><table>
          <thead><tr><th>分组</th><th>调用次数</th><th>已计算 / 未确定</th><th>成本估算（原币）</th><th>操作</th></tr></thead>
          <tbody><tr v-for="row in breakdown.items" :key="row.key"><td>{{ row.label || (groupBy === 'project' ? '未关联项目' : groupBy === 'user' ? '未知用户' : customerLabel(row.key)) }}</td><td>{{ row.calls }}</td><td>{{ row.calculated_calls || 0 }} / {{ row.calls - (row.calculated_calls || 0) }}</td><td>{{ row.currencies?.length ? row.currencies.map(c => costMoney(c.amount_micro, c.currency)).join(' · ') : '未确定' }}</td><td><button v-if="['customer','project','user','model','operation'].includes(groupBy)" @click="drill(row)">查看构成与调用</button><span v-else>—</span></td></tr></tbody>
        </table></div>
        <p v-if="!breakdown.total">当前记录范围内无调用</p>
        <div class="pagination"><button :disabled="busy || groupPage <= 1" @click="groupPage--; loadGroups()">上一组页</button><span>第 {{ groupPage }} 页 · {{ breakdown.total }} 组</span><button :disabled="busy || groupPage * 20 >= breakdown.total" @click="groupPage++; loadGroups()">下一组页</button></div>
      </section>
      <section class="panel">
        <h2>调用明细</h2>
        <div class="table-scroll" tabindex="0" aria-label="调用明细表，可横向滚动"><table>
          <thead><tr><th>提交时间</th><th>客户 / 项目</th><th>执行用户 / 模型</th><th>调用 / 成本状态</th><th>已记录用量</th><th>成本估算</th><th>操作</th></tr></thead>
          <tbody><tr v-for="call in calls.items" :key="call.id"><td>{{ chinaTime(call.submitted_at) }}<small>{{ call.origin === 'historical_summary' ? '历史汇总记录' : `尝试 ${call.attempt}` }}</small></td><td>{{ call.organization_name || customerLabel(call.customer_kind) }}<small>{{ call.project_title || '未关联项目' }}</small></td><td>{{ call.user_name || '未知用户' }}<small>{{ call.model }}</small></td><td>{{ callStatuses[call.status] }}<small :class="{ warning: call.cost_status !== 'calculated' }">{{ costStatuses[call.cost_status] }}</small></td><td class="usage-cell">{{ usageText(call.usage) }}</td><td>{{ costMoney(call.amount_micro, call.currency || 'CNY') }}</td><td><button @click="openCall(call.id)">查看依据</button></td></tr></tbody>
        </table></div>
        <p v-if="!calls.total">当前记录范围内无调用</p>
        <div class="pagination"><button :disabled="busy || page <= 1" @click="page--; loadCalls()">上一页</button><span>第 {{ page }} 页 · {{ calls.total }} 次</span><button :disabled="busy || page * 20 >= calls.total" @click="page++; loadCalls()">下一页</button></div>
      </section>
      <section v-if="detail" ref="detailPanel" class="panel detail" tabindex="-1">
        <div class="section-heading"><h2>调用依据</h2><button @click="detail = null">关闭详情</button></div>
        <p>{{ detail.project_title || '未关联项目' }} · {{ detail.user_name || '未知用户' }} · {{ detail.model }}</p>
        <dl><dt>业务操作</dt><dd>{{ detail.operation_id }}</dd><dt>调用尝试</dt><dd>{{ detail.id }} · {{ detail.origin === 'historical_summary' ? '历史汇总，不能推断尝试次数' : `第 ${detail.attempt} 次` }}</dd><dt>供应商 / 账号 / 配置 / 连接</dt><dd>{{ detail.provider || '未知' }} / {{ detail.account_id || '未确定' }} / {{ detail.config_id || '未知' }} / {{ detail.connection_id || '未使用共享连接' }}</dd><dt>供应商任务 / 请求</dt><dd>{{ detail.provider_task_id || '—' }} / {{ detail.provider_request_id || '—' }}</dd><dt>提交时间</dt><dd>{{ chinaTime(detail.submitted_at) }} · {{ detail.time_basis === 'authorization_approximation' ? '按原预授权时间近似' : '供应商提交时间' }}</dd></dl>
        <details><summary>调用规格</summary><pre>{{ JSON.stringify(detail.context, null, 2) }}</pre></details>
        <article v-for="revision in detail.revisions" :key="revision.id" class="revision"><h3>修订 #{{ revision.id }} · {{ costStatuses[revision.cost_status] }}</h3><p>{{ chinaTime(revision.observed_at) }} · {{ revision.reason }}</p><p>{{ usageText(revision.usage) }}</p><p>{{ costMoney(revision.amount_micro, revision.currency || 'CNY') }} · 价格版本 #{{ revision.price_id || '未确定' }}</p><details><summary>计量证据</summary><pre>{{ JSON.stringify(revision.evidence, null, 2) }}</pre></details><details v-if="revision.price"><summary>价格依据：{{ revision.price.source }}</summary><p>{{ revision.price.currency }} · 生效 {{ chinaTime(revision.price.effective_from) }}</p><pre>{{ JSON.stringify(revision.price.rules, null, 2) }}</pre></details></article>
        <form class="inline-form" @submit.prevent="revise"><label>成本修订原因<input v-model="revisionReason" required placeholder="例如：补齐该次调用生效价格"></label><button :disabled="busy">按审核价格新增修订</button></form>
        <p class="muted">新增修订保留旧依据，不修改积分扣费和已保存月报。</p>
      </section>
    </template>

    <template v-if="tab === 'reports'">
      <section class="panel"><h2>客户月报</h2><p>保存当前核算结果为新版本。晚到用量和成本修订不会覆盖旧版本。</p>
        <form class="inline-form" @submit.prevent="saveReport"><label>客户<select v-model="reportForm.organization_id" required><option value="">请选择客户</option><option v-for="c in customers" :key="c.id" :value="c.id">{{ c.name }}</option></select></label><label>自然月<input v-model="reportForm.month" type="month" required></label><button class="primary" :disabled="busy">保存月报新版本</button></form>
      </section>
      <section class="panel"><h2>已保存版本</h2><p v-if="!reports.length">尚未保存月报。</p><div class="table-scroll" tabindex="0"><table><thead><tr><th>客户</th><th>月份 / 版本</th><th>统计截止时间</th><th>操作</th></tr></thead><tbody><tr v-for="r in reports" :key="r.id"><td>{{ customers.find(c => c.id === r.organization_id)?.name || `客户 #${r.organization_id}` }}</td><td>{{ r.month }} · v{{ r.version }}</td><td>{{ chinaTime(r.generated_at) }}</td><td><button @click="showReport(r.id)">查看月报</button></td></tr></tbody></table></div></section>
      <section v-if="report" class="panel"><h2>{{ report.summary.organization_name }} · {{ report.month }} · v{{ report.version }}</h2><p>供应商成本估算，非供应商实付账单。统计截止 {{ chinaTime(report.generated_at) }}</p><p>调用 {{ report.summary.calls }} 次，已计算 {{ report.summary.calculated_calls || 0 }} 次；{{ report.summary.incomplete ? '仍有未确定项，汇总尚不完整' : '当前记录范围内已计算完整' }}。</p><p v-for="c in report.summary.currencies" :key="c.currency">{{ costMoney(c.amount_micro, c.currency) }}</p><p>文本输入 {{ number(report.summary.input_token) }} · 缓存 {{ number(report.summary.cache_token) }} · 文本输出 {{ number(report.summary.text_output_token) }} · 视频输出 {{ number(report.summary.video_output_token) }} Token</p><p>图片 {{ report.summary.image }} 张 · 处理时长 {{ number(report.summary.millisecond / 1000 + report.summary.second) }} 秒 · 字符 {{ report.summary.character }}</p><p>平台扣费 {{ number(report.summary.platform_points) }} 积分（结算时间口径）。自动记录起点：{{ chinaTime(report.summary.coverage_start) }}</p><div class="actions"><a class="button" :href="reportExportUrl(false)" download>导出汇总 CSV</a><a class="button" :href="reportExportUrl(true)" download>导出全部明细 CSV</a></div></section>
    </template>

    <template v-if="tab === 'prices'">
      <section class="panel"><h2>供应商账号与连接归属</h2><p>账号由运营明确指定。多个配置可以属于同一账号；修改绑定只影响新提交。</p>
        <form class="inline-form" @submit.prevent="createAccount"><label>账号名称<input v-model="accountForm.name" required></label><label>供应商<input v-model="accountForm.provider" required placeholder="例如 volcengine"></label><button :disabled="busy">新增账号</button></form>
        <form class="inline-form" @submit.prevent="bindAccount"><label>供应商账号<select v-model="binding.account_id" required><option value="">请选择</option><option v-for="a in accounts.items" :key="a.id" :value="a.id">{{ a.name }}</option></select></label><label>配置<select v-model="binding.config_id" required><option value="">请选择</option><option v-for="c in accounts.configs" :key="c.id" :value="c.id">#{{ c.id }} {{ c.name }} · {{ c.service_type }}</option></select></label><button :disabled="busy">保存绑定</button></form>
        <ul><li v-for="b in accounts.bindings" :key="b.config_id">配置 #{{ b.config_id }} → {{ accounts.items.find(a => a.id === b.account_id)?.name }}</li></ul>
      </section>
      <section class="panel"><h2>读取候选价格</h2><p>使用上方选定的账号及其 ModelArk IAM 配置查询。返回价格不直接生效。</p><button :disabled="busy || !binding.account_id || !binding.config_id" @click="fetchPrices">读取供应商价格候选</button>
        <label class="source-select">历史候选批次<select @change="loadSource($event.target.value)"><option value="">选择批次</option><option v-for="s in sources" :key="s.id" :value="s.id">{{ chinaTime(s.fetched_at) }} · 账号 #{{ s.account_id }}</option></select></label>
        <template v-if="source"><p>来源：ListModelActivations · {{ chinaTime(source.fetched_at) }}</p><div class="table-scroll" tabindex="0"><table><thead><tr><th>模型</th><th>解析结果</th><th>操作</th></tr></thead><tbody><tr v-for="(c, i) in source.evidence.candidates" :key="i"><td>{{ c.model }}</td><td>{{ c.requires_mapping ? '复杂规格，请根据来源手动录入规则' : `${c.rules.length} 条候选规则` }}</td><td><button @click="useCandidate(c)">填入草稿</button><details><summary>来源价格与规格</summary><pre>{{ JSON.stringify(c.evidence, null, 2) }}</pre></details></td></tr></tbody></table></div></template>
      </section>
      <section class="panel"><h2>录入价格草稿</h2><p>适用价格直接计价，原价仅作审核依据。币种、单位、规格和生效时间均需确认。</p>
        <form class="filters" @submit.prevent="saveDraft">
          <label>价格来源账号<select v-model="priceForm.account_id" required><option value="">请选择</option><option v-for="a in accounts.items" :key="a.id" :value="a.id">{{ a.name }}</option></select></label><label>适用范围<select v-model="priceForm.scope"><option value="account">仅该供应商账号</option><option value="platform">本平台同模型</option><option value="project">指定项目同模型</option></select></label><label v-if="priceForm.scope === 'project'">适用项目 ID<input v-model="priceForm.drama_id" type="number" min="1" required></label><label>实际模型<input v-model="priceForm.model" required></label><label>服务<select v-model="priceForm.service_type"><option v-for="s in ['text','image','video','tts','video_postprocess']" :key="s">{{ s }}</option></select></label><label>币种<input v-model="priceForm.currency" required pattern="[A-Z]{3}" maxlength="3"></label><label>生效时间（北京时间）<input v-model="priceForm.from" type="datetime-local" required></label><label>失效时间（可选）<input v-model="priceForm.to" type="datetime-local"></label><label class="full">来源<input v-model="priceForm.source" required></label><label class="full">计费规则 JSON<textarea v-model="priceForm.rules" rows="9" spellcheck="false" required></textarea></label>
          <p class="full muted">meter：input_token、cache_token、output_token、image、input_image、request、millisecond、second、character。price 为适用价格，original_price 为原价；unit_size 为单位数量；when 为必要规格；input_min / input_max 为输入 Token 档位；free_units 为每次请求免费数量。缺少规格时不匹配价格。</p><button class="primary" :disabled="busy">保存待审核草稿</button>
        </form>
      </section>
      <section class="panel"><h2>价格版本审核</h2><p>组织账单可能包含其他平台。账单用于核对费率与总体金额，不能直接确定本平台项目归属。</p><p v-if="!prices.length">尚无成本价格版本。</p><article v-for="p in prices" :key="p.id" class="revision"><h3>#{{ p.id }} · {{ p.model }} · {{ p.status === 'published' ? '已发布' : '待审核' }}</h3><p>{{ accounts.items.find(a => a.id === p.account_id)?.name }} · {{ p.currency }} · {{ p.service_type }} · {{ p.scope === 'platform' ? '本平台同模型' : p.scope === 'project' ? `项目 #${p.drama_id} 同模型` : '仅该供应商账号' }}</p><p>{{ chinaTime(p.effective_from) }} 至 {{ p.effective_to ? chinaTime(p.effective_to) : '长期有效' }} · 来源：{{ p.source }}</p><pre>{{ JSON.stringify(p.rules, null, 2) }}</pre><template v-if="p.status === 'draft'"><label class="checkbox"><input v-model="reviewed[p.id]" type="checkbox">已核对价格来源、适用范围、原价与适用价格、单位、规格和生效时间</label><button :disabled="busy || !reviewed[p.id]" @click="publish(p.id)">确认发布此版本</button></template></article></section>
    </template>

    <template v-if="tab === 'backfill'">
      <section class="panel"><h2>历史补算</h2><p>先预览，再执行。只新增成本记录，保留原积分和任务状态。有真实用量即可入账，缺价格时显示待估算。每批最多 1000 条历史汇总。</p><form class="inline-form" @submit.prevent="preview"><label>原账本结算开始日期<input v-model="backfillForm.date_from" type="date" required></label><label>原账本结算结束日期<input v-model="backfillForm.date_to" type="date" required></label><label>客户 ID（可选）<input v-model="backfillForm.organization_id" type="number" min="1"></label><label>项目 ID（可选）<input v-model="backfillForm.drama_id" type="number" min="1"></label><button :disabled="busy">生成补算预览</button></form></section>
      <section v-if="batch" class="panel"><h2>批次预览</h2><p>{{ batch.preview.eligible }} 条可入账 · {{ batch.preview.skipped }} 条跳过。{{ batch.preview.priced ?? 0 }} 条可估算 · {{ batch.preview.unpriced ?? 0 }} 条待补价格或规格。时间缺少提交证据时，明确使用原预授权时间近似。</p><div class="table-scroll" tabindex="0"><table><thead><tr><th>来源记录</th><th>模型 / 时间</th><th>结果</th><th>原因 / 成本估算</th></tr></thead><tbody><tr v-for="item in batch.preview.items" :key="item.source_key"><td>{{ item.source_id }}<small>{{ item.label }}</small></td><td>{{ item.call.model }}<small>{{ chinaTime(item.call.submitted_at) }}</small></td><td>{{ item.eligible ? '可入账' : '跳过' }}</td><td>{{ item.eligible ? costMoney(item.calculation.amount_micro) : item.reasons.join('；') }}<small>{{ usageText(item.usage) }}</small><small v-if="item.warnings?.length">{{ item.warnings.join('；') }}</small></td></tr></tbody></table></div><p v-if="batch.result">已新增 {{ batch.result.inserted }} 条；执行时跳过 {{ batch.result.skipped.length }} 条。</p><template v-if="batch.status === 'preview'"><label class="checkbox"><input v-model="backfillConfirmed" type="checkbox">已检查预览及跳过原因，确认新增这些成本记录</label><button :disabled="busy || !backfillConfirmed" @click="execute">执行此批补算</button></template></section>
      <section class="panel"><h2>历史批次</h2><ul><li v-for="b in batches" :key="b.id"><button @click="showBatch(b.id)">{{ chinaTime(b.created_at) }} · {{ b.status === 'executed' ? '已执行' : '预览' }}</button></li></ul><p v-if="!batches.length">尚无补算批次。</p></section>
    </template>
  </main>
</template>

<script setup>
import { nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { costsAPI as api } from '@/api/costs'
import { adminAPI } from '@/api/account'
import { callStatuses, chinaDate, chinaTime, costMoney, costStatuses, usageText } from '@/utils/costPresentation'
const route = useRoute(), router = useRouter(), today = chinaDate()
const tabs = [{ key: 'query', label: '查询与明细' }, { key: 'reports', label: '客户月报' }, { key: 'prices', label: '账号与价格' }, { key: 'backfill', label: '历史补算' }]
const groups = [{ key: 'customer', label: '客户' }, { key: 'project', label: '项目' }, { key: 'user', label: '成员' }, { key: 'model', label: '模型' }, { key: 'operation', label: '操作类型' }, { key: 'hour', label: '小时' }, { key: 'day', label: '日期' }, { key: 'month', label: '月份' }]
const defaults = () => ({ date_from: today.slice(0, 7) + '-01', date_to: today, organization_id: '', drama_id: '', user_id: '', account_id: '', model: '', source_kind: '', cost_status: '', customer_kind: '' })
const filters = reactive({ ...defaults(), ...Object.fromEntries(Object.keys(defaults()).filter(k => typeof route.query[k] === 'string').map(k => [k, route.query[k]])) })
const appliedFilters = ref(Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')))
const errorPanel = ref(null)
const tab = ref('query'), busy = ref(false), error = ref(''), notice = ref(''), summary = ref(null)
const accounts = ref({ items: [], bindings: [], configs: [] }), customers = ref([]), prices = ref([]), reports = ref([]), sources = ref([]), batches = ref([])
const page = ref(1), groupPage = ref(1), groupBy = ref('customer'), calls = ref({ items: [], total: 0 }), breakdown = ref({ items: [], total: 0 })
const detail = ref(null), detailPanel = ref(null), revisionReason = ref(''), report = ref(null), source = ref(null), batch = ref(null), backfillConfirmed = ref(false), reviewed = reactive({})
const accountForm = reactive({ name: '', provider: '' }), binding = reactive({ account_id: '', config_id: '' })
const reportForm = reactive({ organization_id: '', month: today.slice(0, 7) })
const backfillForm = reactive({ date_from: today.slice(0, 7) + '-01', date_to: today, organization_id: '', drama_id: '' })
const priceForm = reactive({ account_id: '', scope: 'account', drama_id: '', model: '', service_type: 'text', currency: 'CNY', from: today + 'T00:00', to: '', source: '', rules: '[\n  { "meter": "output_token", "price": "0.01702", "unit_size": "1000" }\n]' })
const number = v => Number(v || 0).toLocaleString('zh-CN', { maximumFractionDigits: 3 })
const customerLabel = key => ({ personal: '个人账户', unknown: '未知客户' })[key] || key || '未关联'
const params = () => Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''))
async function perform(fn, message = '') { if (busy.value) return; busy.value = true; error.value = ''; notice.value = ''; try { await fn(); notice.value = message } catch (e) { error.value = e.message || '操作失败，请重试' } finally { busy.value = false; if (error.value) { await nextTick(); errorPanel.value?.focus(); errorPanel.value?.scrollIntoView({ block: 'center' }) } } }
async function queryAll() { const [s, c, g] = await Promise.all([api.summary(appliedFilters.value), api.calls({ ...appliedFilters.value, page: page.value }), api.breakdown({ ...appliedFilters.value, group_by: groupBy.value, page: groupPage.value })]); summary.value = s; calls.value = c; breakdown.value = g }
function refresh(resetPage = false) { return perform(async () => { if (resetPage) { page.value = 1; groupPage.value = 1; detail.value = null } appliedFilters.value = params(); await queryAll(); await router.replace({ query: appliedFilters.value }) }) }
function loadCalls() { return perform(async () => { calls.value = await api.calls({ ...appliedFilters.value, page: page.value }) }) }
function loadGroups() { return perform(async () => { breakdown.value = await api.breakdown({ ...appliedFilters.value, group_by: groupBy.value, page: groupPage.value }) }) }
function reset() { Object.assign(filters, defaults()); groupBy.value = 'customer'; refresh(true) }
function drill(row) { if (busy.value) return; Object.assign(filters, defaults(), appliedFilters.value); if (groupBy.value === 'customer') { filters.organization_id = ['personal', 'unknown'].includes(row.key) ? '0' : row.key; filters.customer_kind = ['personal', 'unknown'].includes(row.key) ? row.key : ''; reportForm.organization_id = filters.organization_id === '0' ? '' : filters.organization_id; groupBy.value = 'project' } else { const fields = { project: 'drama_id', user: 'user_id', model: 'model', operation: 'source_kind' }; filters[fields[groupBy.value]] = row.key === 'unknown' ? '0' : row.key; if (groupBy.value === 'project') groupBy.value = 'user' } refresh(true) }
function openCall(id) { return perform(async () => { detail.value = await api.call(id); await nextTick(); detailPanel.value?.focus(); detailPanel.value?.scrollIntoView({ block: 'start' }) }) }
function revise() { return perform(async () => { await api.reprice(detail.value.id, revisionReason.value); detail.value = await api.call(detail.value.id); revisionReason.value = ''; await queryAll() }, '已保留旧记录并新增成本修订。') }
function saveReport() { return perform(async () => { report.value = await api.saveReport(reportForm); reports.value = await api.reports() }, '月报新版本已保存。') }
function showReport(id) { return perform(async () => { report.value = await api.report(id) }) }
function reportExportUrl(detailRows) { return `/api/v1/admin/costs/reports/${encodeURIComponent(report.value.id)}/export?detail=${detailRows}` }
function createAccount() { return perform(async () => { await api.createAccount(accountForm); accounts.value = await api.accounts(); accountForm.name = '' }, '供应商账号已创建。') }
function bindAccount() { return perform(async () => { await api.bind(binding.account_id, binding.config_id); accounts.value = await api.accounts() }, '账号绑定已保存，仅影响新提交。') }
function fetchPrices() { return perform(async () => { source.value = await api.fetchPrices(binding); sources.value = await api.sources() }) }
function loadSource(id) { if (id) return perform(async () => { source.value = await api.source(id) }) }
function useCandidate(c) { Object.assign(priceForm, { account_id: source.value.account_id, model: c.model, source: `ListModelActivations ${source.value.id}`, rules: JSON.stringify(c.rules, null, 2) }); notice.value = c.requires_mapping ? '来源为复杂规格，请按原始价格填写规则后审核。' : '候选已填入下方草稿，请确认服务、规格和生效时间。' }
function saveDraft() { return perform(async () => { await api.draft({ ...priceForm, rules: JSON.parse(priceForm.rules), effective_from: new Date(priceForm.from + ':00+08:00').toISOString(), effective_to: priceForm.to ? new Date(priceForm.to + ':00+08:00').toISOString() : null }); prices.value = await api.prices() }, '草稿已保存，请在价格版本审核区核对后发布。') }
function publish(id) { return perform(async () => { await api.publish(id); prices.value = await api.prices() }, '价格已发布。旧调用和月报保持原值。') }
function preview() { return perform(async () => { batch.value = await api.preview(backfillForm); backfillConfirmed.value = false; batches.value = await api.backfills() }) }
function execute() { return perform(async () => { batch.value = await api.execute(batch.value.id); batches.value = await api.backfills() }, '补算批次已执行，原积分和任务未修改。') }
function showBatch(id) { return perform(async () => { batch.value = await api.backfill(id); backfillConfirmed.value = false }) }
onMounted(() => perform(async () => { const [a, c, p, r, s, b] = await Promise.all([api.accounts(), adminAPI.customerOrganizations(), api.prices(), api.reports(), api.sources(), api.backfills()]); accounts.value = a; customers.value = c; prices.value = p; reports.value = r; sources.value = s; batches.value = b; await queryAll() }))
</script>

<style scoped>
.cost-workspace { width: 100%; min-width: 0; max-width: 1680px; margin: 0 auto; padding: 28px; color: var(--text-primary); }
.page-heading,.section-heading,.actions,.pagination,.tabs { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.page-heading { margin-bottom: 22px; }.eyebrow { font-size: 12px; color: var(--text-secondary); letter-spacing: .1em; }h1 { font-size: 28px; margin: 6px 0; }h2 { font-size: 19px; margin: 0 0 14px; }h3 { font-size: 15px; }p { line-height: 1.65; margin: 8px 0; }small { display: block; color: var(--text-secondary); margin-top: 6px; line-height: 1.5; }
.tabs { justify-content: flex-start; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 20px; }.tabs [aria-current],.primary { background: var(--el-color-primary, #365cd6); color: white; border-color: transparent; }
button,.button { border: 1px solid var(--border-color); border-radius: 7px; background: var(--bg-raised); color: inherit; padding: 9px 14px; font: inherit; font-size: 13px; cursor: pointer; text-decoration: none; }button:disabled { opacity: .5; cursor: not-allowed; }button:hover:not(:disabled),.button:hover { border-color: var(--el-color-primary); }button.primary { background: var(--el-color-primary); color: #fff; }button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,.table-scroll:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; }
.panel { min-width: 0; padding: 22px; margin-bottom: 20px; border: 1px solid var(--border-color); background: var(--bg-surface); border-radius: 12px; }.filters { display: grid; grid-template-columns: repeat(auto-fit,minmax(175px,1fr)); gap: 16px; align-items: end; }label { display: flex; flex-direction: column; gap: 7px; font-size: 13px; min-width: 0; }input,select,textarea { box-sizing: border-box; width: 100%; min-width: 0; padding: 9px 10px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-raised); color: inherit; font: inherit; }textarea { resize: vertical; font-family: monospace; }.full { grid-column: 1 / -1; }.form-actions,.inline-form { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }.inline-form { margin: 18px 0; }.inline-form label { flex: 1 1 200px; max-width: 480px; }.checkbox { flex-direction: row; align-items: center; margin: 16px 0; }.checkbox input { width: 17px; height: 17px; }.source-select { max-width: 520px; margin-top: 16px; }
.metrics { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 16px; margin: 20px 0; }.metrics article { border-top: 3px solid var(--el-color-primary); background: var(--bg-surface); padding: 20px; border-radius: 9px; }.metrics strong { display: block; font-size: clamp(20px,2vw,30px); margin: 12px 0; overflow-wrap: anywhere; }.metrics span,.muted { color: var(--text-secondary); }.coverage { border-inline-start: 3px solid var(--el-color-primary); }.warning { color: var(--status-warning, #bd7900); }.feedback { border: 1px solid var(--border-color); border-inline-start: 3px solid var(--el-color-primary); padding: 12px 16px; margin-bottom: 16px; overflow-wrap: anywhere; }.error { border-inline-start-color: var(--status-danger, #e45454); color: var(--status-danger, #e45454); }
.table-scroll { overflow-x: auto; width: 100%; margin-top: 14px; }table { border-collapse: collapse; width: 100%; min-width: 740px; text-align: left; font-size: 13px; }th,td { padding: 13px 12px; border-bottom: 1px solid var(--border-color); vertical-align: top; }th { color: var(--text-secondary); font-weight: 500; background: var(--bg-muted); }td { max-width: 310px; overflow-wrap: anywhere; }.usage-cell { min-width: 180px; max-width: 260px; }.pagination { justify-content: flex-end; margin-top: 18px; font-size: 13px; }.section-heading label { min-width: 130px; }.revision { border-top: 1px solid var(--border-color); padding: 16px 0; }pre { white-space: pre-wrap; overflow-wrap: anywhere; max-width: 100%; padding: 12px; background: var(--bg-muted); border-radius: 6px; font-size: 12px; }summary { cursor: pointer; padding: 8px 0; }dl { display: grid; grid-template-columns: 190px minmax(0,1fr); gap: 12px; font-size: 13px; }dt { color: var(--text-secondary); }dd { margin: 0; overflow-wrap: anywhere; }.actions { justify-content: flex-start; }li { margin: 8px 0; }
@media(max-width:800px) { .cost-workspace { padding: 16px; }.metrics { grid-template-columns: repeat(2,minmax(0,1fr)); }.panel { padding: 16px; }.page-heading { align-items: flex-start; }dl { grid-template-columns: 1fr; gap: 6px; }dd { margin-bottom: 10px; }.pagination { justify-content: space-between; } }
@media(max-width:430px) { .metrics { gap: 10px; }.metrics article { padding: 14px; }.metrics strong { font-size: 21px; }.filters { grid-template-columns: 1fr; }.tabs { gap: 8px; }.tabs button { flex: 1 1 40%; } }
</style>
