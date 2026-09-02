const STATUS_LABELS = {
  processing: '处理中',
  persisting: '保存成片',
  completed: '已完成',
  failed: '失败',
  retryable: '可重试',
  invalid: '状态异常',
  cancelled: '已取消',
  reconciliation_required: '待对账',
  awaiting_source: '等待源视频',
  pending: '等待处理',
  skipped: '已跳过',
  not_selected: '未选择',
  local: '本地就绪',
  local_ready: '本地就绪',
  oss_synced: '已归档',
  upscale_pending: '等待超分',
  upscaling: '超分中',
  interpolation_pending: '等待插帧',
  interpolating: '插帧中',
}

const FAILURE_STATUSES = new Set(['failed', 'retryable', 'invalid', 'cancelled', 'reconciliation_required'])
const SUCCESS_STATUSES = new Set(['completed', 'oss_synced', 'local', 'local_ready'])

export function productionStatusLabel(status) {
  const value = String(status || '').trim()
  return STATUS_LABELS[value] || value || '未知'
}

export function productionStatusTone(status) {
  if (FAILURE_STATUSES.has(status)) return 'bad'
  if (SUCCESS_STATUSES.has(status)) return 'good'
  return 'neutral'
}

export function productionTimelineType(status) {
  if (FAILURE_STATUSES.has(status)) return 'danger'
  if (SUCCESS_STATUSES.has(status)) return 'success'
  return 'primary'
}
