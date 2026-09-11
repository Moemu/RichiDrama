'use strict';

const access = require('./projectAccessService');
const storyboard = require('./storyboardService');
const identity = require('./storyboardIdentityService');
const kinds = new Set(['dramas', 'episodes', 'storyboards', 'characters', 'scenes', 'props', 'assets', 'character_libraries', 'scene_libraries', 'prop_libraries']);

function canonical(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const fail = (message, status = 400, code = 'PROJECT_EDIT_INVALID') => Object.assign(new Error(message), { status, code });

function entity(db, kind, id) {
  if (kind === 'storyboards') return storyboard.getStoryboardById(db, id);
  if (kind === 'assets') return require('./assetService').getById(db, id);
  if (kind === 'dramas') return require('./dramaService').getDramaById(db, id);
  if (kind === 'scenes') return require('./sceneService').getSceneById(db, id);
  if (kind === 'props') return require('./propService').getById(db, id);
  return db.prepare(`SELECT * FROM ${kind} WHERE id=? AND deleted_at IS NULL`).get(id);
}

function generationState(db, episodeId) {
  return identity.orderedActiveRows(db, episodeId).map(id => {
    const row = storyboard.getStoryboardById(db, id);
    return [row.id, row.text_model || 'auto', row.video_model || 'auto', row.duration,
      row.video_resolution, row.video_aspect_ratio, row.video_upscale_resolution ?? null,
      row.video_target_fps ?? null, row.generation_overrides || {}];
  });
}

function fieldValue(db, kind, row, field) {
  if (kind === 'storyboards' && field === 'frame_prompts') return db.prepare('SELECT frame_type, prompt, description, layout FROM frame_prompts WHERE storyboard_id=? ORDER BY frame_type').all(row.id);
  if (kind === 'episodes' && field === 'storyboard_order') return identity.orderedActiveRows(db, row.id);
  if (kind === 'episodes' && field === 'generation_state') return generationState(db, row.id);
  if (field === 'omni_asset_usage_json') return row.omni_asset_usage;
  if (field === 'character_ids') return (row.character_ids || row.characters || []).map(value => Number(value?.id ?? value));
  return row[field];
}

// Only synchronous edit handlers may run inside the same SQLite transaction as
// these preconditions. Provider submission and other commands use idempotency.
function supports(req) {
  if (req.method === 'PUT' && /^\/(characters\/\d+\/(image|image-from-library)|scenes\/\d+\/prompt|storyboards\/\d+\/frame-prompts\/(first|key|last|panel|action))$/.test(req.path)) return true;
  if (['PUT', 'PATCH', 'DELETE'].includes(req.method) && /^\/(dramas|storyboards|characters|scenes|props|assets|character-library|scene-library|prop-library)\/\d+$/.test(req.path)) return true;
  if (req.method === 'PUT' && /^\/dramas\/\d+\/(canvas-layout|outline|progress)$/.test(req.path)) return true;
  if (req.method === 'PATCH' && /^\/dramas\/\d+\/collaboration\/episodes$/.test(req.path)) return true;
  if (req.method === 'PUT' && req.path === '/storyboards/reorder') return true;
  if (req.method === 'PATCH' && /^\/(episodes|storyboards)\/\d+\/generation-settings$/.test(req.path)) return true;
  return req.method === 'DELETE' && /^\/storyboards\/\d+\/generation-settings\/overrides$/.test(req.path);
}

function validate(db, dramaId, contract) {
  if (contract?.version !== 1 || !Array.isArray(contract.checks) || contract.checks.length > 1000) throw fail('编辑校验格式无效');
  for (const check of contract.checks) {
    if (!kinds.has(check.kind) || !Number.isSafeInteger(check.id) || check.id <= 0 || !check.fields || typeof check.fields !== 'object' || Array.isArray(check.fields)) throw fail('编辑对象无效');
    const resource = access.resource(db, check.kind, check.id);
    if (!resource || Number(resource.drama_id) !== Number(dramaId)) throw fail('编辑对象已删除或不属于当前项目', 404, 'ENTITY_DELETED');
    const row = entity(db, check.kind, check.id);
    if (!row) throw fail('编辑对象已删除', 404, 'ENTITY_DELETED');
    for (const [field, expected] of Object.entries(check.fields)) {
      const actual = fieldValue(db, check.kind, row, field);
      let matches;
      if (field === 'metadata' && expected && typeof expected === 'object' && !Array.isArray(expected)) {
        matches = Object.keys(expected).every(key => equal(expected[key], actual?.[key]));
      } else if (field === 'omni_prompt_document' && expected && !Object.hasOwn(expected, 'text')) {
        const { text, ...rest } = actual || {};
        matches = equal(expected, rest);
      } else matches = equal(expected, actual);
      if (!matches) throw Object.assign(fail('正在修改的内容已被更新，请检查该项内容后重试', 409, 'PROJECT_FIELD_CHANGED'), { details: { kind: check.kind, id: check.id, field } });
    }
  }
}

function acknowledgement(db, dramaId, contract) {
  const revision = db.prepare('SELECT revision FROM project_collaboration WHERE drama_id=?').get(dramaId)?.revision;
  const entities = contract.checks.flatMap(check => {
    const row = entity(db, check.kind, check.id);
    if (!row) return [];
    const fields = Object.fromEntries(Object.keys(check.fields).map(field => [field, fieldValue(db, check.kind, row, field) ?? null]));
    return [{ kind: check.kind, entity: { id: check.id, ...fields, updated_at: row.updated_at } }];
  });
  return { drama_id: dramaId, revision, entities };
}

module.exports = { supports, validate, acknowledgement, generationState };
