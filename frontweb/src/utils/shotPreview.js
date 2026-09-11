export const activeGenerationStatuses = new Set(['sd2_waiting', 'processing', 'upscale_pending', 'upscaling', 'interpolation_pending', 'interpolating', 'persisting'])
export const pendingPreviewStatuses = new Set([...activeGenerationStatuses, 'billing_reconciliation'])

export function localVideoUrl(video) {
  // Failed enhancement can leave a playable local source for explicit preview.
  const localPath = String(video?.local_path || video?.upscale_local_path || video?.source_local_path || '').replace(/^\/+/, '')
  if (!localPath) return video?.video_url || video?.upscale_video_url || video?.source_video_url || ''
  const version = video.updated_at || video.completed_at || video.id || ''
  return `/static/${localPath}${version ? `?v=${encodeURIComponent(version)}` : ''}`
}

export function normalizeJob(data) {
  const generation = data.generation || {}
  const snapshot = data.request_snapshot || {}
  return {
    ...data, ...generation, id: data.id, omni_job_id: data.id,
    original_prompt: snapshot.original_prompt || snapshot.prompt || data.original_prompt || data.prompt || generation.prompt || '',
    provider_prompt: generation.prompt || data.prompt || snapshot.prompt || '',
    status: generation.status || data.status || 'processing',
    error_msg: generation.error_msg || data.error_msg,
    task_progress: generation.task_progress ?? data.task_progress ?? null,
    task_message: generation.task_message || data.task_message || null,
    task_updated_at: generation.task_updated_at || data.task_updated_at || null,
    videoUrl: localVideoUrl(generation) || data.video_url,
    local_path: generation.local_path || data.local_path,
    duration: generation.duration || data.duration,
  }
}

export function resolveShotPreviewJob(history, selectedId, boundId) {
  return history.find(job => String(job.id) === String(selectedId))
    || history.find(job => pendingPreviewStatuses.has(job.status))
    || history.find(job => job.is_current)
    || history.find(job => String(job.id) === String(boundId))
    || history[0] || null
}

export function shotPreviewVideoUrl(job, shot) {
  if (job) return activeGenerationStatuses.has(job.status) ? '' : job.videoUrl || ''
  return activeGenerationStatuses.has(shot?.status) ? '' : shot?.video_url || ''
}
