'use strict';

// `/static` is a byte-serving route. Resolve each key to a persisted owner
// before the storage layer reads bytes. URL and JSON references are hints for
// history displays; only durable records or an explicit project/global source
// can authorize a media key.

const path = require('path');
const { normalizeStorageKey } = require('../utils/storagePath');

function decodePathPart(value) {
  let current = String(value || '');
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch (_) { break; }
  }
  return current;
}

function normalizeMediaReference(value, storageRoot) {
  if (value == null || typeof value === 'object') return null;
  let raw = decodePathPart(String(value).trim());
  if (!raw) return null;
  raw = raw.split(/[?#]/, 1)[0];
  if (!raw) return null;

  // Persisted rows sometimes contain a local `/static/...` URL. Other
  // supplier URLs are ignored unless they carry this local path marker.
  const marker = raw.indexOf('/static/');
  let looksAbsolute = path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw);
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
    if (marker < 0) return null;
    raw = raw.slice(marker + '/static/'.length);
    looksAbsolute = false;
  } else if (marker >= 0) {
    raw = raw.slice(marker + '/static/'.length);
    looksAbsolute = false;
  } else {
    raw = raw.replace(/^static\//i, '');
    if (!looksAbsolute) raw = raw.replace(/^\/+/, '');
  }
  raw = raw.replace(/\\/g, '/');

  // Historical rows may contain an absolute path. Preserve them only when
  // they resolve under this deployment's storage root.
  if (storageRoot && looksAbsolute) {
    try {
      const root = path.resolve(storageRoot);
      const absolute = path.resolve(raw);
      const relative = path.relative(root, absolute);
      if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) return null;
      raw = relative.replace(/\\/g, '/');
    } catch (_) { return null; }
  }
  try { return normalizeStorageKey(raw); } catch (_) { return null; }
}

function flattenMediaValues(value, output = []) {
  if (value == null) return output;
  if (Array.isArray(value)) {
    value.forEach((item) => flattenMediaValues(item, output));
    return output;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((item) => flattenMediaValues(item, output));
    return output;
  }
  const text = String(value);
  output.push(text);
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { flattenMediaValues(JSON.parse(trimmed), output); } catch (_) {}
  }
  return output;
}

function likeEscape(value) {
  return String(value).replace(/[\\%_]/g, (match) => `\\${match}`);
}

