const DEFAULTS = Object.freeze({
  text_model: 'auto', video_model: 'auto', duration: 15, resolution: '720p', aspect_ratio: '16:9',
  upscale_resolution: '1080p', target_fps: null,
});
const KEYS = Object.keys(DEFAULTS);

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...value };
  try {
    const out = value ? JSON.parse(value) : {};
    return out && typeof out === 'object' && !Array.isArray(out) ? out : {};
  } catch (_) { return {}; }
}

function normalize(input, partial = false) {
  const source = parseObject(input);
  const out = {};
  for (const key of KEYS) {
    if (partial && source[key] === undefined) continue;
    const value = source[key] === undefined ? DEFAULTS[key] : source[key];
    if (key === 'duration') out[key] = Math.min(15, Math.max(1, Number(value) || DEFAULTS.duration));
    else if (key === 'upscale_resolution') out[key] = value == null || value === '' ? null : String(value).trim().toLowerCase();
    else if (key === 'target_fps') out[key] = value == null || value === '' ? null : Number(value);
    else out[key] = String(value == null || value === '' ? DEFAULTS[key] : value).trim();
  }
  return out;
}

function validateEffective(settings) {
  const candidate = { ...settings };
  if (candidate.upscale_resolution && String(candidate.upscale_resolution).toLowerCase() === String(candidate.resolution).toLowerCase()) candidate.upscale_resolution = null;
  const policy = require('./videoPostprocessPolicy').normalize(candidate);
  return { ...settings, resolution: policy.resolution, upscale_resolution: policy.upscale_resolution, target_fps: policy.target_fps };
}

function episodeDefaults(db, episodeId) {
  const row = db.prepare('SELECT generation_defaults_json FROM episodes WHERE id = ? AND deleted_at IS NULL').get(Number(episodeId));
  if (!row) return null;
  return validateEffective(normalize({ ...DEFAULTS, ...parseObject(row.generation_defaults_json) }));
}

function effective(defaults, overrides) {
  return validateEffective(normalize({ ...DEFAULTS, ...normalize(defaults), ...normalize(overrides, true) }));
}

function materializedPatch(settings) {
  return {
    text_model: settings.text_model === 'auto' ? null : settings.text_model,
    video_model: settings.video_model === 'auto' ? null : settings.video_model,
    duration: settings.duration,
    video_resolution: settings.resolution,
    video_aspect_ratio: settings.aspect_ratio,
    video_upscale_resolution: settings.upscale_resolution,
    video_target_fps: settings.target_fps,
  };
}

function materializeStoryboard(db, storyboardId, settings, at) {
  const patch = materializedPatch(settings);
  db.prepare(`UPDATE storyboards SET text_model=?, video_model=?, duration=?, video_resolution=?, video_aspect_ratio=?,
    video_upscale_resolution=?, video_target_fps=?, updated_at=? WHERE id=? AND deleted_at IS NULL`)
    .run(patch.text_model, patch.video_model, patch.duration, patch.video_resolution, patch.video_aspect_ratio,
      patch.video_upscale_resolution, patch.video_target_fps, at, Number(storyboardId));
}

function canonicalStoryboards(db, episodeId, columns = '*') {
  const rows = db.prepare(`SELECT ${columns} FROM storyboards WHERE episode_id=? AND deleted_at IS NULL
    ORDER BY sort_order ASC, storyboard_number ASC, id ASC`).all(Number(episodeId));
  // Keep this order identical to the storyboard list API: duplicate shot numbers
  // occupy their original visual slot, while the newest row is the visible one.
  const byNumber = new Map();
  const extras = [];
  for (const row of rows) {
    const number = Number(row.storyboard_number);
    if (Number.isFinite(number) && number > 0) {
      const previous = byNumber.get(number);
      if (!previous || Number(row.id) > Number(previous.id)) byNumber.set(number, row);
    } else extras.push(row);
  }
  return [...byNumber.values(), ...extras];
}

