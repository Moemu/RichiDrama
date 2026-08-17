<template>
  <main class="page">
    <header>
      <div>
        <p class="eyebrow">OPERATIONS SCALE</p>
        <h1>运营告警与报表</h1>
        <p class="muted">数据只来自本地任务、归档和账本；不会查询供应商。</p>
      </div>
      <div class="actions">
        <el-button @click="$router.push('/admin')">返回运营台</el-button>
        <el-button type="primary" :loading="exporting" @click="downloadProduction">导出生产 CSV</el-button>
      </div>
    </header>

    <el-alert v-for="alert in overview?.alerts || []" :key="`${alert.key}-${alert.model || ''}`" type="warning" :closable="false" show-icon class="alert">
      <template #title>{{ alertLabel(alert) }}</template>
    </el-alert>
    <el-empty v-if="overview && !(overview.alerts || []).length" description="当前没有触发的运营告警" />

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

    <section class="card">
      <h2>每日运营快照</h2>
      <el-table :data="reports" size="small">
        <el-table-column prop="report_date" label="上海日期" width="140" />
        <el-table-column label="生成时间" min-width="180"><template #default="{ row }">{{ formatChinaDateTime(row.generated_at) }}</template></el-table-column>
        <el-table-column label="视频生产数" width="130"><template #default="{ row }">{{ row.summary?.production?.total || 0 }}</template></el-table-column>
        <el-table-column label="待对账" width="120"><template #default="{ row }">{{ row.summary?.billing?.pending_reconciliations || 0 }}</template></el-table-column>
        <el-table-column label="告警数" width="100"><template #default="{ row }">{{ row.summary?.alerts?.length || 0 }}</template></el-table-column>
      </el-table>
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
.page { max-width: 1080px; margin: auto; padding: 28px 20px; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 24px; }
h1, h2 { margin: 0; }
h2 { font-size: 18px; margin-bottom: 16px; }
.eyebrow { color: #818cf8; font-size: 12px; letter-spacing: .15em; margin: 0 0 6px; }
.muted { color: var(--text-muted); }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.alert { margin-bottom: 10px; }
.card { margin-top: 20px; padding: 20px; border: 1px solid var(--border-color, #e5e7eb); border-radius: 10px; background: var(--card-bg, #fff); }
.settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0 14px; }
@media (max-width: 640px) { header { flex-direction: column; } .page { padding: 20px 14px; } }
</style>
