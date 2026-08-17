<template>
  <main class="page">
    <header>
      <div><p class="eyebrow">ACCOUNT</p><h1>账户中心</h1></div>
      <div class="header-actions">
        <AccountBalanceBadge />
        <el-button @click="$router.push('/')">返回创作台</el-button>
        <el-button v-if="isAdmin" type="primary" @click="$router.push('/admin')">后台管理</el-button>
      </div>
    </header>

    <section class="cards">
      <article><span>可用积分</span><strong>{{ account.available ?? 0 }}</strong><small>可立即用于新的生成任务</small></article>
      <article><span>冻结积分</span><strong>{{ account.frozen ?? 0 }}</strong><small>任务完成后会结算或自动释放</small></article>
      <article><span>累计消费</span><strong>{{ account.total_consumed ?? 0 }}</strong><small>仅统计已经完成的实际扣费</small></article>
    </section>

    <section class="panel billing-guide">
      <div><h2>账单怎么看</h2><p>每次生成先冻结一个最高额度，防止并发任务超额；成功后按真实用量结算，未完成或失败则释放冻结。冻结不是已扣费。</p></div>
      <div class="guide-steps"><span>1. 冻结上限</span><i>→</i><span>2. 生成任务</span><i>→</i><span>3. 实际结算 / 释放</span></div>
    </section>

    <section class="panel"><h2>平台可用模型</h2><el-tag v-for="m in models" :key="`${m.service_type}-${m.model}`" class="tag">{{ m.service_type }} · {{ m.model }}</el-tag><p v-if="!models.length" class="muted">管理员尚未配置可计费模型。</p></section>

    <section class="panel"><h2>修改密码</h2><el-form inline><el-form-item label="当前密码"><el-input v-model="password.old_password" type="password" show-password /></el-form-item><el-form-item label="新密码"><el-input v-model="password.new_password" type="password" show-password /></el-form-item><el-button type="primary" @click="changePassword">更新密码</el-button></el-form></section>
    <section class="panel"><h2>修改用户名</h2><el-form inline><el-form-item label="用户名"><el-input v-model="username" maxlength="64" /></el-form-item><el-button type="primary" @click="changeUsername">保存用户名</el-button></el-form><p class="muted">仅支持 3–64 位字母、数字和 . _ -；保存后会刷新当前登录会话。</p></section>

    <section class="panel bills"><div class="panel-title"><div><h2>账单记录</h2><p>“冻结”只占用可用额度；只有“已结算”才会计入累计消费。</p></div></div><div class="billing-table-scroll"><BillingTransactionTable :rows="transactions" :total="transactionPage.total" :page="transactionPage.page" :page-size="transactionPage.page_size" @page-change="loadTransactions" /></div></section>
  </main>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { accountAPI } from '@/api/account'
import BillingTransactionTable from '@/components/BillingTransactionTable.vue'
import AccountBalanceBadge from '@/components/AccountBalanceBadge.vue'

const account = ref({})
const transactions = ref([])
const transactionPage = reactive({ page: 1, page_size: 20, total: 0 })
const models = ref([])
const isAdmin = JSON.parse(localStorage.getItem('lmd_auth_user') || '{}').role === 'admin'
const password = reactive({ old_password: '', new_password: '' })
const username = ref(JSON.parse(localStorage.getItem('lmd_auth_user') || '{}').username || '')

async function changePassword() {
  await accountAPI.changePassword(password)
  password.old_password = ''
  password.new_password = ''
  ElMessage.success('密码已更新')
}

async function changeUsername() {
  const session = await accountAPI.changeUsername({ username: username.value })
  localStorage.setItem('lmd_auth_token', session.token)
  localStorage.setItem('lmd_auth_user', JSON.stringify(session.user))
  username.value = session.user.username
  ElMessage.success('用户名已更新')
}

async function loadTransactions(page = transactionPage.page) {
  const result = await accountAPI.transactions({ page, page_size: transactionPage.page_size })
  transactions.value = result.items || []
  Object.assign(transactionPage, { page: result.page || page, page_size: result.page_size || transactionPage.page_size, total: result.total || 0 })
}

onMounted(async () => {
  const [, loadedAccount, loadedModels] = await Promise.all([loadTransactions(), accountAPI.me(), accountAPI.models()])
  account.value = loadedAccount
  models.value = loadedModels
})
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
</style>
