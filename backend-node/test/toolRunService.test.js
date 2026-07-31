const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const tools = require('../src/services/toolRunService');

function dbWithToolTables() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, type TEXT, deleted_at TEXT);
    CREATE TABLE tool_prompt_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, tool_type TEXT, name TEXT, language TEXT, content TEXT, is_builtin INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE tool_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, tool_type TEXT, batch_id TEXT, title TEXT, model TEXT, language TEXT, status TEXT, input_json TEXT, output_json TEXT, streamed_text TEXT, error_msg TEXT, task_id TEXT, continuation_count INTEGER, created_at TEXT, updated_at TEXT, completed_at TEXT, deleted_at TEXT);
    CREATE TABLE tool_run_assets (id INTEGER PRIMARY KEY AUTOINCREMENT, tool_run_id INTEGER, asset_id INTEGER, ordinal INTEGER, usage TEXT, snapshot_json TEXT, created_at TEXT);`);
  db.prepare("INSERT INTO assets (id,name,type) VALUES (1,'参考图','image')").run();
  return db;
}

test('tool run persists independent input, linked assets, output and soft-delete lifecycle', () => {
  const db = dbWithToolTables();
  const run = tools.create(db, { tool_type: 'script_analysis', title: '测试分析', input: { script: '第一场' }, assets: [{ asset_id: 1, usage: 'source' }] });
  assert.equal(run.input.script, '第一场');
  assert.equal(run.assets[0].id, 1);
  tools.set(db, run.id, { status: 'completed', output: { overview: { title: '测试' } } });
  assert.equal(tools.get(db, run.id).output.overview.title, '测试');
  tools.softDelete(db, run.id);
  assert.equal(tools.list(db).length, 0);
  assert.equal(tools.list(db, { deleted: true }).length, 1);
  assert.equal(tools.restore(db, run.id).id, run.id);
});

test('tool templates seed a read-only builtin and allow a separate custom template', () => {
  const db = dbWithToolTables();
  assert.equal(tools.templates(db, 'script_analysis')[0].is_builtin, 1);
  const custom = tools.createTemplate(db, { tool_type: 'script_analysis', name: '我的模板', content: '自定义拆解' });
  assert.equal(custom.is_builtin, 0);
  assert.throws(() => tools.updateTemplate(db, 1, { content: 'x' }), /只读/);
});
