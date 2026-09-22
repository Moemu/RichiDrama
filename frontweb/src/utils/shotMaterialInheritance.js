import { resolveAssetReferences } from './assetMentions.js'

export function referencedShotMaterialIds(shot, availableAssets) {
  const sourceIds = new Set((shot.assets || [])
    .filter((item) => !['first_frame', 'last_frame'].includes(item.usage))
    .map((item) => Number(item.asset_id)))
  return new Set(resolveAssetReferences(shot.prompt, availableAssets, shot.prompt_document).refs
    .map((ref) => Number(ref.asset_id))
    .filter((id) => sourceIds.has(id)))
}

export function planShotMaterialInheritance(sourceAssets, availableAssets, currentIds, limits) {
  const available = new Map(availableAssets.map((asset) => [Number(asset.id), asset]))
  const selected = new Set(currentIds.map(Number))
  const counts = { image: 0, video: 0, audio: 0 }
  for (const id of selected) {
    const type = available.get(id)?.type
    if (type in counts) counts[type] += 1
  }

  const added = []
  let unavailable = 0
  let overLimit = 0
  let frames = 0
  for (const source of sourceAssets || []) {
    const id = Number(source.asset_id)
    if (['first_frame', 'last_frame'].includes(source.usage)) { frames += 1; continue }
    if (selected.has(id)) continue
    const asset = available.get(id)
    if (!asset || !(asset.type in counts)) { unavailable += 1; continue }
    if (selected.size >= limits.total || counts[asset.type] >= limits[asset.type]) { overLimit += 1; continue }
    selected.add(id)
    counts[asset.type] += 1
    added.push({ asset, usage: source.usage || 'reference' })
  }
  return { added, unavailable, overLimit, frames }
}
