<template>
  <main class="page">
    <header class="account-header">
      <div><p class="eyebrow">账户与用量</p><h1>我的账户</h1><p class="account-intro">管理创作额度、账单和登录资料。</p></div>
      <div class="header-actions">
        <AccountBalanceBadge />
        <el-button @click="returnToSource">返回创作台</el-button>
        <el-button v-if="isAdmin" type="primary" @click="$router.push('/admin')">后台管理</el-button>
      </div>
    </header>
    <nav class="account-tabs" aria-label="账户工作区"><button v-for="tab in [{v:'overview',label:'概览'},{v:'recharge',label:'充值'},{v:'billing',label:'账单记录'},{v:'models',label:'可用模型'},{v:'security',label:'账户安全'}]" :key="tab.v" type="button" :class="{ active: accountTab === tab.v }" @click="accountTab = tab.v">{{ tab.label }}</button></nav>

    <div v-show="accountTab === 'overview'" class="account-view overview-view">
      <section class="cards">
        <article><span>{{ account.account_scope === 'organization' ? '企业共享额度' : '可用积分' }}</span><strong>{{ account.available ?? 0 }}</strong><small>{{ account.account_name || '可立即用于新的生成任务' }}</small></article>
        <article><span>冻结积分</span><strong>{{ account.frozen ?? 0 }}</strong><small>生成时先冻结额度上限。完成后按实际用量结算，失败则自动释放。</small></article>
        <article><span>累计消费</span><strong>{{ account.total_consumed ?? 0 }}</strong><small>{{ account.account_scope === 'organization' ? '统计该客户账户的全部实际扣费' : '仅统计已经完成的实际扣费' }}</small></article>
      </section>
      <section class="overview-links" aria-label="账户快捷入口">
        <button type="button" @click="accountTab = 'models'"><span>可用模型</span><b>{{ models.length }} 个</b><small>查看已启用的模型</small></button>
        <button type="button" @click="accountTab = 'billing'"><span>账单记录</span><b>{{ transactionPage.total }} 条</b><small>查看冻结和结算明细</small></button>
        <button type="button" @click="accountTab = 'security'"><span>账户安全</span><b>登录资料</b><small>修改密码和用户名</small></button>
      </section>
    </div>
    <div v-show="accountTab === 'recharge'" class="account-view recharge-view">
      <section v-if="paymentOptions.blocked_reason" class="panel recharge-blocked"><h2>企业共享额度</h2><p>{{ paymentOptions.blocked_reason }}</p><small>请联系企业管理员调整共享额度。</small></section>
      <template v-else>
        <section class="recharge-checkout">
          <div class="recharge-heading"><div><p class="eyebrow">个人账户充值</p><h2>选择充值金额</h2></div><strong>{{ rechargeCredits }}<small> 积分</small></strong></div>
          <el-alert v-if="!paymentOptions.enabled" title="充值功能暂未开放" description="支付配置完成后，可以在此使用支付宝或微信扫码充值。" type="info" :closable="false" show-icon />
          <div class="amount-presets" role="radiogroup" aria-label="充值金额">
            <button v-for="amount in paymentOptions.preset_amounts_yuan || []" :key="amount" type="button" role="radio" :aria-checked="rechargeAmountChoice === amount" :class="{active: rechargeAmountChoice === amount}" @click="selectRechargeAmount(amount)">¥{{ Number(amount) }}</button>
            <button type="button" role="radio" :aria-checked="rechargeAmountChoice === 'custom'" :class="{active: rechargeAmountChoice === 'custom'}" @click="selectRechargeAmount('custom')">自定义</button>
          </div>
          <label v-if="rechargeAmountChoice === 'custom'" class="custom-amount"><span>输入自定义金额</span><el-input ref="customAmountInput" v-model="customRechargeAmount" inputmode="decimal" :placeholder="rechargeAmountRange"><template #prepend>¥</template></el-input><small>允许 {{ rechargeAmountRange }} 元。1 元兑换 100 积分，金额最多保留两位小数。</small></label>
          <div class="payment-channels"><button v-for="channel in paymentOptions.channels || []" :key="channel.id" type="button" :disabled="!channel.enabled" :class="{active: rechargeChannel === channel.id}" @click="rechargeChannel = channel.id"><b>{{ channel.id === 'alipay' ? '支付宝' : '微信支付' }}</b><small>{{ channel.enabled ? '扫码支付' : '暂未开放' }}</small></button></div>
          <div class="recharge-submit"><span>{{ paymentSubmitHint }}</span><el-button type="primary" size="large" :disabled="!canCreatePayment" :loading="creatingPayment" @click="createPayment">提交充值订单</el-button></div>
        </section>
        <section class="panel payment-history"><div class="panel-title"><div><h2>充值订单</h2><p>支付成功后，积分会自动到账。</p></div><el-button text @click="loadPaymentOrders">刷新</el-button></div>
          <div class="billing-table-scroll"><el-table :data="paymentOrders" empty-text="暂无充值订单"><el-table-column label="时间" min-width="170"><template #default="{row}">{{ formatDate(row.created_at) }}</template></el-table-column><el-table-column label="渠道" width="100"><template #default="{row}">{{ row.channel === 'alipay' ? '支付宝' : '微信' }}</template></el-table-column><el-table-column prop="amount_yuan" label="金额（元）" width="110"/><el-table-column prop="credits" label="积分" width="110"/><el-table-column label="状态" width="120"><template #default="{row}"><el-tag :type="paymentStatus(row.status).type">{{ paymentStatus(row.status).label }}</el-tag></template></el-table-column><el-table-column label="操作" width="110" fixed="right"><template #default="{row}"><el-button v-if="row.status === 'pending'" link type="primary" @click="openPayment(row)">继续支付</el-button></template></el-table-column></el-table></div>
        </section>
      </template>
    </div>
    <div v-show="accountTab === 'models'" class="account-view"><section class="panel"><h2>平台可用模型</h2><el-tag v-for="m in models" :key="`${m.service_type}-${m.model}`" class="tag">{{ m.service_type }} · {{ m.model }}</el-tag><p v-if="!models.length" class="muted">管理员尚未配置可计费模型。</p></section></div>
    <el-dialog v-model="paymentDialog" width="min(92vw, 440px)" :close-on-click-modal="false" :title="paymentDialogTitle" @closed="stopPaymentTracking">
      <div v-if="activePayment" class="payment-dialog">
        <template v-if="activePayment.status === 'pending'"><p>{{ activePayment.channel === 'alipay' ? '请使用支付宝扫码' : '请使用微信扫码' }}</p><img v-if="paymentQr" :src="paymentQr" alt="支付二维码"/><strong>¥{{ activePayment.amount_yuan }}</strong><span>预计到账 {{ activePayment.credits }} 积分</span><small>二维码剩余 {{ countdownText }}</small></template>
        <el-result v-else-if="activePayment.status === 'paid'" icon="success" title="充值成功" :sub-title="`¥${activePayment.amount_yuan} 已支付，${activePayment.credits} 积分已经到账`"/>
        <el-alert v-else :title="paymentStatus(activePayment.status).label" type="warning" :closable="false"/>
      </div>
      <template #footer><el-button v-if="activePayment?.status === 'pending'" @click="closePayment">关闭订单</el-button><el-button type="primary" @click="paymentDialog = false">完成</el-button></template>
    </el-dialog>
    <div v-show="accountTab === 'security'" class="account-view security-view">
      <section class="panel security-card security-card--password">
        <div class="security-card-heading"><small>登录凭据</small><h2>修改密码</h2><p>更新后，请使用新密码完成下一次登录。</p></div>
        <el-form label-position="top" class="security-form">
          <div class="security-form-fields security-form-fields--password">
            <el-form-item label="当前密码"><el-input v-model="password.old_password" type="password" show-password autocomplete="current-password" /></el-form-item>
            <el-form-item label="新密码"><el-input v-model="password.new_password" type="password" show-password autocomplete="new-password" /></el-form-item>
          </div>
          <el-button type="primary" @click="changePassword">更新密码</el-button>
        </el-form>
      </section>
      <section class="panel security-card">
        <div class="security-card-heading"><small>登录标识</small><h2>修改用户名</h2><p>支持 1–64 个字符。保存后会刷新当前登录会话。</p></div>
        <el-form label-position="top" class="security-form">
          <el-form-item label="用户名"><el-input v-model="username" maxlength="64" /></el-form-item>
          <el-button type="primary" @click="changeUsername">保存用户名</el-button>
        </el-form>
      </section>
      <section class="panel security-card">
        <div class="security-card-heading"><small>展示资料</small><h2>修改显示名</h2><p>显示名最长 64 个字符。留空时显示用户名。</p></div>
        <el-form label-position="top" class="security-form">
          <el-form-item label="显示名"><el-input v-model="displayName" maxlength="64" placeholder="留空则展示用户名" /></el-form-item>
          <el-button type="primary" @click="changeDisplayName">保存显示名</el-button>
        </el-form>
      </section>
    </div>
    <div v-show="accountTab === 'billing'" class="account-view">
      <section class="panel bills">
        <div class="panel-title billing-heading">
          <div><h2>账单记录</h2><p>消费明细只显示实际结算。资金流水保留冻结、释放和充值记录。</p></div>
          <div class="billing-view-switch" role="tablist" aria-label="账单视图">
            <button type="button" :class="{ active: billingView === 'usage' }" @click="billingView = 'usage'">消费明细</button>
            <button type="button" :class="{ active: billingView === 'transactions' }" @click="billingView = 'transactions'">资金流水</button>
          </div>
        </div>

        <div v-if="billingView === 'usage'">
          <div class="usage-filters">
            <el-date-picker v-model="usageFilters.dates" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" aria-label="按日期筛选消费明细" @change="loadUsage(1)" />
            <el-select v-if="isOrganizationAdmin" v-model="usageFilters.user_id" clearable filterable placeholder="全部消费人" aria-label="按消费人筛选" @change="loadUsage(1)">
              <el-option v-for="member in usageMembers" :key="member.id" :label="memberLabel(member)" :value="member.id" />
            </el-select>
            <el-button v-if="usageFilters.user_id || usageFilters.dates.length" text @click="clearUsageFilters">清除筛选</el-button>
          </div>
          <div class="billing-table-scroll usage-detail-scroll">
            <el-table :data="usageRows" size="small" empty-text="暂无消费记录">
              <el-table-column label="时间" min-width="170"><template #default="{ row }">{{ formatChinaDateTime(row.created_at) }}</template></el-table-column>
              <el-table-column label="消费人" min-width="145"><template #default="{ row }"><div class="consumer-cell"><strong>{{ row.display_name || row.username }}</strong><small v-if="row.display_name">{{ row.username }}</small></div></template></el-table-column>
              <el-table-column label="项目" min-width="180" show-overflow-tooltip><template #default="{ row }">{{ row.project_title_snapshot || '未关联项目（历史/全局）' }}</template></el-table-column>
              <el-table-column label="服务" min-width="110"><template #default="{ row }">{{ serviceLabel(row.service_type) }}</template></el-table-column>
              <el-table-column prop="model" label="模型" min-width="170" show-overflow-tooltip />
              <el-table-column label="状态" width="92"><template #default><el-tag type="success" effect="plain">已结算</el-tag></template></el-table-column>
              <el-table-column label="实际积分" width="110" align="right"><template #default="{ row }"><strong class="charged-value">{{ formatCredits(row.charged) }}</strong></template></el-table-column>
            </el-table>
          </div>
          <el-pagination v-if="usagePage.total > usagePage.page_size" class="log-pagination" background layout="prev, pager, next, total" :current-page="usagePage.page" :page-size="usagePage.page_size" :total="usagePage.total" @current-change="loadUsage" />
        </div>

        <div v-else class="billing-table-scroll"><BillingTransactionTable :rows="transactions" :show-user="isOrganizationAdmin" :total="transactionPage.total" :page="transactionPage.page" :page-size="transactionPage.page_size" @page-change="loadTransactions" /></div>
      </section>
    </div>
  </main>
