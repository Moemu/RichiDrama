const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const access = require('../src/services/projectAccessService');

test('project list decoration preserves permissions and members with bounded queries', t => {
  const queries = [];
  const db = new Database(':memory:', { verbose: sql => queries.push(sql) });
  t.after(() => db.close());
  db.exec(`CREATE TABLE dramas(id INTEGER PRIMARY KEY,owner_user_id INTEGER,deleted_at TEXT);
    CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,display_name TEXT);
    CREATE TABLE project_collaboration(drama_id INTEGER,revision INTEGER,disabled_at TEXT);
    CREATE TABLE project_members(drama_id INTEGER,user_id INTEGER,role TEXT,joined_at TEXT);
    INSERT INTO users VALUES(1,'owner','属主'),(2,'editor','编辑者'),(3,'viewer','查看者');`);
  const rows = Array.from({ length: 50 }, (_, index) => ({ id: index + 1, title: `项目${index + 1}` }));
  for (const row of rows) {
    db.prepare('INSERT INTO dramas VALUES(?,1,NULL)').run(row.id);
    if (row.id % 2) {
      db.prepare('INSERT INTO project_collaboration(drama_id,revision) VALUES(?,?)').run(row.id, row.id * 2);
      db.prepare("INSERT INTO project_members VALUES(?,2,'editor','2026-01-01'),(?,3,'viewer','2026-01-02')").run(row.id, row.id);
    }
  }
  for (const userId of [1, 2, 3]) {
    const expected = rows.map(row => access.decorate(db, { ...row }, userId));
    queries.length = 0;
    assert.deepEqual(access.decorateMany(db, rows, userId), expected);
    assert.equal(queries.length, 3);
  }
});
