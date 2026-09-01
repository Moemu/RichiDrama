<template>
  <main class="page">
    <header class="account-header">
      <div><p class="eyebrow">账户与用量</p><h1>我的账户</h1><p class="account-intro">管理创作额度、账单和登录资料。</p></div>
      <div class="header-actions">
        <AccountBalanceBadge />
        <el-button @click="$router.push('/')">返回创作台</el-button>
        <el-button v-if="isAdmin" type="primary" @click="$router.push('/admin')">后台管理</el-button>
      </div>
    </header>
    <nav class="account-tabs" aria-label="账户工作区"><button v-for="tab in [{v:'overview',label:'概览'},{v:'recharge',label:'充值'},{v:'billing',label:'账单记录'},{v:'models',label:'可用模型'},{v:'security',label:'账户安全'}]" :key="tab.v" type="button" :class="{ active: accountTab === tab.v }" @click="accountTab = tab.v">{{ tab.label }}</button></nav>

    <div v-show="accountTab === 'overview'" class="account-view overview-view">
      <section class="cards">
        <article><span>{{ account.account_scope === 'organization' ? '企业共享额度' : '可用积分' }}</span><strong>{{ account.available ?? 0 }}</strong><small>{{ account.account_name || '可立即用于新的生成任务' }}</small></article>
        <article><span>冻结积分</span><strong>{{ account.frozen ?? 0 }}</strong><small>任务完成后会结算或自动释放</small></article>
        <article><span>累计消费</span><strong>{{ account.total_consumed ?? 0 }}</strong><small>{{ account.account_scope === 'organization' ? '统计该客户账户的全部实际扣费' : '仅统计已经完成的实际扣费' }}</small></article>
      </section>
      <section class="panel billing-guide"><div><h2>账单怎么看</h2><p>每次生成先冻结一个最高额度，防止并发任务超额；成功后按真实用量结算，未完成或失败则释放冻结。冻结不是已扣费。</p></div><div class="guide-steps"><span>1. 冻结上限</span><i>→</i><span>2. 生成任务</span><i>→</i><span>3. 实际结算 / 释放</span></div></section>
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
          <div class="amount-presets" aria-label="充值金额"><button v-for="amount in paymentOptions.preset_amounts_yuan || []" :key="amount" type="button" :class="{active: rechargeAmount === amount}" @click="rechargeAmount = amount">¥{{ Number(amount) }}</button></div>
          <label class="custom-amount"><span>自定义金额</span><el-input v-model="rechargeAmount" inputmode="decimal" placeholder="1.00–5000.00"><template #prepend>¥</template></el-input><small>1 元兑换 100 积分。金额最多保留两位小数。</small></label>
          <div class="payment-channels"><button v-for="channel in paymentOptions.channels || []" :key="channel.id" type="button" :disabled="!channel.enabled" :class="{active: rechargeChannel === channel.id}" @click="rechargeChannel = channel.id"><b>{{ channel.id === 'alipay' ? '支付宝' : '微信支付' }}</b><small>{{ channel.enabled ? '扫码支付' : '暂未开放' }}</small></button></div>
          <el-button type="primary" size="large" :disabled="!canCreatePayment" :loading="creatingPayment" @click="createPayment">生成支付二维码</el-button>
        </section>
        <section class="panel payment-history"><div class="panel-title"><div><h2>充值订单</h2><p>支付成功后，积分会自动到账。</p></div><el-button text @click="loadPaymentOrders">刷新</el-button></div>
          <div class="billing-table-scroll"><el-table :data="paymentOrders" empty-text="暂无充值订单"><el-table-column label="时间" min-width="170"><template #default="{row}">{{ formatDate(row.created_at) }}</template></el-table-column><el-table-column label="渠道" width="100"><template #default="{row}">{{ row.channel === 'alipay' ? '支付宝' : '微信' }}</template></el-table-column><el-table-column prop="amount_yuan" label="金额（元）" width="110"/><el-table-column prop="credits" label="积分" width="110"/><el-table-column label="状态" width="120"><template #default="{row}"><el-tag :type="paymentStatus(row.status).type">{{ paymentStatus(row.status).label }}</el-tag></template></el-table-column><el-table-column label="操作" width="110" fixed="right"><template #default="{row}"><el-button v-if="row.status === 'pending'" link type="primary" @click="openPayment(row)">继续支付</el-button></template></el-table-column></el-table></div>
        </section>
      </template>
    </div>
    <div v-show="accountTab === 'models'" class="account-view"><section class="panel"><h2>平台可用模型</h2><el-tag v-for="m in models" :key="`${m.service_type}-${m.model}`" class="tag">{{ m.service_type }} · {{ m.model }}</el-tag><p v-if="!models.length" class="muted">管理员尚未配置可计费模型。</p></section></div>
    <div v-show="accountTab === 'security'" class="account-view security-view"><section class="panel"><h2>修改密码</h2><el-form inline><el-form-item label="当前密码"><el-input v-model="password.old_password" type="password" show-password /></el-form-item><el-form-item label="新密码"><el-input v-model="password.new_password" type="password" show-password /></el-form-item><el-button type="primary" @click="changePassword">更新密码</el-button></el-form></section><section class="panel"><h2>修改用户名</h2><el-form inline><el-form-item label="用户名"><el-input v-model="username" maxlength="64" /></el-form-item><el-button type="primary" @click="changeUsername">保存用户名</el-button></el-form><p class="muted">1–64 个字符，不限内容；保存后会刷新当前登录会话。</p></section><section class="panel"><h2>修改显示名</h2><el-form inline><el-form-item label="显示名"><el-input v-model="displayName" maxlength="64" placeholder="留空则展示用户名" /></el-form-item><el-button type="primary" @click="changeDisplayName">保存显示名</el-button></el-form><p class="muted">展示在界面上的昵称，最长 64 个字符；保存后会刷新当前登录会话。</p></section></div>
    <div v-show="accountTab === 'billing'" class="account-view"><section class="panel bills"><div class="panel-title"><div><h2>账单记录</h2><p>“冻结”只占用可用额度；只有“已结算”才会计入累计消费。</p></div></div><div class="billing-table-scroll"><BillingTransactionTable :rows="transactions" :total="transactionPage.total" :page="transactionPage.page" :page-size="transactionPage.page_size" @page-change="loadTransactions" /></div></section></div>
    <el-dialog v-model="paymentDialog" width="min(92vw, 440px)" :close-on-click-modal="false" title="扫码完成支付" @closed="stopPaymentPolling">
      <div v-if="activePayment" class="payment-dialog"><p>{{ activePayment.channel === 'alipay' ? '请使用支付宝扫码' : '请使用微信扫码' }}</p><img v-if="paymentQr" :src="paymentQr" alt="支付二维码"/><strong>¥{{ activePayment.amount_yuan }}</strong><span>预计到账 {{ activePayment.credits }} 积分</span><small v-if="activePayment.status === 'pending'">二维码剩余 {{ countdownText }}</small><el-result v-else-if="activePayment.status === 'paid'" icon="success" title="充值成功" sub-title="积分已经到账"/><el-alert v-else :title="paymentStatus(activePayment.status).label" type="warning" :closable="false"/></div>
      <template #footer><el-button v-if="activePayment?.status === 'pending'" @click="closePayment">关闭订单</el-button><el-button type="primary" @click="paymentDialog = false">完成</el-button></template>
    </el-dialog>
  </main>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import QRCode from 'qrcode'
