export function clampTextOffset(value, offset) {
  const length = String(value ?? '').length
  const numeric = Number(offset)
  if (!Number.isFinite(numeric)) return length
  return Math.max(0, Math.min(length, Math.trunc(numeric)))
}

export function insertTokenAtOffset(value, token, offset) {
  const source = String(value ?? '')
  const normalizedToken = String(token ?? '').trim()
  if (!normalizedToken) return { text: source, caret: clampTextOffset(source, offset) }

  const at = clampTextOffset(source, offset)
  const before = source.slice(0, at)
  const after = source.slice(at)
  const prefix = before && !/\s$/.test(before) ? ' ' : ''
  const suffix = after && !/^\s/.test(after) ? ' ' : ''
  const inserted = `${prefix}${normalizedToken}${suffix}`
  return {
    text: `${before}${inserted}${after}`,
    caret: at + inserted.length,
  }
}
