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
  const sourceId = Number(asset?.project_source?.source_asset_id)
  return [...new Set([
    promptAliasForAsset(asset),
    asset?.alias,
    asset?.reference_alias,
    asset?.name,
    Number.isSafeInteger(sourceId) && sourceId > 0 ? `${TYPE_PREFIX[asset.type] || '素材'}${sourceId}` : '',
    ...(asset?.legacy_aliases || []),
  ].map(clean).filter(Boolean))]
}

export function assetsWithReferenceAliases(assets, document) {
  return assets.map(asset => ({
    ...asset,
    legacy_aliases: [...(asset.legacy_aliases || []), ...(document?.refs || [])
      .filter(ref => Number(ref.asset_id) === Number(asset.id))
      .map(ref => ref.alias).filter(Boolean)],
  }))
}

export function resolveAssetReferences(text, assets, document) {
  const available = assetsWithReferenceAliases(assets, document)
  const refs = [], unresolved = [], occurrences = new Map()
  for (const mention of findAssetMentions(text, available)) {
    const { alias } = mention
    const occurrence = occurrences.get(alias) || 0
    occurrences.set(alias, occurrence + 1)
    const matches = available.filter(asset => assetAliasValues(asset).includes(alias))
    const previous = (document?.refs || []).find(ref => ref.alias === alias && Number(ref.occurrence || 0) === occurrence)
    const asset = matches.find(item => Number(item.id) === Number(previous?.asset_id)) || (matches.length === 1 ? matches[0] : null)
    if (asset) refs.push({ asset_id: asset.id, alias, occurrence, start: mention.index, end: mention.end })
    else if (matches.length > 1) unresolved.push({ alias, occurrence, candidate_asset_ids: matches.map(asset => asset.id) })
  }
  return { text: text || '', refs, unresolved }
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
