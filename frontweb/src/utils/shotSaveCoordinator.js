export function createShotSaveQueue() {
  const pending = new Map()

  return function enqueueShotSave(shotId, operation) {
    const key = String(shotId)
    const previous = pending.get(key) || Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    pending.set(key, current)
    current.finally(() => {
      if (pending.get(key) === current) pending.delete(key)
    }).catch(() => undefined)
    return current
  }
}

export function findShotById(shots, shotId) {
  return shots.find((shot) => Number(shot?.id) === Number(shotId)) || null
}

export function mergeSavedShot(shots, shotId, savedShot, { preserveMedia = false } = {}) {
  const target = findShotById(shots, shotId)
  if (!target) return null

  const stableId = target.id
  const videoUrl = target.video_url
  const posterPath = target.poster_local_path
  Object.assign(target, savedShot)
  target.id = stableId
  if (preserveMedia) {
    target.video_url = videoUrl || savedShot?.video_url || ''
    target.poster_local_path = posterPath || savedShot?.poster_local_path || null
  }
  return target
}
