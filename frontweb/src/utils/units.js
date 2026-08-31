function trimNumber(value) {
  return Number(value.toFixed(3)).toString()
}

export function compactQuantity(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '—'
  const absolute = Math.abs(amount)
  if (absolute >= 1_000_000_000) return `${trimNumber(amount / 1_000_000_000)}B`
  if (absolute >= 1_000_000) return `${trimNumber(amount / 1_000_000)}M`
  if (absolute >= 1024 && Number.isInteger(amount / 1024)) return `${trimNumber(amount / 1024)}K`
  if (absolute >= 1000) return `${trimNumber(amount / 1000)}K`
  return trimNumber(amount)
}
