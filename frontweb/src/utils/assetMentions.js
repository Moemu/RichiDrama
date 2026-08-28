const TYPE_PREFIX = { image: '图片', video: '视频', audio: '音频' }

function clean(value) {
  return String(value || '').trim()
}

export function promptAliasForAsset(asset) {
  const stable = clean(asset?.reference_alias)
  if (stable) return stable
  const alias = clean(asset?.alias)
  if (alias && !/\s/.test(alias)) return alias
  const id = Number(asset?.id)
  if (Number.isInteger(id) && id > 0) return `${TYPE_PREFIX[asset?.type] || '素材'}${id}`
  return alias || clean(asset?.name)
}

export function assetAliasValues(asset) {
  return [...new Set([
    promptAliasForAsset(asset),
    asset?.alias,
    asset?.reference_alias,
    asset?.name,
    ...(asset?.legacy_aliases || []),
  ].map(clean).filter(Boolean))]
}

/**
 * Find stable aliases and old file-name aliases. Old names can contain spaces.
 * Unknown text keeps the previous whitespace-delimited behavior.
 */
export function findAssetMentions(value, assets = []) {
  const source = String(value || '')
  const knownAliases = [...new Set(
    assets.flatMap(assetAliasValues)
  )].sort((left, right) => right.length - left.length)
  const mentions = []
  let cursor = 0
  while (cursor < source.length) {
    const index = source.indexOf('@', cursor)
    if (index < 0) break
    const rest = source.slice(index + 1)
    const known = knownAliases.find((alias) => rest.startsWith(alias))
    const fallback = rest.match(/^([^\s@]+)/)?.[1] || ''
    const alias = known || fallback
    if (alias) mentions.push({ alias, index, token: `@${alias}`, end: index + alias.length + 1 })
    cursor = index + Math.max(1, alias.length + 1)
  }
  return mentions
}