</template>

<script setup>
import { ref, reactive, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import QRCode from 'qrcode'
import { accountAPI } from '@/api/account'
import BillingTransactionTable from '@/components/BillingTransactionTable.vue'
import AccountBalanceBadge from '@/components/AccountBalanceBadge.vue'
import { formatCredits, serviceLabel } from '@/utils/billingPresentation'
import { formatChinaDateTime } from '@/utils/time'
import { safeRedirectPath } from '@/utils/routeRecovery'

const route = useRoute()
const router = useRouter()
const account = ref({})
const transactions = ref([])
const transactionPage = reactive({ page: 1, page_size: 20, total: 0 })
const usageRows = ref([])
const usageMembers = ref([])
const usagePage = reactive({ page: 1, page_size: 20, total: 0 })
const usageFilters = reactive({ dates: [], user_id: null })
const billingView = ref('usage')
const models = ref([])
const isAdmin = JSON.parse(localStorage.getItem('lmd_auth_user') || '{}').console_access === true
const password = reactive({ old_password: '', new_password: '' })
const username = ref(JSON.parse(localStorage.getItem('lmd_auth_user') || '{}').username || '')
const displayName = ref(JSON.parse(localStorage.getItem('lmd_auth_user') || '{}').display_name || '')
const accountTab = ref('overview')
const paymentOptions = ref({ channels: [], preset_amounts_yuan: [] })
const paymentOrders = ref([])
const rechargeAmountChoice = ref('50.00')
const customRechargeAmount = ref('')
const customAmountInput = ref(null)
const rechargeChannel = ref('')
const creatingPayment = ref(false)
const paymentDialog = ref(false)
const activePayment = ref(null)
const paymentQr = ref('')
const paymentTick = ref(Date.now())
let paymentPollTimer = null
let paymentCountdownTimer = null
let paymentSyncCounter = 0
const rechargeAmount = computed(() => rechargeAmountChoice.value === 'custom' ? customRechargeAmount.value : rechargeAmountChoice.value)
const rechargeAmountRange = computed(() => `${paymentOptions.value.min_amount_yuan || '1.00'}–${paymentOptions.value.max_amount_yuan || '5000.00'}`)
const rechargeAmountValid = computed(() => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(rechargeAmount.value)) return false
  const amount = Number(rechargeAmount.value)
  return amount >= Number(paymentOptions.value.min_amount_yuan) && amount <= Number(paymentOptions.value.max_amount_yuan)
})
const rechargeCredits = computed(() => {
  const amount = Number(rechargeAmount.value)
  return Number.isFinite(amount) && amount > 0 ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(amount * 100) : 0
})
const canCreatePayment = computed(() => paymentOptions.value.enabled && paymentOptions.value.personal_recharge_allowed && paymentOptions.value.channels?.some((item) => item.id === rechargeChannel.value && item.enabled) && rechargeAmountValid.value)
const paymentSubmitHint = computed(() => {
  if (!paymentOptions.value.enabled) return '支付配置完成后可以提交订单。'
  if (!paymentOptions.value.channels?.some((item) => item.enabled)) return '当前没有可用支付渠道。'
  if (!rechargeChannel.value) return '请选择支付渠道。'
  if (!rechargeAmountValid.value) return `请输入 ${rechargeAmountRange.value} 元之间的金额。`
  return `将充值 ¥${Number(rechargeAmount.value).toFixed(2)}，预计到账 ${rechargeCredits.value} 积分。`
})
const countdownText = computed(() => {
  const seconds = Math.max(0, Math.ceil((Date.parse(activePayment.value?.expires_at || 0) - paymentTick.value) / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
})
const paymentDialogTitle = computed(() => activePayment.value?.status === 'paid' ? '支付完成' : activePayment.value?.status === 'pending' ? '扫码完成支付' : '订单状态')
const PAYMENT_STATUS = { pending:{label:'等待支付',type:'warning'},paid:{label:'已到账',type:'success'},closed:{label:'已关闭',type:'info'},expired:{label:'已过期',type:'info'},review_required:{label:'需要核查',type:'danger'},failed:{label:'下单失败',type:'danger'} }
function paymentStatus(status) { return PAYMENT_STATUS[status] || { label: status, type: 'info' } }
function formatDate(value) { return value ? new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai', dateStyle:'short', timeStyle:'medium' }).format(new Date(value)) : '—' }
function selectRechargeAmount(value) { rechargeAmountChoice.value = value; if (value === 'custom') nextTick(() => customAmountInput.value?.focus()) }

async function loadAccount() { account.value = await accountAPI.me() }
async function loadPaymentOrders() { const result = await accountAPI.paymentOrders({ page: 1, page_size: 20 }); paymentOrders.value = result.items || [] }
function stopPaymentPolling() { if (paymentPollTimer) window.clearInterval(paymentPollTimer); paymentPollTimer = null; paymentSyncCounter = 0 }
function stopPaymentCountdown() { if (paymentCountdownTimer) window.clearInterval(paymentCountdownTimer); paymentCountdownTimer = null }
function stopPaymentTracking() { stopPaymentPolling(); stopPaymentCountdown() }
async function updateActivePayment(sync = false) {
  if (!activePayment.value?.id) return
  try {
    activePayment.value = sync ? await accountAPI.syncPaymentOrder(activePayment.value.id) : await accountAPI.paymentOrder(activePayment.value.id)
    if (activePayment.value.status === 'paid') {
      paymentQr.value = ''; stopPaymentTracking(); await Promise.all([loadAccount(), loadPaymentOrders(), loadTransactions()]); window.dispatchEvent(new Event('lmd:balance-changed')); ElMessage.success('充值积分已到账')
    } else if (activePayment.value.status !== 'pending') { paymentQr.value = ''; stopPaymentTracking() }
  } catch (_) {}
}
function startPaymentPolling() { stopPaymentPolling(); paymentPollTimer = window.setInterval(() => { paymentSyncCounter += 1; updateActivePayment(paymentSyncCounter % 5 === 0) }, 3000) }
function startPaymentCountdown() { stopPaymentCountdown(); paymentTick.value = Date.now(); paymentCountdownTimer = window.setInterval(() => { paymentTick.value = Date.now() }, 1000) }
async function showPayment(order) { activePayment.value = order; paymentQr.value = order.status === 'pending' && order.code_url ? await QRCode.toDataURL(order.code_url, { width: 280, margin: 1 }) : ''; paymentDialog.value = true; if (order.status === 'pending') { startPaymentCountdown(); startPaymentPolling() } }
async function createPayment() {
  creatingPayment.value = true
  try { const clientId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; const order = await accountAPI.createPaymentOrder({ channel: rechargeChannel.value, amount_yuan: rechargeAmount.value, client_request_id: clientId }); await loadPaymentOrders(); await showPayment(order) }
  catch (error) { ElMessage.error(error.message || '支付订单创建失败') }
  finally { creatingPayment.value = false }
}
async function openPayment(row) { try { await showPayment(await accountAPI.paymentOrder(row.id)) } catch (error) { ElMessage.error(error.message || '订单读取失败') } }
async function closePayment() { try { activePayment.value = await accountAPI.closePaymentOrder(activePayment.value.id); paymentQr.value = ''; stopPaymentTracking(); await loadPaymentOrders() } catch (error) { ElMessage.error(error.message || '订单关闭失败') } }
const isOrganizationAdmin = computed(() => account.value.account_scope === 'organization' && account.value.organization_role === 'organization_admin')

function returnToSource() {
  const rawReturnTo = Array.isArray(route.query.return_to) ? route.query.return_to[0] : route.query.return_to
  const returnTo = safeRedirectPath(rawReturnTo, '/')
  router.push(returnTo.startsWith('/account') ? '/' : returnTo)
}

function memberLabel(member) {
  const identity = member.display_name ? `${member.display_name}（${member.username}）` : member.username
  return member.is_current ? identity : `${identity} · 历史成员`
}

async function changePassword() {
  try { await accountAPI.changePassword(password); password.old_password = ''; password.new_password = ''; ElMessage.success('密码已更新') }
  catch (error) { ElMessage.error(error?.message || '密码更新失败') }
}

async function changeUsername() {
  try { const session = await accountAPI.changeUsername({ username: username.value }); localStorage.setItem('lmd_auth_token', session.token); localStorage.setItem('lmd_auth_user', JSON.stringify(session.user)); username.value = session.user.username; ElMessage.success('用户名已更新') }
  catch (error) { ElMessage.error(error?.message || '用户名更新失败') }
}

async function changeDisplayName() {
  try { const session = await accountAPI.changeDisplayName({ display_name: displayName.value }); localStorage.setItem('lmd_auth_token', session.token); localStorage.setItem('lmd_auth_user', JSON.stringify(session.user)); displayName.value = session.user.display_name || ''; ElMessage.success('显示名已更新'); window.dispatchEvent(new Event('lmd:auth-user-changed')) }
  catch (error) { ElMessage.error(error?.message || '显示名更新失败') }
}

async function loadTransactions(page = transactionPage.page) {
  try {
    const result = await accountAPI.transactions({ page, page_size: transactionPage.page_size })
    transactions.value = result.items || []
    Object.assign(transactionPage, { page: result.page || page, page_size: result.page_size || transactionPage.page_size, total: result.total || 0 })
  } catch (error) { ElMessage.error(error?.message || '账单记录加载失败，请稍后重试') }
}

async function loadUsage(page = usagePage.page) {
  try {
    const [date_from, date_to] = usageFilters.dates || []
    const result = await accountAPI.usage({ page, page_size: usagePage.page_size, ...(date_from ? { date_from } : {}), ...(date_to ? { date_to } : {}), ...(usageFilters.user_id ? { user_id: usageFilters.user_id } : {}) })
    usageRows.value = result.items || []
    Object.assign(usagePage, { page: result.page || page, page_size: result.page_size || usagePage.page_size, total: result.total || 0 })
  } catch (error) { ElMessage.error(error?.message || '消费明细加载失败，请稍后重试') }
}

async function clearUsageFilters() {
  usageFilters.dates = []
  usageFilters.user_id = null
  await loadUsage(1)
}

onMounted(async () => {
  const [accountResult, modelResult, paymentOptionsResult] = await Promise.allSettled([accountAPI.me(), accountAPI.models(), accountAPI.paymentOptions(), loadTransactions(), loadPaymentOrders()])
  if (accountResult.status === 'fulfilled') account.value = accountResult.value
  else ElMessage.error(accountResult.reason?.message || '账户信息加载失败，请刷新重试')
  if (modelResult.status === 'fulfilled') models.value = modelResult.value
  else ElMessage.error(modelResult.reason?.message || '可用模型加载失败，请稍后重试')
  if (paymentOptionsResult.status === 'fulfilled') { paymentOptions.value = paymentOptionsResult.value; const first = paymentOptions.value.channels?.find((item) => item.enabled); rechargeChannel.value = first?.id || ''; if (paymentOptions.value.preset_amounts_yuan?.[1]) rechargeAmountChoice.value = paymentOptions.value.preset_amounts_yuan[1] }
  const detailLoads = [loadUsage()]
  if (isOrganizationAdmin.value) detailLoads.push(accountAPI.usageMembers().then((items) => { usageMembers.value = items || [] }))
  await Promise.allSettled(detailLoads)
})
onBeforeUnmount(stopPaymentTracking)
</script>

<style scoped>
.page { min-height: 100vh; max-width: 1100px; margin: auto; padding: 32px 20px 48px; }
.page header, .header-actions { display: flex; align-items: center; gap: 12px; }
.page header { justify-content: space-between; gap: 20px; }
.eyebrow { color: var(--text-muted); letter-spacing: .15em; font-size: 12px; }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 28px 0; }
.cards article, .panel { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; }
.cards span, .muted, .panel-title p, .billing-guide p, .cards small { color: var(--text-muted); }
.cards strong { display: block; font-size: 28px; margin: 8px 0 4px; font-variant-numeric: tabular-nums; }
.cards small { font-size: 13px; line-height: 1.5; }
.panel { margin: 16px 0; }
.panel h2 { margin-bottom: 10px; }
.tag { margin: 0 8px 8px 0; }
.billing-guide { display: flex; align-items: center; justify-content: space-between; gap: 24px; background: var(--bg-raised); }
.billing-guide p { max-width: 620px; margin: 0; font-size: 14px; }
.guide-steps { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; color: var(--text-regular); font-size: 13px; }
.guide-steps span { padding: 6px 9px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-surface); }
.guide-steps i { color: var(--text-muted); font-style: normal; }
.panel-title p { margin: -4px 0 16px; font-size: 13px; }
@media (max-width: 720px) { .cards { grid-template-columns: 1fr; } .billing-guide { align-items: flex-start; flex-direction: column; } }
@media (max-width: 520px) { .page header { align-items: flex-start; flex-direction: column; } }
.page{width:100%;max-width:1200px;box-sizing:border-box;padding:clamp(1rem,3vw,2.5rem) 0 4rem;background:radial-gradient(48% 34% at 92% 0,color-mix(in srgb,var(--accent) 11%,transparent),transparent 72%)}.cards{gap:16px}.cards article,.panel{border-color:var(--border-subtle);border-radius:var(--radius-lg);background:color-mix(in srgb,var(--bg-surface) 92%,transparent);box-shadow:var(--shadow-sm)}.cards article:first-child{border-color:color-mix(in srgb,var(--accent) 42%,var(--border-color));background:linear-gradient(145deg,color-mix(in srgb,var(--accent) 14%,var(--bg-surface)),var(--bg-surface))}.billing-guide{background:color-mix(in srgb,var(--bg-raised) 80%,transparent)}@media(max-width:520px){.page{padding-inline:1rem}.header-actions :deep(.account-balance){display:none}.header-actions{width:100%;flex-wrap:wrap}.header-actions .el-button{flex:1}.guide-steps{width:100%}}
@media(max-width:520px){.guide-steps span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.guide-steps i{display:none}}
.bills{min-width:0}.billing-table-scroll{width:100%;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}.billing-table-scroll :deep(.el-table){min-width:42rem}
.billing-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:1.5rem}.billing-view-switch{display:flex;flex:0 0 auto;padding:.25rem;border:1px solid var(--border-subtle);border-radius:999px;background:var(--bg-surface)}.billing-view-switch button{padding:.48rem .85rem;border:0;border-radius:999px;background:transparent;color:var(--text-muted);cursor:pointer}.billing-view-switch button.active{background:var(--text-primary);color:var(--bg-page)}.usage-filters{display:flex;align-items:center;flex-wrap:wrap;gap:.75rem;margin:0 0 1rem}.usage-filters :deep(.el-date-editor){width:23rem}.usage-filters :deep(.el-select){width:15rem}.usage-detail-scroll :deep(.el-table){min-width:68rem}.consumer-cell{display:grid;gap:.15rem}.consumer-cell strong{font-weight:650}.consumer-cell small{color:var(--text-muted)}.charged-value{color:var(--el-color-danger);font-variant-numeric:tabular-nums}.log-pagination{justify-content:flex-end;margin-top:1rem}
.page { display:grid; grid-template-rows:auto auto minmax(0,1fr); gap:1.1rem; width:100%; max-width:min(1320px,calc(100vw - 3rem)); height:100vh; height:100dvh; min-height:0; padding:clamp(1.2rem,3vw,2.6rem) 0; overflow:hidden; }
.account-tabs { display:flex; gap:.35rem; padding:.35rem; justify-self:start; border:1px solid var(--border-subtle); border-radius:999px; background:var(--bg-surface); }.account-tabs button { padding:.65rem 1rem; border:0; border-radius:999px; background:transparent; color:var(--text-muted); cursor:pointer; }.account-tabs button:hover,.account-tabs button.active { background:var(--text-primary); color:var(--bg-page); }
.account-view { min-height:0; overflow:auto; overscroll-behavior:contain; scrollbar-width:thin; }.account-view .panel { margin-top:0; }.overview-view { display:grid; grid-template-rows:auto minmax(0,1fr); gap:1rem; }.overview-view .cards { margin:0; }.overview-view .billing-guide { margin:0; }.security-view { display:grid; grid-template-columns:1fr 1fr; gap:1rem; align-content:start; }.security-view .panel { margin:0; }
@media(max-width:45rem){.page{max-width:100%;padding:1rem}.account-tabs{width:100%;overflow-x:auto}.account-tabs button{flex:1 0 auto}.security-view{grid-template-columns:1fr}.overview-view{display:block}.overview-view .cards{grid-template-columns:1fr}.overview-view .billing-guide{margin-top:1rem}}
/* Account cover: one balance ledger and one explanatory rail, not a metric-card dashboard. */
.overview-view{grid-template-columns:minmax(0,1.35fr) minmax(20rem,.65fr);grid-template-rows:minmax(0,1fr)}
.overview-view .cards{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(15rem,.85fr);grid-template-rows:1fr 1fr;gap:0;min-height:0;overflow:hidden;border:1px solid var(--border-subtle);border-radius:1.35rem;background:var(--bg-surface)}
.overview-view .cards article{display:flex;flex-direction:column;justify-content:center;min-height:0;margin:0;padding:clamp(1.4rem,3.5vw,3.4rem);border:0;border-radius:0;background:transparent;box-shadow:none}
.overview-view .cards article:first-child{grid-row:1/-1;border:0;border-right:1px solid var(--border-subtle);background:radial-gradient(circle at 22% 18%,color-mix(in srgb,var(--accent) 25%,transparent),transparent 48%),linear-gradient(145deg,color-mix(in srgb,var(--accent) 12%,var(--bg-surface)),var(--bg-surface))}
.overview-view .cards article:nth-child(2){border-bottom:1px solid var(--border-subtle)}
.overview-view .cards article:first-child strong{font-size:clamp(2.8rem,6vw,6.2rem);letter-spacing:-.065em;line-height:.95}
.overview-view .cards article:not(:first-child) strong{font-size:clamp(2rem,3.4vw,3.5rem);letter-spacing:-.05em}
.overview-view .billing-guide{display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;min-height:0;padding:clamp(1.5rem,3vw,2.8rem);border:0;border-left:1px solid var(--border-subtle);border-radius:0;background:transparent;box-shadow:none}
.overview-view .billing-guide h2{font-size:clamp(1.8rem,3vw,3.2rem);letter-spacing:-.05em}
.overview-view .billing-guide p{font-size:clamp(.9rem,1.2vw,1.05rem);line-height:1.8}
.overview-view .guide-steps{display:grid;width:100%;gap:.45rem}.overview-view .guide-steps i{display:none}.overview-view .guide-steps span{padding:.8rem 0;border:0;border-top:1px solid var(--border-subtle);border-radius:0;background:transparent}
@media(max-width:60rem){.overview-view{grid-template-columns:1fr}.overview-view .billing-guide{display:none}}
@media(max-width:45rem){.overview-view .cards{grid-template-columns:1fr;grid-template-rows:auto}.overview-view .cards article:first-child{grid-row:auto;border-right:0;border-bottom:1px solid var(--border-subtle)}.overview-view .cards article{padding:1.1rem 1.25rem}.overview-view .cards article:first-child strong{font-size:2.5rem}}
@media(min-width:45.01rem){.overview-view{grid-template-columns:1fr;grid-template-rows:minmax(13rem,17rem) auto;align-content:start}.overview-view .cards{grid-template-columns:1.2fr .9fr .9fr;grid-template-rows:1fr;min-height:12rem}.overview-view .cards article{padding:clamp(1.25rem,2.3vw,2.25rem)}.overview-view .cards article:first-child{grid-row:auto;border-right:1px solid var(--border-subtle);background:radial-gradient(circle at 22% 18%,color-mix(in srgb,var(--accent) 20%,transparent),transparent 52%),linear-gradient(145deg,color-mix(in srgb,var(--accent) 10%,var(--bg-surface)),var(--bg-surface))}.overview-view .cards article:nth-child(2){border-right:1px solid var(--border-subtle);border-bottom:0}.overview-view .cards article:first-child strong{font-size:clamp(2.3rem,4vw,4.6rem)}.overview-view .cards article:not(:first-child) strong{font-size:clamp(1.8rem,2.7vw,2.8rem)}.overview-view .billing-guide{display:grid;grid-template-columns:minmax(18rem,1.15fr) minmax(22rem,.85fr);align-items:center;gap:2rem;min-height:auto;padding:1.25rem 0;border-top:1px solid var(--border-subtle);border-left:0}.overview-view .billing-guide h2{font-size:1.35rem}.overview-view .billing-guide p{font-size:.88rem;line-height:1.65}.overview-view .guide-steps{grid-template-columns:repeat(3,1fr);gap:0}.overview-view .guide-steps span{padding:.65rem .8rem;border-top:0;border-left:1px solid var(--border-subtle)}.overview-view .guide-steps span:first-child{border-left:0}}
.overview-links{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}.overview-links button{display:grid;gap:.3rem;min-width:0;padding:1.1rem 1.25rem;border:1px solid var(--border-subtle);border-radius:var(--radius-md);background:var(--bg-surface);color:var(--text-primary);text-align:left;cursor:pointer}.overview-links button:hover,.overview-links button:focus-visible{border-color:var(--accent);background:var(--bg-hover)}.overview-links span,.overview-links small{color:var(--text-muted);font-size:.78rem}.overview-links b{overflow:hidden;font-size:1.05rem;text-overflow:ellipsis;white-space:nowrap}@media(max-width:45rem){.overview-links{grid-template-columns:1fr}.overview-links button{padding:1rem}}

