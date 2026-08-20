'use strict';

function parse(raw, fallback) { try { return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; } }
function now() { return new Date().toISOString(); }
const DEFAULT_SHOT_SETTINGS = Object.freeze({ model: '', aspect_ratio: '16:9', duration: 15, resolution: '720p', upscale_resolution: '1080p', target_fps: null, audio_strategy: 'reference_only' });

function normalizedShotSettings(raw) {
  const parsed = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const settings = { ...DEFAULT_SHOT_SETTINGS, ...parsed };
  const resolution = String(settings.resolution || '720p').toLowerCase();
  if (resolution === '1080p' || settings.upscale_resolution === resolution) settings.upscale_resolution = null;
  const policy = require('./videoPostprocessPolicy').normalize(settings);
  return { ...settings, resolution: policy.resolution || '720p', upscale_resolution: policy.upscale_resolution, target_fps: policy.target_fps };
}
// Some unit tests and pre-migration local databases use the original sequence
// table. Production always has this column after migration 34.
function hasOwnerColumn(db) {
  return db.prepare("SELECT 1 FROM pragma_table_info('omni_video_sequences') WHERE name = 'owner_user_id'").get() != null;
}

function ensureDefault(db, ownerUserId) {
  const scoped = hasOwnerColumn(db);
  let sequence = db.prepare(`SELECT * FROM omni_video_sequences WHERE is_default = 1${scoped ? ' AND owner_user_id = ?' : ''} AND deleted_at IS NULL ORDER BY id LIMIT 1`).get(...(scoped ? [ownerUserId] : []));
  if (!sequence) {
    const stamp = now();
    const out = scoped
      ? db.prepare("INSERT INTO omni_video_sequences (name, is_default, owner_user_id, created_at, updated_at) VALUES ('自由创作', 1, ?, ?, ?)").run(ownerUserId, stamp, stamp)
      : db.prepare("INSERT INTO omni_video_sequences (name, is_default, created_at, updated_at) VALUES ('自由创作', 1, ?, ?)").run(stamp, stamp);
    sequence = db.prepare('SELECT * FROM omni_video_sequences WHERE id = ?').get(out.lastInsertRowid);
  }
  let count = db.prepare('SELECT COUNT(*) total FROM omni_video_sequence_shots WHERE sequence_id = ? AND deleted_at IS NULL').get(sequence.id).total;
  if (!count) createShot(db, sequence.id, {});
  return get(db, sequence.id);
}

function shotRow(row) {
  return { ...row, assets: parse(row.assets_json, []), prompt_document: parse(row.prompt_document_json, null), settings: normalizedShotSettings(parse(row.settings_json, {})),
    status: row.generation_status || (row.omni_job_id ? 'processing' : 'draft'),
    video_url: row.generation_local_path ? `/static/${row.generation_local_path}` : row.generation_video_url || null };
}

function listShots(db, sequenceId) {
  return db.prepare(`SELECT s.*, v.status generation_status, v.video_url generation_video_url,
      v.local_path generation_local_path, v.error_msg generation_error
    FROM omni_video_sequence_shots s
    LEFT JOIN omni_video_jobs j ON j.id = s.omni_job_id
    LEFT JOIN video_generations v ON v.id = j.video_generation_id
    WHERE s.sequence_id = ? AND s.deleted_at IS NULL ORDER BY s.sort_order, s.id`).all(Number(sequenceId)).map(shotRow);
}