function firstStoryboard(db, episodeId) {
  return canonicalStoryboards(
    db,
    episodeId,
    'id, storyboard_number, sort_order, text_model, video_model, duration, video_resolution, video_aspect_ratio, video_upscale_resolution, video_target_fps'
  )[0] || null;
}

function settingsFromStoryboard(row, usePostprocessDefaults = false) {
  if (!row) return { ...DEFAULTS };
  return validateEffective(normalize({
    text_model: row.text_model || DEFAULTS.text_model,
    video_model: row.video_model || DEFAULTS.video_model,
    duration: row.duration || DEFAULTS.duration,
    resolution: row.video_resolution || DEFAULTS.resolution,
    aspect_ratio: row.video_aspect_ratio || DEFAULTS.aspect_ratio,
    upscale_resolution: usePostprocessDefaults && row.video_upscale_resolution == null ? DEFAULTS.upscale_resolution : (row.video_upscale_resolution || null),
    target_fps: usePostprocessDefaults && row.video_target_fps == null ? DEFAULTS.target_fps : (row.video_target_fps || null),
  }));
}

function ensureEpisodeMaster(db, episodeId) {
  const row = db.prepare('SELECT generation_defaults_json FROM episodes WHERE id=? AND deleted_at IS NULL').get(Number(episodeId));
  if (!row) return null;
  const stored = parseObject(row.generation_defaults_json);
  const first = firstStoryboard(db, episodeId);
  // The ordered first shot is the source of truth. This also upgrades data
  // written by the former direct-column UI before the master contract existed.
  const storedHasPostprocessChoice = Object.prototype.hasOwnProperty.call(stored, 'upscale_resolution')
    || Object.prototype.hasOwnProperty.call(stored, 'target_fps');
  const defaults = first ? settingsFromStoryboard(first, !storedHasPostprocessChoice) : validateEffective(normalize({ ...DEFAULTS, ...stored }));
  const at = new Date().toISOString();
  if (!Object.keys(stored).length || JSON.stringify(normalize({ ...DEFAULTS, ...stored })) !== JSON.stringify(defaults)) {
    db.prepare('UPDATE episodes SET generation_defaults_json=?, updated_at=? WHERE id=?').run(JSON.stringify(defaults), at, Number(episodeId));
  }
  if (first) {
    db.prepare('UPDATE storyboards SET generation_overrides_json=NULL WHERE id=?').run(first.id);
  }
  return defaults;
}

function getEpisodeSettings(db, episodeId) {
  const defaults = ensureEpisodeMaster(db, episodeId);
  if (!defaults) return null;
  const rows = canonicalStoryboards(db, episodeId, 'id, storyboard_number, sort_order, generation_overrides_json');
  return {
    episode_id: Number(episodeId), defaults,
    master_storyboard_id: rows[0]?.id || null,
    storyboards: rows.map((row, index) => {
      const overrides = index === 0 ? {} : normalize(row.generation_overrides_json, true);
      return { id: row.id, mode: index === 0 ? 'master' : (Object.keys(overrides).length ? 'custom' : 'inherited'), overrides, effective: effective(defaults, overrides) };
    }),
  };
}

function setEpisodeDefaults(db, episodeId, input, overridePolicy = 'preserve') {
  const episode = db.prepare('SELECT id FROM episodes WHERE id=? AND deleted_at IS NULL').get(Number(episodeId));
  if (!episode) return null;
  const defaults = validateEffective(normalize(input));
  const replace = overridePolicy === 'replace';
  const at = new Date().toISOString();
  let affected = 0;
  db.transaction(() => {
    db.prepare('UPDATE episodes SET generation_defaults_json=?, updated_at=? WHERE id=?').run(JSON.stringify(defaults), at, Number(episodeId));
    const rows = db.prepare('SELECT id, generation_overrides_json FROM storyboards WHERE episode_id=? AND deleted_at IS NULL').all(Number(episodeId));
    const masterId = firstStoryboard(db, episodeId)?.id;
    for (const row of rows) {
      const overrides = replace || Number(row.id) === Number(masterId) ? {} : normalize(row.generation_overrides_json, true);
      if (replace || Number(row.id) === Number(masterId)) db.prepare('UPDATE storyboards SET generation_overrides_json=NULL WHERE id=?').run(row.id);
      materializeStoryboard(db, row.id, effective(defaults, overrides), at);
      affected += 1;
    }
  })();
  return { ...getEpisodeSettings(db, episodeId), affected_count: affected, override_policy: replace ? 'replace' : 'preserve' };
}

