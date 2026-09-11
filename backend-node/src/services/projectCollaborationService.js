'use strict';

const Y = require('yjs');
const access = require('./projectAccessService');

const TEXT_FIELDS = {
  dramas: ['description'],
  episodes: ['script_content', 'description'],
  storyboards: ['description', 'dialogue', 'narration', 'action', 'result', 'atmosphere', 'image_prompt', 'polished_prompt', 'video_prompt', 'universal_segment_text', 'layout_description'],
  characters: ['description', 'prompt', 'appearance', 'personality', 'polished_prompt'],
  scenes: ['description', 'prompt', 'polished_prompt', 'polished_prompt_single'],
  props: ['description', 'prompt'],
  assets: ['description'],
  character_libraries: ['description'],
  scene_libraries: ['description'],
  prop_libraries: ['description'],
};

function fail(message, status = 400, code = 'COLLABORATION_ERROR') {
  return Object.assign(new Error(message), { status, code });
}

function target(db, dramaId, kind, id, field) {
  if (!TEXT_FIELDS[kind]?.includes(field)) throw fail('不支持的协作字段');
  const resource = access.resource(db, kind, Number(id));
  if (!resource || Number(resource.drama_id) !== Number(dramaId)) throw fail('协作内容已删除或不属于当前项目', 404, 'ENTITY_DELETED');
  const columns = db.prepare(`PRAGMA table_info(${kind})`).all();
  if (!columns.some(column => column.name === field)) throw fail('不支持的协作字段');
  return db.prepare(`SELECT "${field}" value FROM "${kind}" WHERE id=? AND deleted_at IS NULL`).get(Number(id));
}

function loadDocument(db, dramaId, kind, id, field) {
  const row = target(db, dramaId, kind, id, field);
  const stored = db.prepare('SELECT * FROM project_text_documents WHERE drama_id=? AND entity_kind=? AND entity_id=? AND field=?').get(Number(dramaId), kind, Number(id), field);
  let doc = new Y.Doc();
  let epoch = stored?.epoch || 1;
  if (stored) Y.applyUpdate(doc, stored.state);
  const content = String(row.value || '');
  if (!stored || doc.getText('content').toString() !== content) {
    doc.destroy();
    doc = new Y.Doc();
    doc.getText('content').insert(0, content);
    if (stored) epoch++;
    saveDocument(db, dramaId, kind, id, field, doc, epoch);
  }
  return { doc, epoch };
}

function saveDocument(db, dramaId, kind, id, field, doc, epoch) {
  db.prepare(`INSERT INTO project_text_documents (drama_id,entity_kind,entity_id,field,epoch,state,updated_at)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(drama_id,entity_kind,entity_id,field)
    DO UPDATE SET epoch=excluded.epoch,state=excluded.state,updated_at=excluded.updated_at`)
    .run(Number(dramaId), kind, Number(id), field, epoch, Buffer.from(Y.encodeStateAsUpdate(doc)), new Date().toISOString());
}

function readText(db, dramaId, userId, input) {
  const permission = access.requireAccess(db, dramaId, userId);
  if (!permission.collaboration_enabled) throw fail('项目尚未启用协作', 409);
  const { doc, epoch } = loadDocument(db, dramaId, input.kind, input.id, input.field);
  try {
    let vector;
    if (input.state_vector && Number(input.epoch) === epoch) {
      if (typeof input.state_vector !== 'string' || input.state_vector.length > 200000) throw fail('状态向量无效');
      vector = Buffer.from(input.state_vector, 'base64');
      try { Y.decodeStateVector(vector); } catch (_) { throw fail('状态向量无效'); }
    }
    return { kind: input.kind, id: Number(input.id), field: input.field, epoch, state: Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString('base64'), state_vector: Buffer.from(Y.encodeStateVector(doc)).toString('base64'), text: doc.getText('content').toString() };
  } finally { doc.destroy(); }
}