import { accountAPI } from '@/api/account'
import BillingTransactionTable from '@/components/BillingTransactionTable.vue'
import AccountBalanceBadge from '@/components/AccountBalanceBadge.vue'

const account = ref({})
const transactions = ref([])
const transactionPage = reactive({ page: 1, page_size: 20, total: 0 })
const models = ref([])
const isAdmin = JSON.parse(localStorage.getItem('lmd_auth_user') || '{}').console_access === true
const password = reactive({ old_password: '', new_password: '' })
const username = ref(JSON.parse(localStorage.getItem('lmd_auth_user') || '{}').username || '')
const displayName = ref(JSON.parse(localStorage.getItem('lmd_auth_user') || '{}').display_name || '')
const accountTab = ref('overview')
const paymentOptions = ref({ channels: [], preset_amounts_yuan: [] })
const paymentOrders = ref([])
const rechargeAmount = ref('50.00')
const rechargeChannel = ref('alipay')
const creatingPayment = ref(false)
const paymentDialog = ref(false)
const activePayment = ref(null)
const paymentQr = ref('')
const paymentTick = ref(Date.now())
let paymentPollTimer = null
let paymentSyncCounter = 0
const rechargeCredits = computed(() => {
  const amount = Number(rechargeAmount.value)
  return Number.isFinite(amount) && amount > 0 ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(amount * 100) : 0
})
const canCreatePayment = computed(() => paymentOptions.value.enabled && paymentOptions.value.personal_recharge_allowed && paymentOptions.value.channels?.some((item) => item.id === rechargeChannel.value && item.enabled) && /^\d+(?:\.\d{1,2})?$/.test(rechargeAmount.value))
const countdownText = computed(() => {
  const seconds = Math.max(0, Math.ceil((Date.parse(activePayment.value?.expires_at || 0) - paymentTick.value) / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
})
const PAYMENT_STATUS = { pending:{label:'等待支付',type:'warning'},paid:{label:'已到账',type:'success'},closed:{label:'已关闭',type:'info'},expired:{label:'已过期',type:'info'},review_required:{label:'需要核查',type:'danger'},failed:{label:'下单失败',type:'danger'} }
function paymentStatus(status) { return PAYMENT_STATUS[status] || { label: status, type: 'info' } }
function formatDate(value) { return value ? new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai', dateStyle:'short', timeStyle:'medium' }).format(new Date(value)) : '—' }

async function loadAccount() { account.value = await accountAPI.me() }
async function loadPaymentOrders() { const result = await accountAPI.paymentOrders({ page: 1, page_size: 20 }); paymentOrders.value = result.items || [] }
function stopPaymentPolling() { if (paymentPollTimer) window.clearInterval(paymentPollTimer); paymentPollTimer = null; paymentSyncCounter = 0 }
async function updateActivePayment(sync = false) {
  if (!activePayment.value?.id) return
  try {
    activePayment.value = sync ? await accountAPI.syncPaymentOrder(activePayment.value.id) : await accountAPI.paymentOrder(activePayment.value.id)
    paymentTick.value = Date.now()
    if (activePayment.value.status === 'paid') {
      stopPaymentPolling(); await Promise.all([loadAccount(), loadPaymentOrders(), loadTransactions()]); window.dispatchEvent(new Event('lmd:balance-changed')); ElMessage.success('充值积分已到账')
    } else if (activePayment.value.status !== 'pending') stopPaymentPolling()
  } catch (_) {}
}
function startPaymentPolling() { stopPaymentPolling(); paymentPollTimer = window.setInterval(() => { paymentTick.value = Date.now(); paymentSyncCounter += 1; updateActivePayment(paymentSyncCounter % 5 === 0) }, 3000) }
async function showPayment(order) { activePayment.value = order; paymentQr.value = order.code_url ? await QRCode.toDataURL(order.code_url, { width: 280, margin: 1 }) : ''; paymentDialog.value = true; startPaymentPolling() }
async function createPayment() {
  creatingPayment.value = true
  try { const clientId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; const order = await accountAPI.createPaymentOrder({ channel: rechargeChannel.value, amount_yuan: rechargeAmount.value, client_request_id: clientId }); await loadPaymentOrders(); await showPayment(order) }
  catch (error) { ElMessage.error(error.message || '支付订单创建失败') }
  finally { creatingPayment.value = false }
}
async function openPayment(row) { try { await showPayment(await accountAPI.paymentOrder(row.id)) } catch (error) { ElMessage.error(error.message || '订单读取失败') } }
async function closePayment() { try { activePayment.value = await accountAPI.closePaymentOrder(activePayment.value.id); stopPaymentPolling(); await loadPaymentOrders() } catch (error) { ElMessage.error(error.message || '订单关闭失败') } }

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

onMounted(async () => {
  const [accountResult, modelResult, paymentOptionsResult] = await Promise.allSettled([accountAPI.me(), accountAPI.models(), accountAPI.paymentOptions(), loadTransactions(), loadPaymentOrders()])
  if (accountResult.status === 'fulfilled') account.value = accountResult.value
  else ElMessage.error(accountResult.reason?.message || '账户信息加载失败，请刷新重试')
  if (modelResult.status === 'fulfilled') models.value = modelResult.value
  else ElMessage.error(modelResult.reason?.message || '可用模型加载失败，请稍后重试')
  if (paymentOptionsResult.status === 'fulfilled') { paymentOptions.value = paymentOptionsResult.value; const first = paymentOptions.value.channels?.find((item) => item.enabled); if (first) rechargeChannel.value = first.id; if (paymentOptions.value.preset_amounts_yuan?.[1]) rechargeAmount.value = paymentOptions.value.preset_amounts_yuan[1] }
})
onBeforeUnmount(stopPaymentPolling)
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
@media (prefers-reduced-motion:no-preference){.account-header,.account-tabs,.account-view{animation:account-enter var(--motion-normal,220ms) var(--motion-ease) both}.account-tabs{animation-delay:40ms}.account-view{animation-delay:80ms}.overview-links button{transition:color var(--motion-fast) var(--motion-ease),transform var(--motion-fast) var(--motion-ease)}.overview-links button:hover,.overview-links button:focus-visible{transform:translateY(-2px)}}@keyframes account-enter{from{opacity:0;transform:translateY(.5rem)}to{opacity:1;transform:none}}
@media(max-width:45rem){.page{max-width:100%;padding:1.25rem}.account-header{align-items:flex-start}.account-intro{font-size:.84rem}.overview-links{grid-template-columns:1fr}.overview-links button,.overview-links button:not(:first-child){padding:1rem 0;border-right:0;border-bottom:1px solid var(--border-subtle)}.overview-links button:last-child{border-bottom:0}}
.recharge-view{display:grid;grid-template-columns:minmax(21rem,.8fr) minmax(30rem,1.2fr);gap:2rem;align-items:start}.recharge-checkout{display:grid;gap:1.25rem;padding:clamp(1.4rem,3vw,2.4rem);border:1px solid var(--border-subtle);background:linear-gradient(145deg,color-mix(in srgb,var(--accent) 9%,var(--bg-surface)),var(--bg-surface))}.recharge-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:1rem}.recharge-heading h2{margin:0;font-size:clamp(1.5rem,2.5vw,2.2rem)}.recharge-heading strong{font-size:1.7rem;font-variant-numeric:tabular-nums;color:var(--accent)}.recharge-heading strong small{font-size:.75rem;color:var(--text-muted)}.amount-presets{display:grid;grid-template-columns:repeat(4,1fr);gap:.55rem}.amount-presets button,.payment-channels button{border:1px solid var(--border-subtle);background:var(--bg-surface);color:var(--text-primary);cursor:pointer}.amount-presets button{min-height:3.2rem;border-radius:var(--radius-sm);font-size:1rem}.amount-presets button.active,.payment-channels button.active{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);background:color-mix(in srgb,var(--accent) 9%,var(--bg-surface))}.custom-amount{display:grid;gap:.45rem}.custom-amount>span{font-size:.84rem;font-weight:650}.custom-amount small{color:var(--text-muted);font-size:.75rem}.payment-channels{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}.payment-channels button{display:grid;gap:.2rem;min-height:4rem;padding:.75rem;border-radius:var(--radius-sm);text-align:left}.payment-channels button:disabled{opacity:.5;cursor:not-allowed}.payment-channels small{color:var(--text-muted)}.payment-history{min-width:0;margin:0;padding:0}.payment-history .panel-title{display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:1rem}.recharge-blocked{max-width:42rem;margin:0}.recharge-blocked p,.recharge-blocked small{color:var(--text-muted)}.payment-dialog{display:grid;justify-items:center;gap:.65rem;text-align:center}.payment-dialog>p{margin:0;color:var(--text-muted)}.payment-dialog>img{width:min(17.5rem,75vw);height:auto;padding:.5rem;background:#fff;border-radius:.5rem}.payment-dialog>strong{font-size:1.8rem}.payment-dialog>span,.payment-dialog>small{color:var(--text-muted)}
@media(max-width:62rem){.recharge-view{grid-template-columns:1fr}.payment-history{padding-top:1rem}}@media(max-width:45rem){.amount-presets{grid-template-columns:repeat(2,1fr)}.payment-channels{grid-template-columns:1fr}.recharge-checkout{padding:1.15rem}.recharge-heading{align-items:flex-start;flex-direction:column}.recharge-view{gap:1rem}}
</style>
