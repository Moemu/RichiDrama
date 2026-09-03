export function chooseToolMediaFeatured(items, options = {}) {
  const list = Array.isArray(items) ? items : []
  const keyOf = options.keyOf || (() => '')
  const activeStatuses = options.activeStatuses || new Set()
  const current = options.current || null
  const preferred = options.preferred || null
  const selectedKey = keyOf(preferred || current)
  const selectedHistory = list.find((item) => keyOf(item) === selectedKey)
  if (selectedHistory) return selectedHistory
  if (preferred) return preferred

  const currentTabPending = activeStatuses.has(current?.status) && keyOf(current) === options.currentSubmissionKey
    ? current
    : null
  return currentTabPending || list.find((item) => !activeStatuses.has(item.status)) || null
}
