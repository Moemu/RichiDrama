export const VIRAL_STATUS_NAMES = { queued: '排队中', submitting: '提交中', processing: '处理中', finalizing: '归档中', completed: '已完成', failed: '失败', reconciliation: '待对账' }
export const VIRAL_MODE_NAMES = { sequential: '顺剪', jump_cut: '跳剪' }

export function viralStatusName(status) { return VIRAL_STATUS_NAMES[status] || status }
export function viralModeName(mode) { return VIRAL_MODE_NAMES[mode] || mode }

export function viralDurationText(ms) {
  const seconds = Number(ms) / 1000
  if (!Number.isFinite(seconds) || seconds <= 0) return '时长未知'
  const rounded = Math.round(seconds)
  return rounded >= 60 ? `${Math.floor(rounded / 60)} 分 ${rounded % 60 ? `${rounded % 60} 秒` : ''}`.trim() : `${rounded} 秒`
}

// 剧集顺序即算子判定第几集的物理索引，调整必须显式且只作用于选中列表副本。
export function moveViralEpisode(selected, index, direction) {
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= selected.length) return selected
  const next = [...selected]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function viralGradeChips(summary) {
  const counts = summary?.rating_counts || {}
  return ['S', 'A', 'B', 'C'].filter((grade) => Number(counts[grade] || 0) > 0).map((grade) => ({ grade, count: Number(counts[grade]) }))
}

export function viralRatingText(summary) {
  const parts = viralGradeChips(summary).map((chip) => `${chip.grade}×${chip.count}`)
  const avg = Number(summary?.avg_highlight_score)
  if (summary?.avg_highlight_score != null && Number.isFinite(avg)) parts.push(`平均 ${Math.round(avg)}`)
  return parts.join(' · ')
}

// 时间线条带：条目落库时已带分镜评级与描述（enrichTimeline），按播放顺序直接展示。
export function viralTimelineSegments(timeline) {
  return (timeline || []).map((ref) => ({
    ref: String(ref.ref),
    start: Number(ref.clip_start_sec) || 0,
    end: Number(ref.clip_end_sec) || 0,
    is_intro_dup: !!ref.is_intro_dup,
    rating: ref.rating || null,
    content_desc: ref.content_desc || '',
  }))
}

export function viralBillingText(job) {
  const billing = job?.billing
  if (!billing) return ''
  const credits = (value) => Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 100) / 100} 积分` : ''
  if (billing.state === 'settled') return billing.charged_credits != null ? `实际扣费 ${credits(billing.charged_credits)} · 按实测输出时长结算` : '已结算'
  if (billing.state === 'reconciling') return `对账中：${credits(billing.reserved_credits)} 冻结中，等待运营核验用量`
  if (billing.state === 'released') return '预授权已释放，未扣费'
  return billing.reserved_credits != null ? `预授权 ${credits(billing.reserved_credits)}，完成后按实际用量结算` : ''
}