/* Account workspace: calm ledger hierarchy rather than a dashboard of cards. */
.page{max-width:min(1240px,calc(100vw - 4rem));padding-block:clamp(1.8rem,4vw,4rem);gap:1.45rem;background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 5%,transparent),transparent 13rem)}
.account-header{position:relative;min-height:5.5rem;padding-bottom:1.25rem;border-bottom:1px solid var(--border-subtle)}
.account-header h1{font-size:clamp(2rem,3.3vw,3.5rem);letter-spacing:-.055em}.account-header .eyebrow{margin:0 0 .5rem;color:var(--accent-teal);font-size:.68rem;font-weight:750;letter-spacing:.13em}.account-intro{margin:.45rem 0 0;color:var(--text-muted);font-size:.9rem}.header-actions{align-self:flex-start}
.account-tabs{padding:0;border:0;border-radius:0;background:transparent;box-shadow:none}.account-tabs button{position:relative;padding:.58rem .2rem;margin-right:1.35rem;border-radius:0;color:var(--text-muted);font-size:.86rem}.account-tabs button::after{content:'';position:absolute;right:0;bottom:-.1rem;left:0;height:2px;background:var(--accent);opacity:0;transform:scaleX(.55);transition:transform var(--motion-fast) var(--motion-ease),opacity var(--motion-fast) var(--motion-ease)}.account-tabs button:hover,.account-tabs button.active{background:transparent;color:var(--text-primary)}.account-tabs button.active::after{opacity:1;transform:none}
.overview-view{grid-template-rows:minmax(13rem,18rem) auto;gap:1.35rem}.overview-view .cards{border-color:var(--border-subtle);border-radius:0;background:transparent}.overview-view .cards article{position:relative;background:transparent}.overview-view .cards article:first-child{background:linear-gradient(115deg,color-mix(in srgb,var(--accent) 13%,transparent),transparent 66%)}.overview-view .cards article:first-child::after{content:'可用于新的创作任务';position:absolute;right:clamp(1.25rem,3vw,2.25rem);bottom:1.25rem;color:var(--text-faint);font-size:.72rem}.overview-view .cards strong{font-variant-numeric:tabular-nums}.overview-view .billing-guide{background:transparent}.overview-view .billing-guide h2{font-size:1.4rem}.overview-view .guide-steps span{color:var(--text-muted);font-size:.78rem}.overview-links{gap:0;border-top:1px solid var(--border-subtle);border-bottom:1px solid var(--border-subtle)}.overview-links button{padding:1.15rem 0;border:0;border-right:1px solid var(--border-subtle);border-radius:0;background:transparent}.overview-links button:not(:first-child){padding-left:1.15rem}.overview-links button:last-child{border-right:0}.overview-links button:hover,.overview-links button:focus-visible{background:transparent;border-color:var(--border-subtle)}.overview-links button:hover b,.overview-links button:focus-visible b{color:var(--accent)}
.account-view .panel{border-radius:0;border-inline:0;background:transparent;box-shadow:none}.security-view{gap:2.5rem}.security-view .panel{padding:0}.bills{padding-inline:0}.billing-table-scroll{padding-bottom:.5rem}
.security-view{grid-template-columns:repeat(2,minmax(0,1fr));gap:1.5rem;align-items:start}.security-card{display:grid;min-width:0;gap:1.25rem;padding:1.4rem!important;border:1px solid var(--border-subtle)!important;background:color-mix(in srgb,var(--bg-surface) 72%,transparent)!important}.security-card--password{grid-column:1/-1;grid-template-columns:minmax(13rem,.72fr) minmax(0,1.28fr);align-items:end}.security-card-heading{min-width:0}.security-card-heading small{color:var(--accent-teal);font-size:.7rem;font-weight:750;letter-spacing:.1em}.security-card-heading h2{margin:.45rem 0 .4rem}.security-card-heading p{max-width:31rem;margin:0;color:var(--text-muted);font-size:.82rem;line-height:1.6}.security-form{min-width:0}.security-form :deep(.el-form-item){min-width:0;margin-bottom:1rem}.security-form :deep(.el-form-item__content),.security-form :deep(.el-input){min-width:0;width:100%}.security-form-fields--password{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.security-form>.el-button{min-width:7rem}
@media (prefers-reduced-motion:no-preference){.account-header,.account-tabs,.account-view{animation:account-enter var(--motion-normal,220ms) var(--motion-ease) both}.account-tabs{animation-delay:40ms}.account-view{animation-delay:80ms}.overview-links button{transition:color var(--motion-fast) var(--motion-ease),transform var(--motion-fast) var(--motion-ease)}.overview-links button:hover,.overview-links button:focus-visible{transform:translateY(-2px)}}@keyframes account-enter{from{opacity:0;transform:translateY(.5rem)}to{opacity:1;transform:none}}
@media(max-width:45rem){.page{max-width:100%;padding:1.25rem}.account-header{align-items:flex-start}.account-intro{font-size:.84rem}.overview-links{grid-template-columns:1fr}.overview-links button,.overview-links button:not(:first-child){padding:1rem 0;border-right:0;border-bottom:1px solid var(--border-subtle)}.overview-links button:last-child{border-bottom:0}}
.recharge-view{display:grid;grid-template-columns:minmax(0,1fr);gap:2.25rem;align-content:start}.recharge-checkout{display:grid;gap:1.25rem;padding:clamp(1.4rem,3vw,2.4rem);border:1px solid var(--border-subtle);background:linear-gradient(145deg,color-mix(in srgb,var(--accent) 9%,var(--bg-surface)),var(--bg-surface))}.recharge-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:1rem}.recharge-heading h2{margin:0;font-size:clamp(1.5rem,2.5vw,2.2rem)}.recharge-heading strong{font-size:1.7rem;font-variant-numeric:tabular-nums;color:var(--accent)}.recharge-heading strong small{font-size:.75rem;color:var(--text-muted)}.amount-presets{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:.55rem}.amount-presets button,.payment-channels button{border:1px solid var(--border-subtle);background:var(--bg-surface);color:var(--text-primary);cursor:pointer}.amount-presets button{min-height:3.2rem;border-radius:var(--radius-sm);font-size:1rem}.amount-presets button.active,.payment-channels button.active{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);background:color-mix(in srgb,var(--accent) 9%,var(--bg-surface))}.custom-amount{display:grid;grid-template-columns:minmax(9rem,.35fr) minmax(16rem,.65fr);align-items:center;gap:.55rem 1rem;padding:.9rem 1rem;border-left:2px solid var(--accent);background:color-mix(in srgb,var(--accent) 5%,transparent)}.custom-amount>span{font-size:.84rem;font-weight:650}.custom-amount small{grid-column:2;color:var(--text-muted);font-size:.75rem}.payment-channels{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}.payment-channels button{display:grid;gap:.2rem;min-height:4rem;padding:.75rem;border-radius:var(--radius-sm);text-align:left}.payment-channels button:disabled{opacity:.5;cursor:not-allowed}.payment-channels small{color:var(--text-muted)}.recharge-submit{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding-top:.25rem}.recharge-submit>span{color:var(--text-muted);font-size:.8rem}.recharge-submit .el-button{min-width:10rem}.payment-history{min-width:0;margin:0;padding:1.5rem clamp(1rem,2vw,1.5rem) 1.25rem;border:1px solid var(--border-subtle)}.payment-history .panel-title{display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:1rem}.recharge-blocked{max-width:42rem;margin:0}.recharge-blocked p,.recharge-blocked small{color:var(--text-muted)}.payment-dialog{display:grid;justify-items:center;gap:.65rem;text-align:center}.payment-dialog>p{margin:0;color:var(--text-muted)}.payment-dialog>img{width:min(17.5rem,75vw);height:auto;padding:.5rem;background:#fff;border-radius:.5rem}.payment-dialog>strong{font-size:1.8rem}.payment-dialog>span,.payment-dialog>small{color:var(--text-muted)}
@media(max-width:45rem){.amount-presets{grid-template-columns:repeat(2,1fr)}.amount-presets button:last-child{grid-column:1/-1}.custom-amount{grid-template-columns:1fr}.custom-amount small{grid-column:1}.payment-channels{grid-template-columns:1fr}.recharge-submit{align-items:stretch;flex-direction:column}.recharge-submit .el-button{width:100%}.recharge-checkout{padding:1.15rem}.recharge-heading{align-items:flex-start;flex-direction:column}.recharge-view{gap:1.5rem}}
@media(max-height:48rem) and (min-width:45.01rem){.recharge-checkout{gap:.7rem;padding:1rem 1.4rem}.recharge-heading h2{font-size:1.55rem}.amount-presets button{min-height:2.75rem}.payment-channels button{min-height:3.35rem;padding:.55rem .7rem}.recharge-submit{min-height:2.5rem}}
@media(max-height:48rem) and (min-width:45.01rem){.payment-dialog{gap:.45rem}.payment-dialog>img{width:min(14.5rem,65vh)}}
@media(max-width:45rem){.billing-heading{display:grid}.billing-view-switch{justify-self:start}.usage-filters{align-items:stretch;flex-direction:column}.usage-filters :deep(.el-date-editor),.usage-filters :deep(.el-select){width:100%}}
@media(max-width:60rem){.security-card--password{grid-template-columns:1fr}.security-form-fields--password{grid-template-columns:1fr 1fr}}
@media(max-width:45rem){.security-view{grid-template-columns:1fr}.security-card--password{grid-column:auto}.security-form-fields--password{grid-template-columns:1fr}.security-card{padding:1.1rem!important}}
</style>
