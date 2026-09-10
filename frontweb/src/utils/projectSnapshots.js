const snapshots = new Map()
export const projectKind = kind => ({ 'character-library': 'character_libraries', 'scene-library': 'scene_libraries', 'prop-library': 'prop_libraries' }[kind] || kind)
export function projectSnapshot(kind, id) { return snapshots.get(`${projectKind(kind)}:${id}`) }
export function rememberProjectEntity(kind, entity, parentProjectId = null) {
  if (!entity?.id) return
  const projectId = kind === 'dramas' ? entity.id : entity.drama_id ?? parentProjectId ?? projectSnapshot(kind, entity.id)?.__projectId ?? projectSnapshot('episodes', entity.episode_id)?.drama_id ?? null
  snapshots.set(`${projectKind(kind)}:${entity.id}`, { ...projectSnapshot(kind, entity.id), ...structuredClone(entity), __projectId: projectId })
  for (const childKind of ['episodes', 'storyboards', 'characters', 'scenes', 'props']) {
    for (const child of entity[childKind] || []) rememberProjectEntity(childKind, child, projectId)
  }
}
export function rememberProjectResponse(url, data) {
  const path = String(url || '').split('?')[0]
  const direct = /^\/(dramas|episodes|storyboards|characters|scenes|props|assets|character-library|scene-library|prop-library)(?:\/\d+)?\/?$/.exec(path)
  const nested = /^\/(dramas|episodes)\/(\d+)\/(episodes|storyboards|characters|scenes|props)\/?$/.exec(path)
  const kind = data?.permissions && Array.isArray(data.episodes) ? 'dramas' : direct?.[1] || nested?.[3]
  if (!kind) return
  const parentProjectId = nested?.[1] === 'dramas' ? Number(nested[2]) : nested ? projectSnapshot('episodes', Number(nested[2]))?.__projectId : null
  if (data?.id) rememberProjectEntity(kind, data, parentProjectId)
  for (const item of data?.items || (Array.isArray(data) ? data : [])) rememberProjectEntity(kind, item, parentProjectId)
}
