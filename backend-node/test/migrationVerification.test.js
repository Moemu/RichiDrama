const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { verifyDatabase } = require('../tools/verify-migrations');

test('migration verification upgrades an empty database twice', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richidrama-migrate-'));
  const target = path.join(root, 'data', 'test.db');
  try {
    const result = verifyDatabase(target);
    assert.equal(result.integrity, 'ok');
    assert.equal(result.passes, 2);
    const db = new Database(target, { readonly: true });
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get());
    db.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('migration verification fails for a corrupt snapshot', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richidrama-corrupt-'));
  const target = path.join(root, 'corrupt.db');
  try {
    fs.writeFileSync(target, 'not a sqlite database');
    assert.throws(() => verifyDatabase(target));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('storyboard identity migration is restart-safe and links legacy replacement history', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richidrama-storyboard-identity-'));
  const target = path.join(root, 'data', 'test.db');
  try {
    verifyDatabase(target);
    let db = new Database(target);
    const now = '2026-08-01T00:00:00.000Z';
    const later = '2026-08-02T00:00:00.000Z';
    db.prepare('INSERT INTO episodes (id, drama_id, episode_number, created_at, updated_at) VALUES (900, 1, 1, ?, ?)').run(now, now);
    db.prepare(`INSERT INTO storyboards (id, episode_id, storyboard_number, sort_order, title, created_at, updated_at, deleted_at, storyboard_uid, position)
      VALUES (901, 900, 1, 0, '旧镜头', ?, ?, ?, NULL, NULL), (902, 900, 1, 0, '新镜头', ?, ?, NULL, NULL, NULL)`)
      .run(now, later, later, later, later);
    db.prepare("DELETE FROM schema_migration_markers WHERE name='storyboard_identity_position_v1'").run();
    db.close();

    verifyDatabase(target);
    db = new Database(target, { readonly: true });
    const first = db.prepare('SELECT id, storyboard_uid, position FROM storyboards WHERE id IN (901,902) ORDER BY id').all();
    assert.ok(first[0].storyboard_uid);
    assert.equal(first[0].storyboard_uid, first[1].storyboard_uid);
    assert.equal(first[1].position, 0);
    db.close();

    verifyDatabase(target);
    db = new Database(target, { readonly: true });
    const second = db.prepare('SELECT id, storyboard_uid, position FROM storyboards WHERE id IN (901,902) ORDER BY id').all();
    assert.deepEqual(second, first);
    db.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
