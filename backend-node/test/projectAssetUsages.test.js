const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { decorateMany, usages } = require('../src/services/projectAssetService');

test('asset pages scan each project once while preserving reference types and scope', t => {
  const statements = [];
  const db = new Database(':memory:', { verbose: sql => statements.push(sql) });
  t.after(() => db.close());
  db.exec(`CREATE TABLE project_collaboration (drama_id INTEGER);
    CREATE TABLE assets (id INTEGER PRIMARY KEY,drama_id INTEGER,local_path TEXT,deleted_at TEXT);
    CREATE TABLE episodes (id INTEGER PRIMARY KEY,drama_id INTEGER,title TEXT,deleted_at TEXT);
    CREATE TABLE storyboards (id INTEGER PRIMARY KEY,episode_id INTEGER,omni_asset_ids TEXT,omni_first_frame_asset_id INTEGER,omni_last_frame_asset_id INTEGER,local_path TEXT,image_url TEXT,deleted_at TEXT);
    CREATE TABLE characters (id INTEGER PRIMARY KEY,drama_id INTEGER,local_path TEXT,deleted_at TEXT);
    CREATE TABLE scenes (id INTEGER PRIMARY KEY,drama_id INTEGER,image_url TEXT,deleted_at TEXT);
    CREATE TABLE props (id INTEGER PRIMARY KEY,drama_id INTEGER,local_path TEXT,deleted_at TEXT);
    CREATE TABLE asset_resource_links (drama_id INTEGER,asset_id INTEGER,resource_type TEXT,resource_id INTEGER,status TEXT);
    CREATE TABLE project_asset_copies (asset_id INTEGER,source_asset_id INTEGER,added_by INTEGER);
    CREATE TABLE users (id INTEGER PRIMARY KEY,display_name TEXT);
    INSERT INTO episodes VALUES (1,1,'第一集',NULL),(2,2,'其他项目',NULL);
    INSERT INTO storyboards VALUES (1,1,'[1,{"asset_id":2}]',1,2,'shared.png','/static/shared.png',NULL),(2,2,'[51]',NULL,NULL,'shared.png',NULL,NULL);
    INSERT INTO characters VALUES (1,1,'shared.png',NULL);
    INSERT INTO scenes VALUES (1,1,'/static/shared.png',NULL);
    INSERT INTO props VALUES (1,1,'shared.png',NULL);
    INSERT INTO asset_resource_links VALUES (1,1,'character_libraries',10,'active'),(1,1,'props',2,'inactive');
    INSERT INTO users VALUES (1,'添加者');
    INSERT INTO project_asset_copies VALUES (1,100,1);`);
  const insert = db.prepare('INSERT INTO assets VALUES (?,?,?,NULL)');
  for (let id = 1; id <= 50; id++) insert.run(id, 1, 'shared.png');
  insert.run(51, 2, 'shared.png'); insert.run(52, null, 'shared.png');
  const items = db.prepare('SELECT * FROM assets ORDER BY id').all();
  statements.length = 0;
  const one = decorateMany(db, items.slice(0, 1));
  const oneQueries = statements.length;
  statements.length = 0;
  const page = decorateMany(db, items.slice(0, 50));
  assert.equal(statements.length, oneQueries, 'query count must not grow with page size');
  assert.equal(statements.filter(sql => /FROM storyboards/.test(sql)).length, 1);
  assert.deepEqual(page[0], one[0]);
  assert.deepEqual(page[0].usages, [
    { episode_id: 1, episode_title: '第一集', storyboard_id: 1 },
    { resource_type: 'characters', resource_id: 1 },
    { resource_type: 'scenes', resource_id: 1 },
    { resource_type: 'props', resource_id: 1 },
    { resource_type: 'character_libraries', resource_id: 10 },
  ]);
  assert.deepEqual(page[0].project_source, { source_asset_id: 100, added_by: 1, added_by_name: '添加者' });
  assert.deepEqual(usages(db, 1), page[0].usages);
  const scoped = decorateMany(db, items);
  assert.deepEqual(scoped[50].usages, [{ episode_id: 2, episode_title: '其他项目', storyboard_id: 2 }]);
  assert.equal(scoped[51], items[51], 'personal media must retain its existing response shape');
});
