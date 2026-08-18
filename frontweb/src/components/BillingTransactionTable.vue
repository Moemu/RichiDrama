<template>
  <el-table :data="rows" size="small" empty-text="暂无账单记录">
    <el-table-column label="时间" min-width="170"><template #default="{ row }">{{ formatChinaDateTime(row.created_at) }}</template></el-table-column>
    <el-table-column v-if="showUser" prop="username" label="用户" min-width="100" />
    <el-table-column v-if="showUser" label="分组" width="110"><template #default="{ row }">{{ row.tenant_name || '—' }}</template></el-table-column>
    <el-table-column label="状态" width="100">
      <template #default="{ row }"><el-tag :type="transactionMeta(row).tag" effect="plain">{{ transactionMeta(row).label }}</el-tag></template>
    </el-table-column>
    <el-table-column label="积分变动" width="110" align="right">
      <template #default="{ row }"><span :class="['amount', `amount--${row.type}`]">{{ transactionAmount(row) }}</span></template>
    </el-table-column>
    <el-table-column label="说明" min-width="330">
      <template #default="{ row }"><span class="description">{{ transactionDescription(row) }}</span></template>
    </el-table-column>
    <el-table-column label="变动后可用" width="125" align="right">
      <template #default="{ row }">{{ formatCredits(row.balance_after) }}</template>
    </el-table-column>
  </el-table>
  <el-pagination
    v-if="total > pageSize"
    class="log-pagination"
    background
    layout="prev, pager, next, total"
    :current-page="page"
    :page-size="pageSize"
    :total="total"
    @current-change="$emit('page-change', $event)"
  />
</template>

<script setup>
import { transactionMeta, transactionAmount, transactionDescription, formatCredits } from '@/utils/billingPresentation'
import { formatChinaDateTime } from '@/utils/time'

defineProps({
  rows: { type: Array, default: () => [] },
  showUser: { type: Boolean, default: false },
  total: { type: Number, default: 0 },
  page: { type: Number, default: 1 },
  pageSize: { type: Number, default: 20 },
})
defineEmits(['page-change'])
</script>

<style scoped>
.amount { font-variant-numeric: tabular-nums; white-space: nowrap; }
.amount--settlement, .amount--charge { color: var(--el-color-danger); }
.amount--recharge { color: var(--el-color-success); }
.amount--authorization { color: var(--el-color-warning); }
.description { color: var(--text-regular); line-height: 1.5; }
.log-pagination { justify-content: flex-end; margin-top: 16px; }
</style>