function keyVariants(key) {
  return [...new Set([
    key,
    `/${key}`,
    `/static/${key}`,
    `static/${key}`,
    key.replace(/\//g, '\\'),
    `\\${key.replace(/\//g, '\\')}`,
    `/static/${key.replace(/\//g, '\\')}`,
  ])];
}

function fieldName(field) { return typeof field === 'string' ? field : field.name; }
function fieldRole(field, fallback = 'reference') { return typeof field === 'string' ? fallback : (field.role || fallback); }

function queryRows(db, sql, params) {
  try { return db.prepare(sql).all(...params); }
  catch (error) {
    // A genuinely old installation may lack one optional historical table or
    // column. Keep other ownership sources usable, but surface SQL mistakes.
    if (/no such table|no such column/i.test(String(error.message || ''))) return [];
    throw error;
  }
}

function matchFields(row, fields, key, storageRoot) {
  return fields.filter((field) => flattenMediaValues(row[fieldName(field)])
    .some((value) => normalizeMediaReference(value, storageRoot) === key));
}

// All table/column names below are migration-owned. The SQL remains explicit
// so a static request does not run PRAGMA/table discovery for every image.
const DEFINITIONS = [
  { table: 'dramas', alias: 'd', pathFields: [{ name: 'thumbnail', role: 'project' }], owner: 'd.owner_user_id', project: 'd.id', where: 'd.deleted_at IS NULL' },
  { table: 'episodes', alias: 'e', pathFields: [{ name: 'video_url', role: 'project' }, { name: 'thumbnail', role: 'project' }], owner: 'd.owner_user_id', project: 'd.id', joins: 'JOIN dramas d ON d.id = e.drama_id', where: 'e.deleted_at IS NULL AND d.deleted_at IS NULL' },
  { table: 'storyboards', alias: 's', pathFields: [
    { name: 'image_url', role: 'project' }, { name: 'local_path', role: 'project' },
    { name: 'composed_image', role: 'project' }, { name: 'video_url', role: 'project' },
    { name: 'last_frame_image_url', role: 'project' }, { name: 'last_frame_local_path', role: 'project' },
    { name: 'audio_local_path', role: 'project' }, { name: 'narration_audio_local_path', role: 'project' },
  ], referenceFields: ['result'], owner: 'd.owner_user_id', project: 'd.id', joins: 'JOIN episodes e ON e.id = s.episode_id JOIN dramas d ON d.id = e.drama_id', where: 's.deleted_at IS NULL AND e.deleted_at IS NULL AND d.deleted_at IS NULL' },
  { table: 'characters', alias: 'c', pathFields: [
    { name: 'image_url', role: 'project' }, { name: 'local_path', role: 'project' },
    { name: 'ref_image', role: 'project' }, { name: 'four_view_image_url', role: 'project' },
  ], referenceFields: ['extra_images'], owner: 'd.owner_user_id', project: 'd.id', joins: 'JOIN dramas d ON d.id = c.drama_id', where: 'c.deleted_at IS NULL AND d.deleted_at IS NULL' },
  { table: 'scenes', alias: 's', pathFields: [
    { name: 'image_url', role: 'project' }, { name: 'local_path', role: 'project' }, { name: 'ref_image', role: 'project' },
  ], referenceFields: ['extra_images'], owner: 'd.owner_user_id', project: 'd.id', joins: 'JOIN dramas d ON d.id = s.drama_id', where: 's.deleted_at IS NULL AND d.deleted_at IS NULL' },
  { table: 'props', alias: 'p', pathFields: [
    { name: 'image_url', role: 'project' }, { name: 'local_path', role: 'project' }, { name: 'ref_image', role: 'project' },
  ], referenceFields: ['extra_images'], owner: 'd.owner_user_id', project: 'd.id', joins: 'JOIN dramas d ON d.id = p.drama_id', where: 'p.deleted_at IS NULL AND d.deleted_at IS NULL' },
  { table: 'image_generations', alias: 'i', pathFields: [
    { name: 'image_url', role: 'generation' }, { name: 'local_path', role: 'generation' },
  ], referenceFields: ['reference_images'], owner: 'COALESCE(i.owner_user_id, d.owner_user_id)', project: 'i.drama_id', joins: 'LEFT JOIN dramas d ON d.id = i.drama_id', where: 'i.deleted_at IS NULL AND (i.owner_user_id > 0 OR d.id IS NULL OR d.deleted_at IS NULL)' },
  { table: 'video_generations', alias: 'v', pathFields: [
    { name: 'video_url', role: 'generation' }, { name: 'image_url', role: 'generation' },
    { name: 'first_frame_url', role: 'generation' }, { name: 'last_frame_url', role: 'generation' },
    { name: 'local_path', role: 'generation' }, { name: 'source_local_path', role: 'generation' },
    { name: 'upscale_local_path', role: 'generation' }, { name: 'poster_local_path', role: 'generation' },
  ], referenceFields: ['reference_image_urls'], owner: 'COALESCE(v.owner_user_id, d.owner_user_id)', project: 'v.drama_id', joins: 'LEFT JOIN dramas d ON d.id = v.drama_id', where: 'v.deleted_at IS NULL AND (v.owner_user_id > 0 OR d.id IS NULL OR d.deleted_at IS NULL)' },
  { table: 'video_merges', alias: 'm', pathFields: [{ name: 'merged_url', role: 'project' }], owner: 'CASE WHEN e.id IS NOT NULL THEN episode_drama.owner_user_id ELSE merge_drama.owner_user_id END', project: 'CASE WHEN e.id IS NOT NULL THEN e.drama_id ELSE m.drama_id END', joins: 'LEFT JOIN episodes e ON e.id = m.episode_id AND e.deleted_at IS NULL LEFT JOIN dramas episode_drama ON episode_drama.id = e.drama_id AND episode_drama.deleted_at IS NULL LEFT JOIN dramas merge_drama ON merge_drama.id = m.drama_id AND merge_drama.deleted_at IS NULL', where: 'm.deleted_at IS NULL' },
  { table: 'assets', alias: 'a', pathFields: [
    { name: 'local_path', role: 'asset' }, { name: 'thumbnail_local_path', role: 'asset' },
  ], owner: 'COALESCE(a.owner_user_id, d.owner_user_id)', project: 'a.drama_id', joins: 'LEFT JOIN dramas d ON d.id = a.drama_id', where: 'a.deleted_at IS NULL AND (a.owner_user_id > 0 OR d.id IS NULL OR d.deleted_at IS NULL)' },
  { table: 'character_libraries', alias: 'c', pathFields: [
    { name: 'image_url', role: 'library' }, { name: 'local_path', role: 'library' }, { name: 'four_view_image_url', role: 'library' },
  ], owner: 'd.owner_user_id', project: 'c.drama_id', global: 'c.drama_id IS NULL', joins: 'LEFT JOIN dramas d ON d.id = c.drama_id', where: 'c.deleted_at IS NULL AND (d.id IS NULL OR d.deleted_at IS NULL)' },
  { table: 'scene_libraries', alias: 's', pathFields: [
    { name: 'image_url', role: 'library' }, { name: 'local_path', role: 'library' },
  ], owner: 'd.owner_user_id', project: 's.drama_id', global: 's.drama_id IS NULL', joins: 'LEFT JOIN dramas d ON d.id = s.drama_id', where: 's.deleted_at IS NULL AND (d.id IS NULL OR d.deleted_at IS NULL)' },
  { table: 'prop_libraries', alias: 'p', pathFields: [
    { name: 'image_url', role: 'library' }, { name: 'local_path', role: 'library' },
  ], owner: 'd.owner_user_id', project: 'p.drama_id', global: 'p.drama_id IS NULL', joins: 'LEFT JOIN dramas d ON d.id = p.drama_id', where: 'p.deleted_at IS NULL AND (d.id IS NULL OR d.deleted_at IS NULL)' },
  { table: 'video_upscale_jobs', alias: 'u', pathFields: [
    { name: 'input_video_url', role: 'postprocess' }, { name: 'source_local_path', role: 'postprocess' }, { name: 'output_local_path', role: 'postprocess' },
  ], owner: 'u.owner_user_id' },
  { table: 'video_interpolation_jobs', alias: 'n', pathFields: [
    { name: 'input_video_url', role: 'postprocess' }, { name: 'source_local_path', role: 'postprocess' }, { name: 'output_local_path', role: 'postprocess' },
  ], owner: 'n.owner_user_id' },
  { table: 'external_asset_bindings', alias: 'b', pathFields: [{ name: 'source_local_path', role: 'binding' }], referenceFields: ['source_image_url'], owner: 'b.owner_user_id' },
];

function queryDefinition(db, definition, key, storageRoot) {
  const fields = [...definition.pathFields, ...(definition.referenceFields || [])];
  const variants = keyVariants(key);
  const patterns = [`%${likeEscape(key)}%`, `%${likeEscape(key.replace(/\//g, '\\'))}%`];
  const terms = [];
  const params = [];
  for (const field of fields) {
    const name = fieldName(field);
    terms.push(`TRIM(${definition.alias}."${name}") IN (${variants.map(() => '?').join(', ')})`);
    params.push(...variants);
    for (const pattern of patterns) {
      terms.push(`${definition.alias}."${name}" LIKE ? ESCAPE '\\'`);
      params.push(pattern);
    }
  }
  if (!terms.length) return [];
  const select = [
    `${definition.alias}.*`,
    `${definition.owner || 'NULL'} AS __media_owner_user_id`,
    `${definition.project || 'NULL'} AS __media_project_id`,
  ].join(', ');
  const sql = `SELECT ${select} FROM "${definition.table}" ${definition.alias} ${definition.joins || ''} WHERE ${definition.where || '1=1'} AND (${terms.join(' OR ')})`;
  return queryRows(db, sql, params).flatMap((row) => {
    const matches = matchFields(row, fields, key, storageRoot);
    return matches.length ? [{ row, definition, matches }] : [];
  });
}

function projectOwnerForKey(db, key) {
  const match = /^projects\/(\d+)_/.exec(key);
  if (!match) return null;
  try {
    const row = db.prepare('SELECT owner_user_id FROM dramas WHERE id = ? AND deleted_at IS NULL').get(Number(match[1]));
    const owner = Number(row?.owner_user_id);
    return Number.isSafeInteger(owner) && owner > 0 ? owner : null;
  } catch (_) { return null; }
}

// A global library row is a shared record only when the row explicitly says
// that it is shared, or when it points at a supported durable source record.
// An arbitrary/unknown source_type must never turn an unbound row into a
// public media grant.
const EXPLICIT_GLOBAL_SOURCE_TYPES = new Set(['admin', 'builtin', 'generated', 'global', 'system']);

function librarySource(db, row) {
  const sourceType = String(row.source_type || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  const rawSourceId = row.source_id;
  const hasSourceId = rawSourceId != null && String(rawSourceId).trim() !== '';
  const sourceId = Number(row.source_id);
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) {
    // Before source_type was added, console-created global rows stored NULL.
    // Keep those historical rows shared. New global writes are still limited
    // to console administrators by libraryOwnership.
    if (hasSourceId) return null;
    return (!sourceType || EXPLICIT_GLOBAL_SOURCE_TYPES.has(sourceType)) ? { shared: true } : null;
  }
  const queries = {
    character: 'SELECT d.owner_user_id FROM characters c JOIN dramas d ON d.id=c.drama_id WHERE c.id=? AND c.deleted_at IS NULL AND d.deleted_at IS NULL',
    scene: 'SELECT d.owner_user_id FROM scenes c JOIN dramas d ON d.id=c.drama_id WHERE c.id=? AND c.deleted_at IS NULL AND d.deleted_at IS NULL',
    prop: 'SELECT d.owner_user_id FROM props c JOIN dramas d ON d.id=c.drama_id WHERE c.id=? AND c.deleted_at IS NULL AND d.deleted_at IS NULL',
    asset: 'SELECT COALESCE(d.owner_user_id, a.owner_user_id) AS owner_user_id FROM assets a LEFT JOIN dramas d ON d.id=a.drama_id WHERE a.id=? AND a.deleted_at IS NULL',
    image_generation: 'SELECT COALESCE(i.owner_user_id, d.owner_user_id) AS owner_user_id FROM image_generations i LEFT JOIN dramas d ON d.id=i.drama_id WHERE i.id=? AND i.deleted_at IS NULL',
    video_generation: 'SELECT COALESCE(v.owner_user_id, d.owner_user_id) AS owner_user_id FROM video_generations v LEFT JOIN dramas d ON d.id=v.drama_id WHERE v.id=? AND v.deleted_at IS NULL',
  };
  const sql = queries[sourceType];
  if (!sql) return null;
  try {
    const owner = Number(db.prepare(sql).get(sourceId)?.owner_user_id);
    return Number.isSafeInteger(owner) && owner > 0 ? { owner_user_id: owner } : null;
  } catch (_) { return null; }
}

function candidateForMatch(db, match, field, projectOwnerId) {
  const { row } = match;
  const role = fieldRole(field);
  const owner = Number(row.__media_owner_user_id);
  const projectId = Number(row.__media_project_id);
  if (role === 'reference' || (!Number.isSafeInteger(owner) && role !== 'library')) return null;

  if (role === 'library' && !projectId) {
    // A global row is shared only after its optional source record is valid.
    // This prevents a user's project resource from being republished by
    // pointing a global row at another user's path.
    const source = librarySource(db, row);
    if (!source) return null;
    if (projectOwnerId != null && source.owner_user_id != null && source.owner_user_id !== projectOwnerId) return null;
    return source.shared
      ? { global: true, priority: 100 }
      : { global: true, global_owner_user_id: source.owner_user_id, priority: 70 };
  }
  if (projectOwnerId != null) {
    if (role === 'library' && projectId && owner !== projectOwnerId) return null;
    if (['project', 'asset', 'generation', 'postprocess', 'binding', 'library'].includes(role)) {
      if (owner !== projectOwnerId) return null;
      return { owner_user_id: owner, priority: 100 };
    }
  }
  if (role === 'library') {
    // Legacy project library paths without the project prefix still retain the
    // project owner as a recoverable, lower-confidence source.
    return owner > 0 ? { owner_user_id: owner, priority: 20 } : null;
  }
  if (['generation', 'postprocess', 'binding'].includes(role)) {
    return owner > 0 ? { owner_user_id: owner, priority: 80 } : null;
  }
  if (role === 'project') {
    // This preserves URL-only and pre-project-layout history. A canonical
    // `projects/<drama-id>_...` key takes the stronger path-owner branch above.
    return owner > 0 ? { owner_user_id: owner, priority: 20 } : null;
  }
  if (role === 'asset') {
    // An upload row is a valid source for old root-level media. If multiple
    // owners point at the same root key, chooseEffectiveCandidates rejects the
    // collision instead of selecting one by timestamp or row ID.
    return owner > 0 ? { owner_user_id: owner, priority: 40 } : null;
  }
  return null;
}

const ARCHIVE_SOURCE_QUERIES = {
  image_generation: 'SELECT COALESCE(i.owner_user_id, d.owner_user_id) AS owner_user_id FROM image_generations i LEFT JOIN dramas d ON d.id=i.drama_id WHERE i.id=? AND i.deleted_at IS NULL AND (i.owner_user_id > 0 OR d.id IS NULL OR d.deleted_at IS NULL)',
  video_generation: 'SELECT COALESCE(v.owner_user_id, d.owner_user_id) AS owner_user_id FROM video_generations v LEFT JOIN dramas d ON d.id=v.drama_id WHERE v.id=? AND v.deleted_at IS NULL AND (v.owner_user_id > 0 OR d.id IS NULL OR d.deleted_at IS NULL)',
  asset: 'SELECT COALESCE(d.owner_user_id, a.owner_user_id) AS owner_user_id FROM assets a LEFT JOIN dramas d ON d.id=a.drama_id WHERE a.id=? AND a.deleted_at IS NULL AND (a.owner_user_id > 0 OR d.id IS NULL OR d.deleted_at IS NULL)',
  storyboard: 'SELECT d.owner_user_id AS owner_user_id FROM storyboards s JOIN episodes e ON e.id=s.episode_id JOIN dramas d ON d.id=e.drama_id WHERE s.id=? AND s.deleted_at IS NULL AND e.deleted_at IS NULL AND d.deleted_at IS NULL',
  video_upscale: 'SELECT owner_user_id FROM video_upscale_jobs WHERE id=?',
  video_interpolation: 'SELECT owner_user_id FROM video_interpolation_jobs WHERE id=?',
};

function archiveOwner(db, sourceType, sourceId) {
  const type = String(sourceType || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  const sql = ARCHIVE_SOURCE_QUERIES[type];
  if (!sql || !sourceId) return null;
  try { return db.prepare(sql).get(Number(sourceId))?.owner_user_id ?? null; } catch (_) { return null; }
}

function queryArchiveRows(db, key, storageRoot) {
  const variants = keyVariants(key);
  const patterns = [`%${likeEscape(key)}%`, `%${likeEscape(key.replace(/\//g, '\\'))}%`];
  const terms = [
    `TRIM(local_path) IN (${variants.map(() => '?').join(', ')})`,
    ...patterns.map(() => 'local_path LIKE ? ESCAPE \'\\\'')
  ];
  const params = [...variants, ...patterns];
  const sql = `SELECT local_path, source_type, source_id FROM media_archive_records WHERE ${terms.join(' OR ')}`;
  return queryRows(db, sql, params).filter((row) => normalizeMediaReference(row.local_path, storageRoot) === key)
    .map((row) => ({ owner_user_id: Number(archiveOwner(db, row.source_type, row.source_id)), priority: 90 }))
    .filter((candidate) => Number.isSafeInteger(candidate.owner_user_id) && candidate.owner_user_id > 0);
}

function chooseEffectiveCandidates(candidates) {
  if (!candidates.length) return { global: false, owner_user_id: null };
  const concrete = candidates.filter((candidate) => !candidate.global && candidate.owner_user_id);
  const highestConcretePriority = concrete.length
    ? Math.max(...concrete.map((candidate) => Number(candidate.priority || 0)))
    : -Infinity;
  const concreteAtAuthority = concrete.filter((candidate) => Number(candidate.priority || 0) === highestConcretePriority);
  const concreteOwners = [...new Set(concreteAtAuthority.map((candidate) => Number(candidate.owner_user_id)))];

  // An explicit unbound global row is shared only when it is at least as
  // authoritative as every concrete source. Invalid source types never reach
  // this branch because candidateForMatch filters them out.
  const unboundGlobals = candidates.filter((candidate) => candidate.global && candidate.global_owner_user_id == null);
  const highestGlobalPriority = unboundGlobals.length
    ? Math.max(...unboundGlobals.map((candidate) => Number(candidate.priority || 0)))
    : -Infinity;
  if (unboundGlobals.length && highestGlobalPriority >= highestConcretePriority) {
    return { global: true, owner_user_id: null };
  }

  // A source-bound global row can be shared only when every concrete source
  // at the effective authority level belongs to that same source owner. If a
  // path has conflicting concrete owners at that level, fail closed instead
  // of selecting an owner by timestamp or row ID.
  const boundGlobals = candidates.filter((candidate) => candidate.global && candidate.global_owner_user_id != null);
  const boundOwners = [...new Set(boundGlobals.map((candidate) => Number(candidate.global_owner_user_id)))];
  if (boundOwners.length === 1 && concreteOwners.length && concreteOwners.every((owner) => owner === boundOwners[0])) {
    return { global: true, owner_user_id: null };
  }
  if (concreteOwners.length > 1) return { global: false, owner_user_id: null, ambiguous: true };
  if (concreteOwners.length === 1) return { global: false, owner_user_id: concreteOwners[0] };
  if (boundOwners.length === 1) return { global: true, owner_user_id: null };
  if (boundOwners.length > 1) return { global: false, owner_user_id: null, ambiguous: true };
  return { global: false, owner_user_id: null };
}

function normalizeKeyForAuthorization(value, storageRoot) {
  const key = normalizeMediaReference(value, storageRoot);
  if (!key) throw new Error('Invalid media storage key');
  return key;
}

function assertWritableMediaReference(db, value, user, options = {}) {
  if (value == null || String(value).trim() === '') return;
  const result = authorizeMediaPath(db, value, user, options);
  // A newly uploaded file has no durable row until its owner record is
  // inserted. Allow unknown keys at this point. Reject an existing key that
  // is owned by another account or has conflicting durable owners.
  if (!result.allowed && result.matched) {
    const error = new Error('媒体路径不属于当前账号或项目');
    error.code = 'MEDIA_REFERENCE_FORBIDDEN';
    throw error;
  }
}

function validateWritableMediaReferences(db, input, user, fields = ['local_path', 'thumbnail_local_path'], options = {}) {
  if (user == null || !input) return;
  for (const field of fields) assertWritableMediaReference(db, input[field], user, options);
}

function authorizeMediaPath(db, keyOrUrl, user, options = {}) {
  const storageRoot = options.storageRoot;
  let key;
  try { key = normalizeKeyForAuthorization(keyOrUrl, storageRoot); }
  catch (_) { return { allowed: false, status: 404, code: 'MEDIA_NOT_FOUND', key: null, reason: 'invalid_key' }; }
  const userId = Number(user?.id ?? user);
  if (!Number.isSafeInteger(userId) || userId <= 0) return { allowed: false, status: 401, code: 'UNAUTHORIZED', key, reason: 'authentication_required' };

  // The administrator's homepage list explicitly publishes these exact files
  // to signed-in users. It does not share their directory or source project.
  if (require('./settingsService').getHomepageVideoPaths(db).includes(key)) {
    return { allowed: true, status: 200, code: 'MEDIA_ALLOWED', key, matched: true, owner_user_id: null, shared: true };
  }

  // The canonical project layout is already an ownership index: every
  // `projects/<drama-id>_...` key is written under that drama's directory.
  // Resolve this cheap owner lookup before scanning every media table. The
  // static handler still checks that the requested file/object exists.
  const canonicalProjectOwnerId = projectOwnerForKey(db, key);
  if (canonicalProjectOwnerId === userId) {
    return {
      allowed: true,
      status: 200,
      code: 'MEDIA_ALLOWED',
      key,
      matched: false,
      owner_user_id: userId,
      shared: false,
      fast_path: 'project_owner',
    };
  }

  const matches = [];
  for (const definition of DEFINITIONS) matches.push(...queryDefinition(db, definition, key, storageRoot));
  const projectOwnerId = canonicalProjectOwnerId;
  const candidates = matches.flatMap((match) => match.matches.flatMap((field) => {
    const candidate = candidateForMatch(db, match, field, projectOwnerId);
    return candidate ? [candidate] : [];
  }));
  candidates.push(...queryArchiveRows(db, key, storageRoot));

  const explicitSharedPrefixes = Array.isArray(options.sharedPrefixes) ? options.sharedPrefixes : [];
  const sharedByPrefix = explicitSharedPrefixes.some((prefix) => {
    const normalized = normalizeMediaReference(prefix, storageRoot);
    return normalized && (key === normalized || key.startsWith(`${normalized}/`));
  });
  const effective = chooseEffectiveCandidates(candidates);
  if (sharedByPrefix || effective.global || effective.owner_user_id === userId) {
    return { allowed: true, status: 200, code: 'MEDIA_ALLOWED', key, matched: matches.length > 0, owner_user_id: effective.owner_user_id || null, shared: sharedByPrefix || effective.global };
  }
  return { allowed: false, status: 404, code: 'MEDIA_NOT_FOUND', key, matched: matches.length > 0, reason: matches.length ? 'not_owned' : 'unknown_media' };
}

function createStaticMediaAuthorizer(db, options = {}) {
  return ({ key, user, storageRoot } = {}) => authorizeMediaPath(db, key, user, { ...options, storageRoot: storageRoot || options.storageRoot });
}

module.exports = {
  authorizeMediaPath,
  authorizeStaticMedia: authorizeMediaPath,
  createStaticMediaAuthorizer,
  normalizeMediaReference,
  assertWritableMediaReference,
  validateWritableMediaReferences,
};