function setStoryboardSettings(db, storyboardId, input, scope = 'current') {
  const row = db.prepare(`SELECT s.id, s.episode_id, s.generation_overrides_json, e.generation_defaults_json
    FROM storyboards s JOIN episodes e ON e.id=s.episode_id WHERE s.id=? AND s.deleted_at IS NULL AND e.deleted_at IS NULL`).get(Number(storyboardId));
  if (!row) return null;
  const defaults = ensureEpisodeMaster(db, row.episode_id);
  if (!defaults) return null;
  const master = firstStoryboard(db, row.episode_id);
  if (scope === 'episode_default' || Number(master?.id) === Number(row.id)) return setEpisodeDefaults(db, row.episode_id, input, 'preserve');
  const supplied = normalize(input, true);
  const overrides = { ...normalize(row.generation_overrides_json, true), ...supplied };
  const at = new Date().toISOString();
  db.transaction(() => {
    db.prepare('UPDATE storyboards SET generation_overrides_json=? WHERE id=?').run(JSON.stringify(overrides), Number(storyboardId));
    materializeStoryboard(db, storyboardId, effective(defaults, overrides), at);
  })();
  return { id: Number(storyboardId), episode_id: row.episode_id, mode: 'custom', overrides, effective: effective(defaults, overrides), updated_at: at };
}

function clearStoryboardOverrides(db, storyboardId) {
  const row = db.prepare(`SELECT s.id, s.episode_id, e.generation_defaults_json FROM storyboards s JOIN episodes e ON e.id=s.episode_id
    WHERE s.id=? AND s.deleted_at IS NULL AND e.deleted_at IS NULL`).get(Number(storyboardId));
  if (!row) return null;
  const defaults = validateEffective(normalize({ ...DEFAULTS, ...parseObject(row.generation_defaults_json) }));
  const at = new Date().toISOString();
  db.transaction(() => {
    db.prepare('UPDATE storyboards SET generation_overrides_json=NULL WHERE id=?').run(Number(storyboardId));
    materializeStoryboard(db, storyboardId, defaults, at);
  })();
  return { id: Number(storyboardId), episode_id: row.episode_id, mode: 'inherited', overrides: {}, effective: defaults, updated_at: at };
}

function initializeStoryboardFromMaster(db, storyboardId, sourceSettings = null) {
  const row = db.prepare('SELECT id, episode_id FROM storyboards WHERE id=? AND deleted_at IS NULL').get(Number(storyboardId));
  if (!row) return null;
  const defaults = sourceSettings ? validateEffective(normalize(sourceSettings)) : ensureEpisodeMaster(db, row.episode_id);
  if (!defaults) return null;
  const at = new Date().toISOString();
  db.prepare('UPDATE storyboards SET generation_overrides_json=NULL WHERE id=?').run(Number(storyboardId));
  materializeStoryboard(db, storyboardId, defaults, at);
  const isMaster = Number(firstStoryboard(db, row.episode_id)?.id) === Number(storyboardId);
  if (isMaster) db.prepare('UPDATE episodes SET generation_defaults_json=?, updated_at=? WHERE id=?').run(JSON.stringify(defaults), at, row.episode_id);
  return { id: Number(storyboardId), episode_id: row.episode_id, mode: isMaster ? 'master' : 'inherited', overrides: {}, effective: defaults };
}

module.exports = { DEFAULTS, normalize, effective, getEpisodeSettings, setEpisodeDefaults, setStoryboardSettings, clearStoryboardOverrides, initializeStoryboardFromMaster };
