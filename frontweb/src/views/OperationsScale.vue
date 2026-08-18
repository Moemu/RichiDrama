<template>
  <main class="page">
    <header>
      <div>
        <p class="eyebrow">运营报表</p>
        <h1>运营告警与报表</h1>
        <p class="muted">数据只来自本地任务、归档和账本；不会查询供应商。</p>
      </div>
      <div class="actions">
        <el-button @click="$router.push('/')">返回主页</el-button>
        <el-button @click="$router.push('/admin')">返回运营台</el-button>
        <el-button type="primary" :loading="exporting" @click="downloadProduction">导出生产 CSV</el-button>
      </div>
    </header>

    <el-alert v-for="alert in overview?.alerts || []" :key="`${alert.key}-${alert.model || ''}`" type="warning" :closable="false" show-icon class="alert">
      <template #title>{{ alertLabel(alert) }}</template>
    </el-alert>
    <section v-if="overview && !(overview.alerts || []).length" class="quiet-status" aria-live="polite">
      <span aria-hidden="true">✓</span><div><b>当前没有触发的运营告警</b><small>生产、归档和账务阈值均在安全范围内。</small></div><button type="button" @click="load">刷新检测</button>
    </section>

    <section class="card">
      <h2>告警阈值</h2>
      <el-form :model="settings" label-position="top" class="settings-grid">
        <el-form-item label="长时间未更新（分钟）"><el-input-number v-model="settings.stale_minutes" :min="1" /></el-form-item>
        <el-form-item label="连续失败数量"><el-input-number v-model="settings.failed_count" :min="1" /></el-form-item>
        <el-form-item label="失败统计窗口（小时）"><el-input-number v-model="settings.failed_window_hours" :min="1" /></el-form-item>
        <el-form-item label="待对账数量"><el-input-number v-model="settings.pending_reconciliation_count" :min="1" /></el-form-item>
        <el-form-item label="归档失败数量"><el-input-number v-model="settings.archive_failed_count" :min="1" /></el-form-item>
      </el-form>
      <el-button type="primary" :loading="saving" @click="save">保存阈值</el-button>
    </section>

    <section class="card" :class="{ 'is-sparse': reports.length <= 3 }">
      <h2>运营日报</h2>
      <el-table :data="reports" size="small">
        <el-table-column prop="report_date" label="上海日期" width="140" />
        <el-table-column label="生成时间" min-width="180"><template #default="{ row }">{{ formatChinaDateTime(row.generated_at) }}</template></el-table-column>
        <el-table-column label="视频生产数" width="130"><template #default="{ row }">{{ row.summary?.production?.total || 0 }}</template></el-table-column>
        <el-table-column label="待对账" width="120"><template #default="{ row }">{{ row.summary?.billing?.pending_reconciliations || 0 }}</template></el-table-column>
        <el-table-column label="告警数" width="100"><template #default="{ row }">{{ row.summary?.alerts?.length || 0 }}</template></el-table-column>
      </el-table>
      <div v-if="reports.length > 0 && reports.length <= 3" class="snapshot-insight">
        <div><p>日报归档</p><h3>{{ reports.length }} 份运营日报</h3></div>
        <dl><div><dt>视频生产</dt><dd>{{ reports[0]?.summary?.production?.total || 0 }}</dd></div><div><dt>待对账</dt><dd>{{ reports[0]?.summary?.billing?.pending_reconciliations || 0 }}</dd></div><div><dt>运营告警</dt><dd>{{ reports[0]?.summary?.alerts?.length || 0 }}</dd></div></dl>
      </div>
    </section>
  </main>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { adminAPI } from '@/api/account'
import { formatChinaDateTime } from '@/utils/time'

const overview = ref(null)
const reports = ref([])
const exporting = ref(false)
const saving = ref(false)
const settings = reactive({ stale_minutes: 30, failed_count: 3, failed_window_hours: 24, pending_reconciliation_count: 1, archive_failed_count: 1 })

function alertLabel(alert) {
  const labels = { stale_production: '生产任务长时间未更新', continuous_failures: '模型连续失败', pending_reconciliation: '存在待对账案件', archive_failed: '存在归档失败' }
  return `${labels[alert.key] || alert.key}：${alert.count} 条${alert.model ? `（${alert.model}）` : ''}`
}