function updateText(db, dramaId, userId, input) {
  const permission = access.requireAccess(db, dramaId, userId, 'edit');
  if (!permission.collaboration_enabled) throw fail('项目尚未启用协作', 409);
  if (typeof input.update !== 'string' || input.update.length > 2_000_000) throw fail('协作更新过大');
  return db.transaction(() => {
    const { doc, epoch } = loadDocument(db, dramaId, input.kind, input.id, input.field);
    try {
      if (Number(input.epoch) !== epoch) throw fail('内容已被替换，请保留草稿并重新载入', 409, 'DOCUMENT_REPLACED');
      try { Y.applyUpdate(doc, Buffer.from(input.update, 'base64')); }
      catch (_) { throw fail('协作更新无效'); }
      if ([...doc.share.keys()].some(key => key !== 'content') || !(doc.getText('content') instanceof Y.Text)) throw fail('协作更新包含未授权字段');
      const text = doc.getText('content').toString();
      if (text.length > 1_000_000) throw fail('文本超过长度限制');
      persistText(db, dramaId, input, text);
      saveDocument(db, dramaId, input.kind, input.id, input.field, doc, epoch);
      return { kind: input.kind, id: Number(input.id), field: input.field, epoch, state: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'), state_vector: Buffer.from(Y.encodeStateVector(doc)).toString('base64'), text };
    } finally { doc.destroy(); }
  })();
}

function persistText(db, dramaId, input, text) {
  target(db, dramaId, input.kind, input.id, input.field);
  db.prepare(`UPDATE "${input.kind}" SET "${input.field}"=?, updated_at=? WHERE id=? AND deleted_at IS NULL`).run(text, new Date().toISOString(), Number(input.id));
  if (input.kind === 'storyboards' && input.field === 'universal_segment_text') {
    const row = db.prepare('SELECT universal_segment_text, omni_prompt_document_json FROM storyboards WHERE id=?').get(Number(input.id));
    let promptDocument = {};
    try { promptDocument = JSON.parse(row.omni_prompt_document_json || '{}'); } catch (_) {}
    db.prepare('UPDATE storyboards SET omni_prompt_document_json=? WHERE id=?').run(JSON.stringify({ ...promptDocument, text: row.universal_segment_text }), Number(input.id));
  }
}

function ensureRevisionTriggers(db) {
  db.function('project_text_write_allowed', (kind, id, field, previous, next) => {
    const baseline = require('./billingRequestContext').current()?.project_text_baseline;
    const key = `${kind}:${id}:${field}`;
    if (!baseline || !baseline.has(key)) return 1;
    if (String(baseline.get(key) || '') !== String(previous || '')) return 0;
    baseline.set(key, next);
    return 1;
  });
  const scopes = {
    dramas: row => `${row}.id`,
    episodes: row => `${row}.drama_id`,
    characters: row => `${row}.drama_id`,
    scenes: row => `${row}.drama_id`,
    props: row => `${row}.drama_id`,
    assets: row => `${row}.drama_id`,
    character_libraries: row => `${row}.drama_id`,
    scene_libraries: row => `${row}.drama_id`,
    prop_libraries: row => `${row}.drama_id`,
    image_generations: row => `${row}.drama_id`,
    video_generations: row => `${row}.drama_id`,
    storyboards: row => `(SELECT drama_id FROM episodes WHERE id=${row}.episode_id)`,
    frame_prompts: row => `(SELECT e.drama_id FROM storyboards s JOIN episodes e ON e.id=s.episode_id WHERE s.id=${row}.storyboard_id)`,
    project_members: row => `${row}.drama_id`,
    project_episode_assignments: row => `(SELECT drama_id FROM episodes WHERE id=${row}.episode_id)`,
  };
  for (const [table, scope] of Object.entries(scopes)) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
    for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
      db.exec(`CREATE TRIGGER IF NOT EXISTS collab_${table}_${event.toLowerCase()} AFTER ${event} ON ${table}
        BEGIN UPDATE project_collaboration SET revision=revision+1 WHERE drama_id=${scope(event === 'DELETE' ? 'OLD' : 'NEW')}; END`);
    }
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
    for (const field of TEXT_FIELDS[table] || []) {
      if (!columns.has(field)) continue;
      db.exec(`CREATE TRIGGER IF NOT EXISTS collab_guard_${table}_${field} AFTER UPDATE OF "${field}" ON ${table}
        WHEN NEW."${field}" IS NOT OLD."${field}" AND project_text_write_allowed('${table}',OLD.id,'${field}',OLD."${field}",NEW."${field}")=0
        BEGIN
          INSERT INTO project_generated_suggestions (drama_id,entity_kind,entity_id,field,proposed_text,created_at)
          VALUES (${scope('OLD')},'${table}',OLD.id,'${field}',COALESCE(NEW."${field}",''),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
          UPDATE ${table} SET "${field}"=OLD."${field}" WHERE id=OLD.id;
        END`);
    }
  }
}

function captureTextBaseline(db, dramaId) {
  const baseline = new Map();
  for (const [kind, fields] of Object.entries(TEXT_FIELDS)) {
    const columns = new Set(db.prepare(`PRAGMA table_info(${kind})`).all().map(column => column.name));
    const available = fields.filter(field => columns.has(field));
    if (!available.length) continue;
    const scope = kind === 'dramas' ? 'id=?' : kind === 'storyboards' ? 'episode_id IN (SELECT id FROM episodes WHERE drama_id=? AND deleted_at IS NULL)' : 'drama_id=?';
    for (const row of db.prepare(`SELECT id,${available.map(field => `"${field}"`).join(',')} FROM ${kind} WHERE ${scope} AND deleted_at IS NULL`).all(Number(dramaId))) {
      for (const field of available) baseline.set(`${kind}:${row.id}:${field}`, row[field]);
    }
  }
  return baseline;
}

module.exports = { TEXT_FIELDS, readText, updateText, persistText, ensureRevisionTriggers, captureTextBaseline };
