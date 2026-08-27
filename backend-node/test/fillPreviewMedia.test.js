const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { enumerateMediaReferences } = require('../tools/fill-preview-media.js');

// The carousel regression of 2026-08-27: homepage videos uploaded before the
// archive ledger existed have no row there. Enumeration therefore scans every
// text column for /static/ references instead of trusting the ledger alone.
test('dual-source enumeration: ledger plus /static/ URLs and bare JSON arrays', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE media_archive_records (
      local_path TEXT, oss_key TEXT, archive_status TEXT, updated_at TEXT);
    INSERT INTO media_archive_records VALUES
      ('library/videos/hot.mp4', 'k', 'oss_synced', '2026-08-20');
    CREATE TABLE homepage_default_video_resources (id INTEGER PRIMARY KEY, video_url TEXT);
    INSERT INTO homepage_default_video_resources VALUES
      (1, '/static/library/videos/vg_63_4afe75bc.mp4');
    -- The carousel regression of 2026-08-27: global_settings stores BARE
    -- relative paths without the /static prefix.
    CREATE TABLE global_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO global_settings VALUES ('homepage_carousel',
      '["library/videos/vg_64_f36d4152.mp4","library/videos/vg_63_4afe75bc.mp4","library/videos/vg_62_9fe88acc.mp4"]');
    CREATE TABLE projects (title TEXT, payload TEXT);
    INSERT INTO projects VALUES ('无静态路径的普通项目', '其他文本 {"nested": true}');
  `);

  const rels = enumerateMediaReferences(db).map((c) => c.rel).sort();

  assert.deepEqual(rels, [
    'library/videos/hot.mp4',
    'library/videos/vg_62_9fe88acc.mp4',
    'library/videos/vg_63_4afe75bc.mp4',
    'library/videos/vg_64_f36d4152.mp4',
  ]);
});

test('enumeration ignores tables/columns that fail or contain no path-like tails', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE notes (body TEXT);
    INSERT INTO notes VALUES ('文档提到 /static 概念但没有具体文件名'), ('another');
  `);
  const rels = enumerateMediaReferences(db);
  assert.deepEqual(rels, []);
});
