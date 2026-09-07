import { assetImageUrl } from './mediaUrl'
import { parseDramaMetadata } from './canvasLayout'

export function dramaUsesFirstLastFrame(drama) {
  const meta = parseDramaMetadata(drama?.metadata)
  return !!meta.storyboard_use_first_last_frame
}

function isHttpVideoUrl(url) {
  if (!url || typeof url !== 'string') return false
  const t = url.trim()
  return t.startsWith('http://') || t.startsWith('https://')
}

function isCompletedImage(i) {
  return i?.status === 'completed'
    && i.frame_type !== 'quad_grid'
    && i.frame_type !== 'nine_grid'
    && (i.image_url || i.local_path)
}

export function getSbImagesList(imagesBySbId, storyboardId) {
  const list = imagesBySbId?.[storyboardId]
  return Array.isArray(list) ? list.filter(isCompletedImage) : []
}

export function getSbVideosList(videosBySbId, storyboardId) {
  const list = videosBySbId?.[storyboardId]
  if (!Array.isArray(list)) return []
  return list.filter((v) => v.status === 'completed' && ((v.local_path && String(v.local_path).trim()) || isHttpVideoUrl(v.video_url)))
}

/** 首帧图记录（与 FilmCreate.getSbFirstImage 一致） */
export function resolveSbFirstImageRecord(sb, imagesBySbId) {
  if (!sb) return null
  const images = getSbImagesList(imagesBySbId, sb.id)
  if (sb.first_frame_image_id != null) {
    const bound = images.find((i) => i.id === sb.first_frame_image_id)
    if (bound) return bound
  }
  const typed = images.find((i) => i.frame_type === 'storyboard_first')
  if (typed) return typed
  if (sb.local_path || sb.image_url) {
    return {
      id: sb.first_frame_image_id,
      image_url: sb.image_url,
      local_path: sb.local_path,
      frame_type: 'storyboard_first',
    }
  }
  return null
}

/** 尾帧图记录（与 FilmCreate.getSbLastImage 一致） */
export function resolveSbLastImageRecord(sb, imagesBySbId) {
  if (!sb) return null
  const images = getSbImagesList(imagesBySbId, sb.id)
  if (sb.last_frame_image_id != null) {
    const bound = images.find((i) => i.id === sb.last_frame_image_id)
    if (bound) return bound
  }
  const typed = images.find((i) => i.frame_type === 'storyboard_last')
  if (typed) return typed
  if (sb.last_frame_image_url || sb.last_frame_local_path) {
    return {
      id: sb.last_frame_image_id,
      image_url: sb.last_frame_image_url,
      local_path: sb.last_frame_local_path,
      frame_type: 'storyboard_last',
    }
  }
  return null
}

/** 经典单图模式主图 */
export function resolveSbMainImageRecord(sb, imagesBySbId) {
  if (!sb) return null
  const images = getSbImagesList(imagesBySbId, sb.id)
  if (images.length) return images[0]
  if (sb.local_path || sb.image_url) {
    return { image_url: sb.image_url, local_path: sb.local_path }
  }
  return null
}

export function imageRecordUrl(record) {
  return assetImageUrl(record)
}

