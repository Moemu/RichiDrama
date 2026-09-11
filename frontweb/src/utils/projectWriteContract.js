import { projectKind, projectSnapshot } from './projectSnapshots'

function canonical(value) {
  if (value == null) return null
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
export const equalProjectValue = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

export function projectFieldValue(entity, field) {
  if (field === 'omni_asset_usage_json') return entity?.omni_asset_usage
  if (field === 'character_ids') return (entity?.character_ids || entity?.characters || []).map(value => Number(value?.id ?? value))
  return entity?.[field]
}

export function advanceProjectEdit(baseline, changes, saved) {
  if (!baseline) return
  for (const [field, value] of Object.entries(changes)) {
    if (field === 'expected_updated_at' || equalProjectValue(value, projectFieldValue(baseline, field))) continue
    const key = field === 'omni_asset_usage_json' ? 'omni_asset_usage' : field
    baseline[key] = structuredClone(projectFieldValue(saved, field) ?? null)
  }
  baseline.updated_at = saved.updated_at
}

export function mergeGenerationState(previous, contract) {
  const rows = contract.storyboards || (contract.effective ? [contract] : [])
  const updates = new Map(rows.filter(row => row.effective).map(row => [Number(row.id), [Number(row.id), row.effective.text_model || 'auto', row.effective.video_model || 'auto', row.effective.duration, row.effective.resolution, row.effective.aspect_ratio, row.effective.upscale_resolution ?? null, row.effective.target_fps ?? null, row.overrides || {}]]))
  return contract.storyboards ? rows.map(row => updates.get(Number(row.id))) : previous.map(row => updates.get(row[0]) || row)
}

function check(kind, id, fields) {
  return { kind: projectKind(kind), id: Number(id), fields: structuredClone(fields) }
}

function expectedFields(baseline, changes) {
  return Object.fromEntries(Object.entries(changes).map(([field, value]) => {
    if (field === 'metadata' && value && typeof value === 'object') {
      return [field, Object.fromEntries(Object.keys(value).map(key => [key, baseline.metadata?.[key] ?? null]))]
    }
    if (field === 'omni_prompt_document' && value && !Object.hasOwn(value, 'text')) {
      const { text, ...rest } = baseline.omni_prompt_document || {}
      return [field, rest]
    }
    return [field, projectFieldValue(baseline, field) ?? null]
  }))
}

function requireSnapshot(kind, id) {
  const value = projectSnapshot(kind, id)
  if (!value) throw new Error('请先载入要编辑的内容')
  return value
}

function episodeShots(episode) {
  const byId = new Map((episode.storyboards || []).map(row => [Number(row.id), row]))
  const order = episode.storyboard_order || [...byId.keys()]
  return order.map(id => projectSnapshot('storyboards', id) || byId.get(Number(id)))
}

export function buildProjectWriteContract(config, known, match) {
  const method = String(config.method).toLowerCase()
  const body = config.data || {}
  const checks = []
  if (config.url === '/storyboards/reorder' && method === 'put') {
    const episode = requireSnapshot('episodes', body.episode_id)
    checks.push(check('episodes', episode.id, { storyboard_order: episodeShots(episode).map(row => row.id) }))
  } else if (match && /^\/generation-settings(?:\/overrides)?$/.test(match[3])) {
    const episodeId = match[1] === 'episodes' ? Number(match[2]) : known?.episode_id
    const episode = requireSnapshot('episodes', episodeId)
    checks.push(check('episodes', episodeId, { generation_state: config.projectGenerationBaseline || episodeShots(episode).map(row => [row.id, row.text_model || 'auto', row.video_model || 'auto', row.duration, row.video_resolution, row.video_aspect_ratio, row.video_upscale_resolution ?? null, row.video_target_fps ?? null, row.generation_overrides || {}]) }))
  } else if (match?.[1] === 'dramas' && match[3] === '/collaboration/episodes') {
    for (const update of body.updates || []) checks.push(check('episodes', update.id, expectedFields(requireSnapshot('episodes', update.id), update.fields)))
    for (const id of body.remove_ids || []) checks.push(check('episodes', id, { updated_at: requireSnapshot('episodes', id).updated_at }))
  } else if (match?.[1] === 'dramas' && ['/canvas-layout', '/progress'].includes(match[3])) {
    const baseline = known || requireSnapshot('dramas', match[2])
    checks.push(check('dramas', match[2], { metadata: Object.fromEntries(Object.keys(body).map(field => [field, baseline.metadata?.[field] ?? null])) }))
  } else if (match?.[1] === 'dramas' && match[3] === '/outline') {
    const changes = { ...body }
    if (Object.hasOwn(changes, 'summary')) { changes.description = changes.summary; delete changes.summary }
    checks.push(check('dramas', match[2], expectedFields(known || requireSnapshot('dramas', match[2]), changes)))
  } else if (method === 'put' && match?.[1] === 'characters' && ['/image', '/image-from-library'].includes(match[3])) {
    const baseline = known || requireSnapshot('characters', match[2])
    const fields = match[3] === '/image-from-library' ? ['image_url', 'local_path'] : ['image_url', 'local_path', 'extra_images', 'ref_image'].filter(field => Object.hasOwn(body, field))
    checks.push(check('characters', match[2], Object.fromEntries(fields.map(field => [field, baseline[field] ?? null]))))
  } else if (method === 'put' && match?.[1] === 'scenes' && match[3] === '/prompt') {
    checks.push(check('scenes', match[2], { prompt: (known || requireSnapshot('scenes', match[2])).prompt ?? null }))
  } else if (method === 'put' && match?.[1] === 'storyboards' && /^\/frame-prompts\//.test(match[3])) {
    const baseline = known || requireSnapshot('storyboards', match[2])
    if (!Object.hasOwn(baseline, 'frame_prompts')) throw new Error('请先载入分镜帧提示词')
    checks.push(check('storyboards', match[2], { frame_prompts: baseline.frame_prompts }))
  } else if (match && !match[3] && ['put', 'patch', 'delete'].includes(method)) {
    const baseline = known || requireSnapshot(match[1], match[2])
    checks.push(check(match[1], match[2], method === 'delete' ? { updated_at: baseline.updated_at } : expectedFields(baseline, body)))
  } else return null
  return { version: 1, checks }
}
