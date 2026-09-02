const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const omni = require('../src/services/omniVideoService');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY, owner_user_id INTEGER, drama_id INTEGER, storyboard_id INTEGER,
      billing_authorization_id TEXT, provider TEXT, prompt TEXT, model TEXT, duration REAL,
      aspect_ratio TEXT, resolution TEXT, upscale_resolution TEXT, target_fps INTEGER,
      video_url TEXT, local_path TEXT, poster_local_path TEXT, output_width INTEGER,
      output_height INTEGER, output_resolution TEXT, output_fps REAL, output_duration_ms INTEGER,
      upscale_status TEXT, interpolation_status TEXT, archive_status TEXT, archive_error TEXT,
      status TEXT, task_id TEXT, provider_task_id TEXT, error_msg TEXT, created_at TEXT,
      updated_at TEXT, completed_at TEXT, deleted_at TEXT
    );
    CREATE TABLE async_tasks (
      id TEXT PRIMARY KEY, status TEXT, progress INTEGER, message TEXT, updated_at TEXT, deleted_at TEXT
    );
    CREATE TABLE omni_video_jobs (
      id INTEGER PRIMARY KEY, video_generation_id INTEGER, owner_user_id INTEGER, sequence_id INTEGER,
      shot_id INTEGER, storyboard_id INTEGER, prompt TEXT, negative_prompt TEXT, model_requested TEXT,
      model_resolved TEXT, request_snapshot_json TEXT, input_summary_json TEXT,
      capability_snapshot_json TEXT, audio_strategy TEXT
    );
    CREATE TABLE omni_video_job_assets (
      id INTEGER PRIMARY KEY, omni_job_id INTEGER, asset_id INTEGER, ordinal INTEGER, alias TEXT,
      media_type TEXT, role TEXT, usage TEXT, send_to_model INTEGER, snapshot_json TEXT
    );
    CREATE TABLE billing_usage_logs (
      id TEXT PRIMARY KEY, authorization_id TEXT, charged_micro INTEGER, usage_json TEXT,
      snapshot_json TEXT, provider_request_id TEXT, created_at TEXT
    );
  `);
  const now = '2026-09-02T01:02:03.000Z';
  db.prepare(`INSERT INTO video_generations (
    id,owner_user_id,drama_id,storyboard_id,billing_authorization_id,provider,prompt,model,duration,
    aspect_ratio,resolution,upscale_resolution,target_fps,video_url,local_path,output_width,output_height,
    output_resolution,output_fps,output_duration_ms,status,task_id,provider_task_id,created_at,updated_at,completed_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    41, 7, 2, 9, 'auth-41', 'volcengine', '加工后的提示词 @图片1 硬约束', 'seedance-2-0', 10,
    '16:9', '720p', '1080p', 60, '/static/videos/41.mp4', 'videos/41.mp4', 1920, 1080,
    '1080p', 60, 10000, 'completed', 'task-41', 'provider-41', now, now, now,
  );
  db.prepare('INSERT INTO async_tasks VALUES (?,?,?,?,?,NULL)').run('task-41', 'completed', 100, '完成', now);
  db.prepare(`INSERT INTO omni_video_jobs (
    id,video_generation_id,owner_user_id,storyboard_id,prompt,model_requested,model_resolved,
    request_snapshot_json,input_summary_json,capability_snapshot_json,audio_strategy
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    51, 41, 7, 9, '加工后的提示词 @图片1 硬约束', 'seedance-2-0', 'seedance-2-0',
    JSON.stringify({ original_prompt: '用户输入的原始提示词\n\n【@引用素材硬约束】\n1. @图片1 必须出现', prompt: '加工后的提示词 @图片1 硬约束', duration: 10, aspect_ratio: '16:9', resolution: '720p', upscale_resolution: '1080p', target_fps: 60, creation_mode: 'multi_reference', assets: [] }),
    JSON.stringify({ image: 1 }), JSON.stringify({ supports: { image_reference: true } }), 'reference_only',
  );
  db.prepare('INSERT INTO omni_video_job_assets VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    61, 51, 71, 1, '图片1', 'image', 'reference', 'reference', 1,
    JSON.stringify({ alias: '图片1', type: 'image', local_path: 'assets/picture-1.jpg' }),
  );
  db.prepare('INSERT INTO billing_usage_logs VALUES (?,?,?,?,?,?,?)').run(
    'usage-41', 'auth-41', 123400, JSON.stringify({ second: 10 }), JSON.stringify({ model: 'seedance-2-0' }), 'request-41', now,
  );
  return db;
}

test('generation history detail separates the original and provider prompts', () => {
  const db = createDb();
  const detail = omni.generationHistoryDetail(db, 41, { id: 7, role: 'user' });
  assert.equal(detail.original_prompt, '用户输入的原始提示词');
  assert.equal(detail.provider_prompt, '加工后的提示词 @图片1 硬约束');
  assert.equal(detail.request.resolution, '720p');
  assert.equal(detail.output.resolution, '1080p');
  assert.equal(detail.output.width, 1920);
  assert.equal(detail.billing.actual_points, 12.34);
  assert.deepEqual(detail.billing.usage, { second: 10 });
  assert.equal(detail.assets[0].snapshot.source, 'local');
});

test('generation history detail rejects a different owner', () => {
  const db = createDb();
  assert.throws(() => omni.generationHistoryDetail(db, 41, { id: 8, role: 'user' }), /无权查看/);
});

test('generation history detail supports a legacy generation without an omni snapshot', () => {
  const db = createDb();
  db.prepare(`INSERT INTO video_generations (id,owner_user_id,prompt,model,status,created_at,updated_at)
    VALUES (42,7,'旧记录提示词','legacy-model','failed',?,?)`).run('2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
  const detail = omni.generationHistoryDetail(db, 42, { id: 7, role: 'user' });
  assert.equal(detail.omni_job_id, null);
  assert.equal(detail.original_prompt, '旧记录提示词');
  assert.equal(detail.provider_prompt, '旧记录提示词');
  assert.equal(detail.billing.status, 'not_charged');
});