async function load() {
  const [nextOverview, nextSettings, nextReports] = await Promise.all([adminAPI.overview(), adminAPI.operationAlertSettings(), adminAPI.operationReports({ page: 1, page_size: 30 })])
  overview.value = nextOverview
  Object.assign(settings, nextSettings)
  reports.value = nextReports.items || []
}

async function save() {
  saving.value = true
  try { Object.assign(settings, await adminAPI.saveOperationAlertSettings(settings)); await load(); ElMessage.success('告警阈值已保存') }
  finally { saving.value = false }
}

async function downloadProduction() {
  exporting.value = true
  try {
    const blob = await adminAPI.productionExport()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `production-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  } finally { exporting.value = false }
}

onMounted(load)
</script>

<style scoped>
.page { display:grid; grid-template-rows:auto auto auto minmax(0,1fr); gap:1rem; width:100%; max-width:min(1360px,calc(100vw - 3rem)); height:100vh; height:100dvh; min-height:0; margin:auto; padding:clamp(1.2rem,2.5vw,2.5rem) 0; overflow:hidden; box-sizing:border-box; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin:0; }
h1, h2 { margin: 0; }
h2 { font-size: 18px; margin-bottom: 16px; }
.eyebrow { color: #818cf8; font-size: 12px; letter-spacing: .15em; margin: 0 0 6px; }
.muted { color: var(--text-muted); }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.alert { margin-bottom: 10px; }
.quiet-status { display:flex; align-items:center; gap:1rem; min-height:4.5rem; padding:.8rem 1rem; border-top:1px solid var(--border-color); border-bottom:1px solid var(--border-color); }.quiet-status>span { display:grid; width:2.2rem; height:2.2rem; place-items:center; border-radius:50%; background:color-mix(in srgb,var(--accent-teal) 18%,var(--bg-raised)); color:var(--accent-teal); font-weight:900; }.quiet-status div { display:grid; gap:.2rem; flex:1; }.quiet-status small { color:var(--text-muted); }.quiet-status button { padding:.55rem 0; border:0; border-bottom:1px solid var(--border-strong); background:transparent; color:var(--text-regular); cursor:pointer; }
.card { min-height:0; margin:0; padding:1rem 1.2rem; overflow:hidden; border: 1px solid var(--border-color, #e5e7eb); border-width:1px 0; border-radius:0; background:transparent; }
.card:last-child { display:flex; flex-direction:column; }.card:last-child :deep(.el-table){flex:1;min-height:0;overflow:auto}.card:last-child :deep(.el-table__inner-wrapper){height:100%}
.card.is-sparse :deep(.el-table){flex:0 0 auto}.card.is-sparse :deep(.el-table__inner-wrapper){height:auto}.snapshot-insight { display:grid; grid-template-columns:1fr 1.15fr; gap:1.2rem; align-items:center; flex:0 0 auto; min-height:0; padding:.75rem 0 0; border-top:1px solid var(--border-color); }.snapshot-insight p { margin:0 0 .35rem; color:var(--accent-teal); font:800 .6rem/1 ui-monospace,monospace; letter-spacing:.12em; }.snapshot-insight h3 { margin:0; font-size:clamp(1.45rem,2.2vw,2.3rem); line-height:1; letter-spacing:-.04em; }.snapshot-insight dl { display:grid; grid-template-columns:repeat(3,1fr); margin:0; border-top:1px solid var(--border-color); border-bottom:1px solid var(--border-color); }.snapshot-insight dl div { min-width:0; padding:.65rem .75rem; border-right:1px solid var(--border-color); }.snapshot-insight dl div:last-child { border-right:0; }.snapshot-insight dt { color:var(--text-faint); font-size:.62rem; }.snapshot-insight dd { margin:.25rem 0 0; font-size:1.45rem; font-weight:800; }
.settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0 14px; }
@media (max-width: 640px) { header { flex-direction: column; } .page { max-width:100%; padding:1rem; overflow-y:auto; }.quiet-status{align-items:flex-start}.settings-grid{grid-template-columns:1fr 1fr} }
</style>