function numericAssetId(value) {
  const raw = value && typeof value === 'object' ? (value.asset_id ?? value.id) : value
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

function hasAssetValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

function omniCreationMode(sb) {
  return sb?.omni_creation_mode === 'first_last_frame' ? 'first_last_frame' : 'multi_reference'
}

function omniDefaultUsage(asset) {
  if (asset?.type === 'video') return 'motion'
  if (asset?.type === 'audio') return 'ambience'
  return 'reference'
}

/**
 * Return the persisted Omni selection without replacing missing IDs.
 * First/last mode allows the last frame to be absent.
 */
export function storyboardOmniSelection(sb) {
  const mode = omniCreationMode(sb)
  if (mode === 'first_last_frame') {
    const firstId = numericAssetId(sb?.omni_first_frame_asset_id)
    const lastId = numericAssetId(sb?.omni_last_frame_asset_id)
    const usage = []
    if (firstId != null) usage.push({ asset_id: firstId, usage: 'first_frame' })
    if (lastId != null && lastId !== firstId) usage.push({ asset_id: lastId, usage: 'last_frame' })
    return {
      mode,
      firstId,
      lastId,
      firstConfigured: hasAssetValue(sb?.omni_first_frame_asset_id),
      lastConfigured: hasAssetValue(sb?.omni_last_frame_asset_id),
      invalidFirst: hasAssetValue(sb?.omni_first_frame_asset_id) && firstId == null,
      invalidLast: hasAssetValue(sb?.omni_last_frame_asset_id) && lastId == null,
      entries: usage,
    }
  }

  const usageMap = sb?.omni_asset_usage && typeof sb.omni_asset_usage === 'object'
    ? sb.omni_asset_usage
    : {}
  const entries = []
  const invalidIds = []
  const seen = new Set()
  for (const value of Array.isArray(sb?.omni_asset_ids) ? sb.omni_asset_ids : []) {
    const id = numericAssetId(value)
    if (id == null) {
      invalidIds.push(value)
      continue
    }
    if (seen.has(id)) continue
    seen.add(id)
    entries.push({
      asset_id: id,
      usage: String(usageMap[id] || usageMap[String(id)] || '').trim() || null,
    })
  }
  return {
    mode,
    firstId: null,
    lastId: null,
    firstConfigured: false,
    lastConfigured: false,
    invalidIds,
    entries,
  }
}

/** 按分镜持久化顺序返回全能模式素材 ID。 */
export function storyboardOmniAssetIds(sb) {
  return storyboardOmniSelection(sb).entries.map((entry) => entry.asset_id)
}

function omniAssetUrl(asset) {
  if (!asset) return ''
  return assetImageUrl({
    ...asset,
    image_url: asset.image_url || asset.url,
  })
}

/** Resolve each persisted selection and retain missing entries for validation. */
export function storyboardOmniAssetRecords(sb, universalAssets) {
  const byId = new Map((Array.isArray(universalAssets) ? universalAssets : [])
    .map((asset) => [numericAssetId(asset), asset])
    .filter(([id, asset]) => id != null && asset))
  return storyboardOmniSelection(sb).entries.map((selection) => ({
    ...selection,
    asset: byId.get(selection.asset_id) || null,
  }))
}

/** Build the persisted-material request accepted by /omni-video-jobs. */
export function storyboardOmniRequestAssets(sb, universalAssets) {
  const promptRefs = Array.isArray(sb?.omni_prompt_document?.refs) ? sb.omni_prompt_document.refs : []
  const aliases = new Map(promptRefs
    .map((ref) => [numericAssetId(ref), String(ref?.alias || '').trim()])
    .filter(([id, alias]) => id != null && alias))
  return storyboardOmniAssetRecords(sb, universalAssets).map(({ asset_id, usage, asset }) => ({
    asset_id,
    type: asset?.type || 'image',
    alias: aliases.get(asset_id) || asset?.name || asset?.reference_alias || `素材${asset_id}`,
    usage: usage || omniDefaultUsage(asset),
    role: usage === 'identity' ? 'identity' : 'reference',
  }))
}

/**
 * Resolve persisted Omni asset IDs to durable local/public image URLs.
 * Missing assets stay missing; callers must not silently substitute a classic
 * storyboard image for a universal reference.
 */
export function storyboardOmniReferenceUrls(sb, universalAssets, limit = 10) {
  const urls = []
  const seen = new Set()
  for (const { asset } of storyboardOmniAssetRecords(sb, universalAssets)) {
    if (!asset || asset.type !== 'image') continue
    const url = omniAssetUrl(asset)
    if (!url || seen.has(url)) continue
    seen.add(url)
    urls.push(url)
    if (urls.length >= limit) break
  }
  return urls
}

/** 当前分镜视频（优先匹配 storyboard.video_url） */
export function resolveSbVideoRecord(sb, videosBySbId) {
  if (!sb) return null
  const list = getSbVideosList(videosBySbId, sb.id)
  if (list.length) {
    if (sb.video_url) {
      const matched = list.find((v) => v.video_url === sb.video_url)
      if (matched) return matched
      const lp = sb.video_url.replace(/^\/static\//, '')
      const byPath = list.find((v) => v.local_path && (v.local_path === lp || sb.video_url.includes(v.local_path)))
      if (byPath) return byPath
    }
    return list[0]
  }
  if (sb.video_url || sb.local_path) {
    return { video_url: sb.video_url, local_path: sb.local_path }
  }
  return null
}

export function videoRecordUrl(record) {
  if (!record) return ''
  const localPath = record.local_path && String(record.local_path).trim()
  if (localPath) return '/static/' + localPath.replace(/^\//, '')
  if (record.video_url && isHttpVideoUrl(record.video_url)) return record.video_url
  if (record.video_url) {
    const p = String(record.video_url).trim()
    if (p.startsWith('/static/')) return p
    if (!p.startsWith('http')) return '/static/' + p.replace(/^\//, '')
    return p
  }
  return ''
}

export function sbVideoFirstLastUrls(sb, imagesBySbId, useFirstLast, universalAssets) {
  const universal = sb?.creation_mode === 'universal'
  let first = ''
  let last = undefined
  let referenceImageUrls = []
  if (universal) {
    const records = storyboardOmniAssetRecords(sb, universalAssets)
    const firstRecord = records.find((record) => record.usage === 'first_frame') || records[0]
    const lastRecord = records.find((record) => record.usage === 'last_frame')
    first = omniAssetUrl(firstRecord?.asset)
    last = omniAssetUrl(lastRecord?.asset) || undefined
    referenceImageUrls = storyboardOmniReferenceUrls(sb, universalAssets)
  } else {
    const firstRec = useFirstLast ? resolveSbFirstImageRecord(sb, imagesBySbId) : resolveSbMainImageRecord(sb, imagesBySbId)
    first = imageRecordUrl(firstRec)
    if (first) referenceImageUrls.push(first)
  }
  if (useFirstLast && !universal) {
    const lastRec = resolveSbLastImageRecord(sb, imagesBySbId)
    const lu = imageRecordUrl(lastRec)
    if (lu) {
      last = lu
      if (!referenceImageUrls.includes(lu)) referenceImageUrls.push(lu)
    }
  }
  return {
    first: first || undefined,
    last,
    referenceImageUrls,
    omniAssetIds: universal ? storyboardOmniAssetIds(sb) : [],
    omniCreationMode: universal ? omniCreationMode(sb) : undefined,
  }
}

/** 分镜是否已有可用图片（与列表模式 hasSbImage 逻辑对齐） */
export function hasStoryboardImage(sb, imagesBySbId, drama) {
  if (!sb) return false
  if (dramaUsesFirstLastFrame(drama) && sb.creation_mode !== 'universal') {
    return !!(resolveSbFirstImageRecord(sb, imagesBySbId) || sb.image_url || sb.local_path || sb.composed_image)
  }
  return !!(resolveSbMainImageRecord(sb, imagesBySbId) || sb.image_url || sb.local_path || sb.composed_image)
}

/** 分镜是否已有可用视频 */
export function hasStoryboardVideo(sb, videosBySbId) {
  if (!sb) return false
  const rec = resolveSbVideoRecord(sb, videosBySbId)
  return !!(rec?.video_url || rec?.local_path || sb.video_url)
}
