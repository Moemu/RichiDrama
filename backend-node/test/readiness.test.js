const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readinessStatus, revisionInfo } = require('../src/app');

test('readiness requires both SQLite and the built frontend', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richidrama-ready-'));
  const db = { prepare: () => ({ get: () => ({ ok: 1 }) }) };
  try {
    assert.equal(readinessStatus(db, root).status, 'not_ready');
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>');
    assert.deepEqual(readinessStatus(db, root).checks, { database: true, frontend: true });
    assert.equal(readinessStatus(db, root).status, 'ready');
    assert.equal(readinessStatus({ prepare: () => { throw new Error('closed'); } }, root).status, 'not_ready');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('revision is optional and comes from APP_REVISION', () => {
  const prior = process.env.APP_REVISION;
  try {
    delete process.env.APP_REVISION;
    assert.deepEqual(revisionInfo(), {});
    process.env.APP_REVISION = 'abc123';
    assert.deepEqual(revisionInfo(), { revision: 'abc123' });
  } finally {
    if (prior === undefined) delete process.env.APP_REVISION;
    else process.env.APP_REVISION = prior;
  }
});
