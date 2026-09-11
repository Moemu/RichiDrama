const snapshots = new Map()
export const projectKind = kind => ({ 'character-library': 'character_libraries', 'scene-library': 'scene_libraries', 'prop-library': 'prop_libraries' }[kind] || kind)
export function projectSnapshot(kind, id) { return snapshots.get(`${projectKind(kind)}:${id}`) }
export function captureProjectEdit(kind, id) {
  const baseline = projectSnapshot(kind, id)
  return baseline?.__projectId ? { projectBaseline: structuredClone(baseline) } : undefined
}
export function rememberProjectEntity(kind, entity, parentProjectId = null, parentRevision = null) {
  if (!entity?.id) return
  const projectId = kind === 'dramas' ? entity.id : entity.drama_id ?? parentProjectId ?? projectSnapshot(kind, entity.id)?.__projectId ?? projectSnapshot('episodes', entity.episode_id)?.drama_id ?? null
  const revision = kind === 'dramas' ? entity.revision : parentRevision ?? projectSnapshot(kind, entity.id)?.__projectRevision ?? projectSnapshot('dramas', projectId)?.revision
  snapshots.set(`${projectKind(kind)}:${entity.id}`, { ...projectSnapshot(kind, entity.id), ...structuredClone(entity), __projectId: projectId, ...(Number.isSafeInteger(revision) ? { __projectRevision: revision } : {}) })
  if (kind === 'storyboards') {
    const episode = projectSnapshot('episodes', entity.episode_id || projectSnapshot(kind, entity.id)?.episode_id)
    if (episode) {
      const previous = episode.storyboards || []
      const row = projectSnapshot(kind, entity.id)
      const children = previous.some(item => item.id === entity.id) ? previous.map(item => item.id === entity.id ? row : item) : [...previous, row]
      const order = children.slice().sort((a, b) => (a.position ?? a.sort_order ?? a.storyboard_number ?? 0) - (b.position ?? b.sort_order ?? b.storyboard_number ?? 0)).map(item => item.id)
      snapshots.set(`episodes:${episode.id}`, { ...episode, storyboards: children, storyboard_order: order })
    }
  }
  for (const childKind of ['episodes', 'storyboards', 'characters', 'scenes', 'props']) {
    for (const child of entity[childKind] || []) rememberProjectEntity(childKind, child, projectId, revision)
  }
}
export function rememberProjectResponse(url, data) {
  const path = String(url || '').split('?')[0]
  const frames = /^\/storyboards\/(\d+)\/frame-prompts$/.exec(path)
  if (frames && Array.isArray(data?.frame_prompts)) {
    rememberProjectEntity('storyboards', { id: Number(frames[1]), frame_prompts: data.frame_prompts.map(({ frame_type, prompt, description, layout }) => ({ frame_type, prompt, description, layout })).sort((a, b) => a.frame_type.localeCompare(b.frame_type)) })
    return
  }
  if (/^\/(episodes|storyboards)\/\d+\/generation-settings(?:\/overrides)?$/.test(path)) {
    if (Array.isArray(data?.generation_state)) {
      for (const [id, text_model, video_model, duration, video_resolution, video_aspect_ratio, video_upscale_resolution, video_target_fps, generation_overrides] of data.generation_state) {
        rememberProjectEntity('storyboards', { id, text_model, video_model, duration, video_resolution, video_aspect_ratio, video_upscale_resolution, video_target_fps, generation_overrides })
      }
      return
    }
    const fields = { text_model: 'text_model', video_model: 'video_model', duration: 'duration', resolution: 'video_resolution', aspect_ratio: 'video_aspect_ratio', upscale_resolution: 'video_upscale_resolution', target_fps: 'video_target_fps' }
    for (const item of data?.storyboards || (data?.effective ? [data] : [])) {
      const known = projectSnapshot('storyboards', item.id)
      if (!known || !item.effective) continue
      const values = { ...Object.fromEntries(Object.entries(fields).filter(([key]) => Object.hasOwn(item.effective, key)).map(([key, field]) => [field, item.effective[key]])), generation_overrides: item.overrides || {} }
      rememberProjectEntity('storyboards', { id: item.id, ...values })
    }
    return
  }
  const direct = /^\/(dramas|episodes|storyboards|characters|scenes|props|assets|character-library|scene-library|prop-library|images|videos|video-generations|video-merges|omni-video-jobs|tasks|tool-runs)(?:\/[^/]+)?\/?$/.exec(path)
  const nested = /^\/(dramas|episodes)\/(\d+)\/(episodes|storyboards|characters|scenes|props)\/?$/.exec(path)
  const kind = data?.permissions && Array.isArray(data.episodes) ? 'dramas' : direct?.[1] || nested?.[3] || (path === '/storyboards/reorder' ? 'storyboards' : null)
  if (!kind) return
  const parentProjectId = nested?.[1] === 'dramas' ? Number(nested[2]) : nested ? projectSnapshot('episodes', Number(nested[2]))?.__projectId : null
  const single = data?.id ? data : data?.[{ characters: 'character', scenes: 'scene', props: 'prop' }[kind]]
  if (single?.id) rememberProjectEntity(kind, single, parentProjectId)
  const items = data?.items || data?.[kind] || (Array.isArray(data) ? data : [])
  for (const item of items) rememberProjectEntity(kind, item, parentProjectId)
  if (kind === 'storyboards' && Array.isArray(data?.storyboards)) {
    const episodeId = nested?.[1] === 'episodes' ? Number(nested[2]) : items[0]?.episode_id
    const episode = projectSnapshot('episodes', episodeId)
    if (episode) snapshots.set(`episodes:${episodeId}`, { ...episode, storyboards: items.map(item => projectSnapshot('storyboards', item.id)), storyboard_order: items.map(item => item.id) })
  }
}

export function rememberProjectAcknowledgement(ack) {
  if (!ack?.drama_id) return
  for (const item of ack.entities || []) {
    const entity = { ...item.entity }
    if (Object.hasOwn(entity, 'omni_asset_usage_json')) { entity.omni_asset_usage = entity.omni_asset_usage_json; delete entity.omni_asset_usage_json }
    rememberProjectEntity(item.kind, entity, ack.drama_id, ack.revision)
  }
}
