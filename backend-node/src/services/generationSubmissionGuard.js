const ACTIVE_VIDEO_STATUSES = Object.freeze([
  'sd2_waiting',
  'processing',
  'upscale_pending',
  'upscaling',
  'interpolation_pending',
  'interpolating',
  'persisting',
]);

const ACTIVE_IMAGE_STATUSES = Object.freeze(['pending', 'processing', 'persisting']);

function placeholders(values) {
  return values.map(() => '?').join(', ');
}

function findActiveVideoForTarget(db, { ownerUserId, storyboardId, sequenceId, shotId } = {}) {
  const owner = Number(ownerUserId);
  const storyboard = Number(storyboardId);
  if (Number.isSafeInteger(storyboard) && storyboard > 0) {
    return db.prepare(`SELECT id, status FROM video_generations
      WHERE owner_user_id = ? AND storyboard_id = ? AND deleted_at IS NULL
        AND status IN (${placeholders(ACTIVE_VIDEO_STATUSES)})
      ORDER BY id DESC LIMIT 1`).get(owner, storyboard, ...ACTIVE_VIDEO_STATUSES) || null;
  }

  const sequence = Number(sequenceId);
  const shot = Number(shotId);
  if (!Number.isSafeInteger(sequence) || sequence <= 0 || !Number.isSafeInteger(shot) || shot <= 0) return null;
  return db.prepare(`SELECT v.id, v.status FROM omni_video_jobs j
    JOIN video_generations v ON v.id = j.video_generation_id
    WHERE j.owner_user_id = ? AND j.sequence_id = ? AND j.shot_id = ? AND v.deleted_at IS NULL
      AND v.status IN (${placeholders(ACTIVE_VIDEO_STATUSES)})
    ORDER BY v.id DESC LIMIT 1`).get(owner, sequence, shot, ...ACTIVE_VIDEO_STATUSES) || null;
}

function findActiveImageForStoryboard(db, { ownerUserId, storyboardId } = {}) {
  const owner = Number(ownerUserId);
  const storyboard = Number(storyboardId);
  if (!Number.isSafeInteger(storyboard) || storyboard <= 0) return null;
  return db.prepare(`SELECT id, status FROM image_generations
    WHERE owner_user_id = ? AND storyboard_id = ? AND deleted_at IS NULL
      AND status IN (${placeholders(ACTIVE_IMAGE_STATUSES)})
    ORDER BY id DESC LIMIT 1`).get(owner, storyboard, ...ACTIVE_IMAGE_STATUSES) || null;
}

module.exports = {
  ACTIVE_VIDEO_STATUSES,
  ACTIVE_IMAGE_STATUSES,
  findActiveVideoForTarget,
  findActiveImageForStoryboard,
};
