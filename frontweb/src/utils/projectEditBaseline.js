const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export function projectFieldValue(entity, field) {
  if (field === 'omni_asset_usage_json') return entity?.omni_asset_usage
  if (field === 'character_ids' && entity?.character_ids === undefined && Array.isArray(entity?.characters)) {
    return entity.characters.map(character => Number(character?.id ?? character))
  }
  return entity?.[field]
}

function findEntity(project, kind, id) {
  if (kind === 'dramas') return Number(project.id) === id ? project : null
  const rows = [...(project[kind] || []), ...(project.episodes || []).flatMap(episode => episode[kind] || [])]
  return rows.find(row => Number(row.id) === id)
}

// Re-read the fields being replaced, then retain the server's revision check
// for any write that races with this read. Unrelated text saves may advance it.
export async function refreshProjectEditBaseline(request, config, baseline, match, projectId, episodeBaseline) {
  const generationSettings = match?.[1] === 'storyboards' && match[3] === '/generation-settings'
  if (!baseline || !match || (match[3] && !generationSettings) || !['put', 'patch'].includes(String(config.method).toLowerCase())) return
  if (!['dramas', 'episodes', 'storyboards', 'characters', 'scenes', 'props'].includes(match[1])) return
  const project = await request.get(`/dramas/${projectId}`, { skipProjectSnapshot: true })
  const current = findEntity(project, match[1], Number(match[2]))
  if (!current || !Number.isSafeInteger(project.revision)) return
  if (generationSettings) {
    const episode = project.episodes?.find(item => Number(item.id) === Number(baseline.episode_id))
    if (!episodeBaseline?.storyboards || !episode?.storyboards) return
    const settings = row => [row.id, row.text_model || 'auto', row.video_model || 'auto', row.duration, row.video_resolution, row.video_aspect_ratio, row.video_upscale_resolution ?? null, row.video_target_fps ?? null]
    if (!equal(episodeBaseline.storyboards.map(settings), episode.storyboards.map(settings))) return
    config.headers['X-Project-Revision'] = project.revision
    return
  }
  for (const [field, value] of Object.entries(config.data || {})) {
    if (field === 'metadata' && value && typeof value === 'object') {
      if (Object.keys(value).some(key => !equal(baseline.metadata?.[key], current.metadata?.[key]))) return
    } else if (field === 'omni_prompt_document' && value && !Object.hasOwn(value, 'text')) {
      const { text: beforeText, ...before } = baseline.omni_prompt_document || {}
      const { text: currentText, ...after } = current.omni_prompt_document || {}
      if (!equal(before, after)) return
    } else if (projectFieldValue(current, field) === undefined || !equal(projectFieldValue(baseline, field), projectFieldValue(current, field))) return
  }
  config.headers['X-Project-Revision'] = project.revision
}
