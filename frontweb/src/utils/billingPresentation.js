const TYPE_META = {
  authorization: { label: '已冻结', tag: 'warning' },
  settlement: { label: '已结算', tag: 'success' },
  void: { label: '已释放', tag: 'info' },
  recharge: { label: '充值到账', tag: 'success' },
  adjustment: { label: '余额调整', tag: 'info' },
  charge: { label: '已扣除', tag: 'success' },
}

const SERVICE_LABELS = {
  text: '文本生成', image: '图片生成', video: '视频生成', tts: '语音合成', asr: '语音识别',
}

const METER_LABELS = {
  input_token: '输入 Token', output_token: '输出 Token', image: '张图片',
  character: '个字符', second: '秒', request: '次调用',
}

function number(value) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Math.abs(Number(value) || 0))
}

function modelName(row) {
  const snapshot = row.snapshot || {}
  const service = SERVICE_LABELS[snapshot.service_type] || snapshot.service_type || row.reference_type || 'AI 服务'
  return snapshot.model ? `${service} · ${snapshot.model}` : service
}

function usageText(usage = {}) {
  const parts = Object.entries(usage)
    .filter(([, value]) => Number(value) > 0)
    .map(([meter, value]) => `${number(value)} ${METER_LABELS[meter] || meter}`)
  return parts.join('，')
}

export function transactionMeta(row) {
  return TYPE_META[row.type] || { label: row.type || '账务变动', tag: 'info' }
}

export function transactionAmount(row) {
  const amount = Number(row.amount) || 0
  if (row.type === 'authorization') return `冻结 ${number(amount)}`
  if (row.type === 'settlement' || row.type === 'charge') return `扣除 ${number(amount)}`
  if (row.type === 'void') {
    const released = row.snapshot?.amount
    return released === undefined ? '已释放' : `释放 ${number(released)}`
  }
  return `${amount >= 0 ? '+' : '-'}${number(amount)}`
}

export function transactionDescription(row) {
  const snapshot = row.snapshot || {}
  const service = modelName(row)
  const actualUsage = usageText(snapshot.actual_usage)

  if (row.type === 'authorization') {
    return `已为 ${service} 暂时冻结 ${number(row.amount)} 积分上限；完成后只按实际用量扣除。`
  }
  if (row.type === 'settlement' || row.type === 'charge') {
    return actualUsage
      ? `${service} 已完成，按实际 ${actualUsage} 结算。`
      : `${service} 已完成并结算。`
  }
  if (row.type === 'void') return row.reason || '调用未完成，冻结积分已全部释放。'
  if (row.type === 'recharge') return row.reason || '充值积分已到账。'
  if (row.type === 'adjustment') return row.reason || '管理员已调整账户余额。'
  return row.reason || '账户积分发生变动。'
}

export function formatCredits(value) {
  return number(value)
}
