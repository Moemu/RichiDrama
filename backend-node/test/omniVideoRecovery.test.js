const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const omni = require('../src/services/omniVideoService');

test('SD2 recovery marks an unrecoverable waiting job invalid instead of retrying forever', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-mini-drama-sd2-recovery-'));
  try {
    const db = getDb({ path: path.join(root, 'test.db'), type: 'sqlite' });
    runMigrationsAndEnsure(db);
    const now = new Date().toISOString();
    const generation = db.prepare(`INSERT INTO video_generations
      (owner_user_id, provider, model, status, created_at, updated_at)
      VALUES (1, 'volces', 'seedance', 'sd2_waiting', ?, ?)`)
      .run(now, now);
    db.prepare(`INSERT INTO omni_video_jobs
      (video_generation_id, owner_user_id, prompt, model_requested, model_resolved, request_snapshot_json, created_at, updated_at)
      VALUES (?, 1, 'test', 'seedance', 'seedance', '{}', ?, ?)`)
      .run(generation.lastInsertRowid, now, now);

    omni.resumeSd2WaitingGenerations(db, { warn() {} });

    const row = db.prepare('SELECT status, error_msg FROM video_generations WHERE id=?').get(generation.lastInsertRowid);
    assert.equal(row.status, 'invalid');
    assert.match(row.error_msg, /缺少可恢复的请求快照/);
  } finally {
    closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
