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