function get(db, id) {
  const sequence = db.prepare('SELECT * FROM omni_video_sequences WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  return sequence ? { ...sequence, shots: listShots(db, sequence.id) } : null;
}

function list(db, options = {}) {
  const deleted = options.deleted ? 'IS NOT NULL' : 'IS NULL';
  const scoped = hasOwnerColumn(db) && options.owner_user_id;
  return db.prepare(`SELECT q.*, COUNT(s.id) shot_count,
      SUM(CASE WHEN v.status = 'completed' THEN 1 ELSE 0 END) completed_count,
      (SELECT v3.local_path FROM omni_video_sequence_shots s3
         JOIN omni_video_jobs j3 ON j3.id = s3.omni_job_id
         JOIN video_generations v3 ON v3.id = j3.video_generation_id
        WHERE s3.sequence_id = q.id AND s3.deleted_at IS NULL
          AND v3.status = 'completed' AND v3.local_path IS NOT NULL
        ORDER BY v3.created_at DESC LIMIT 1) AS latest_video_path
    FROM omni_video_sequences q
    LEFT JOIN omni_video_sequence_shots s ON s.sequence_id = q.id AND s.deleted_at IS NULL
    LEFT JOIN omni_video_jobs j ON j.id = s.omni_job_id
    LEFT JOIN video_generations v ON v.id = j.video_generation_id
    WHERE q.deleted_at ${deleted}${scoped ? ' AND q.owner_user_id = ?' : ''}
    GROUP BY q.id
    ORDER BY q.updated_at DESC, q.id DESC`).all(...(scoped ? [Number(options.owner_user_id)] : [])).map((row) => ({
      ...row,
      shot_count: Number(row.shot_count || 0),
      completed_count: Number(row.completed_count || 0),
      latest_video_url: row.latest_video_path ? `/static/${String(row.latest_video_path).replace(/^\/+/, '')}` : null,
    }));
}

function createSequence(db, body = {}) {
  const stamp = now();
  const name = String(body.name || '').trim().slice(0, 100) || '未命名全能项目';
  const out = hasOwnerColumn(db)
    ? db.prepare('INSERT INTO omni_video_sequences (name, is_default, owner_user_id, created_at, updated_at) VALUES (?, 0, ?, ?, ?)').run(name, body.owner_user_id || null, stamp, stamp)
    : db.prepare('INSERT INTO omni_video_sequences (name, is_default, created_at, updated_at) VALUES (?, 0, ?, ?)').run(name, stamp, stamp);
  createShot(db, out.lastInsertRowid, {});
  return get(db, out.lastInsertRowid);
}

function updateSequence(db, id, body) {
  const sequence = db.prepare('SELECT * FROM omni_video_sequences WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  if (!sequence) throw new Error('创作序列不存在');
  const name = String(body?.name ?? sequence.name).trim().slice(0, 100) || '未命名视频';
  db.prepare('UPDATE omni_video_sequences SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), sequence.id);
  return get(db, sequence.id);
}

function createShot(db, sequenceId, body) {
  const sequence = db.prepare('SELECT id FROM omni_video_sequences WHERE id = ? AND deleted_at IS NULL').get(Number(sequenceId));
  if (!sequence) throw new Error('创作序列不存在');
  const current = listShots(db, sequenceId);
  let order = current.length ? Math.max(...current.map((s) => Number(s.sort_order))) + 10 : 10;
  if (body.after_shot_id) {
    const after = current.find((s) => s.id === Number(body.after_shot_id));
    if (after) { order = Number(after.sort_order) + 5; }
  }
  const stamp = now();
  const masterSettings = current[0]?.settings || { ...DEFAULT_SHOT_SETTINGS };
  const out = db.prepare(`INSERT INTO omni_video_sequence_shots
    (sequence_id, title, sort_order, prompt, assets_json, settings_json, created_at, updated_at)
    VALUES (?, ?, ?, '', '[]', ?, ?, ?)`).run(Number(sequenceId), body.title || '未命名镜头', order, JSON.stringify(masterSettings), stamp, stamp);
  normalizeOrder(db, sequenceId);
  return listShots(db, sequenceId).find((s) => s.id === Number(out.lastInsertRowid));
}

function updateShot(db, sequenceId, shotId, body) {
  const shot = db.prepare('SELECT * FROM omni_video_sequence_shots WHERE id = ? AND sequence_id = ? AND deleted_at IS NULL').get(Number(shotId), Number(sequenceId));
  if (!shot) throw new Error('镜头不存在');
  const settings = normalizedShotSettings(body.settings !== undefined ? { ...parse(shot.settings_json, {}), ...body.settings } : parse(shot.settings_json, {}));
  // Persisted drafts may target Seedance 2.5 (4–30s). The actual generation
  // route applies the selected model's capability limit before submission.
  if (settings.duration != null) settings.duration = Math.min(30, Math.max(4, Math.round(Number(settings.duration) || 15)));
  if (settings.model === 'auto') settings.model = '';
  if (settings.resolution != null && !['480p', '720p', '1080p'].includes(String(settings.resolution))) settings.resolution = '720p';
  db.prepare(`UPDATE omni_video_sequence_shots SET title = ?, prompt = ?, prompt_document_json = ?, assets_json = ?, settings_json = ?, updated_at = ? WHERE id = ?`).run(
    body.title ?? shot.title, body.prompt ?? shot.prompt, body.prompt_document !== undefined ? JSON.stringify(body.prompt_document) : shot.prompt_document_json,
    body.assets !== undefined ? JSON.stringify(body.assets) : shot.assets_json, JSON.stringify(settings), now(), shot.id);
  return listShots(db, sequenceId).find((s) => s.id === shot.id);
}

function deleteShot(db, sequenceId, shotId) {
  const shots = listShots(db, sequenceId);
  if (shots.length <= 1) throw new Error('至少保留一个镜头');
  const result = db.prepare('UPDATE omni_video_sequence_shots SET deleted_at = ?, updated_at = ? WHERE id = ? AND sequence_id = ? AND deleted_at IS NULL').run(now(), now(), Number(shotId), Number(sequenceId));
  normalizeOrder(db, sequenceId);
  return result.changes > 0;
}

function reorder(db, sequenceId, ids) {
  const current = listShots(db, sequenceId).map((s) => s.id);
  const normalized = Array.isArray(ids) ? ids.map(Number) : [];
  if (normalized.length !== current.length || [...current].sort().join(',') !== [...normalized].sort().join(',')) throw new Error('镜头排序数据不完整');
  const stmt = db.prepare('UPDATE omni_video_sequence_shots SET sort_order = ?, updated_at = ? WHERE id = ? AND sequence_id = ?');
  const tx = db.transaction(() => normalized.forEach((id, index) => stmt.run((index + 1) * 10, now(), id, Number(sequenceId)))); tx();
  return listShots(db, sequenceId);
}

function normalizeOrder(db, sequenceId) {
  const ids = db.prepare('SELECT id FROM omni_video_sequence_shots WHERE sequence_id = ? AND deleted_at IS NULL ORDER BY sort_order, id').all(Number(sequenceId));
  const stmt = db.prepare('UPDATE omni_video_sequence_shots SET sort_order = ? WHERE id = ?');
  const tx = db.transaction(() => ids.forEach((row, index) => stmt.run((index + 1) * 10, row.id))); tx();
}

function deleteSequence(db, id) {
  const sequence = db.prepare('SELECT * FROM omni_video_sequences WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  if (!sequence) throw new Error('全能创作项目不存在');
  const stamp = now();
  const tx = db.transaction(() => {
    db.prepare('UPDATE omni_video_sequences SET deleted_at = ?, updated_at = ? WHERE id = ?').run(stamp, stamp, sequence.id);
    db.prepare('UPDATE omni_video_sequence_shots SET deleted_at = ?, updated_at = ? WHERE sequence_id = ? AND deleted_at IS NULL').run(stamp, stamp, sequence.id);
  }); tx();
  return true;
}

function restoreSequence(db, id) {
  const sequence = db.prepare('SELECT * FROM omni_video_sequences WHERE id = ? AND deleted_at IS NOT NULL').get(Number(id));
  if (!sequence) throw new Error('已删除项目不存在');
  const stamp = now();
  const tx = db.transaction(() => {
    db.prepare('UPDATE omni_video_sequences SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(stamp, sequence.id);
    db.prepare('UPDATE omni_video_sequence_shots SET deleted_at = NULL, updated_at = ? WHERE sequence_id = ?').run(stamp, sequence.id);
  }); tx();
  return get(db, sequence.id);
}

function purgeSequence(db, id) {
  const sequence = db.prepare('SELECT id FROM omni_video_sequences WHERE id = ? AND deleted_at IS NOT NULL').get(Number(id));
  if (!sequence) throw new Error('请先将项目移入已删除列表');
  const tx = db.transaction(() => {
    // 任务和视频成片保留：只断开已删除镜头，确保历史可追溯。
    db.prepare('DELETE FROM omni_video_sequence_shots WHERE sequence_id = ?').run(sequence.id);
    db.prepare('DELETE FROM omni_video_sequences WHERE id = ?').run(sequence.id);
  }); tx();
  return true;
}

module.exports = { ensureDefault, list, get, createSequence, updateSequence, createShot, updateShot, deleteShot, deleteSequence, restoreSequence, purgeSequence, reorder, listShots };
