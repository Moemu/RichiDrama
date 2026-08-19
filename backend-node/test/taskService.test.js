const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const taskService = require('../src/services/taskService');
const { resumeProcessingVideoGenerations } = require('../src/services/videoService');

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE async_tasks (
      id TEXT PRIMARY KEY,
      type TEXT,
      status TEXT,
      progress INTEGER DEFAULT 0,
      message TEXT,
      error TEXT,
      result TEXT,
      resource_id TEXT,
      created_at TEXT,
      updated_at TEXT,
      completed_at TEXT,
      deleted_at TEXT
    );
  `);
  return db;
}

function addVideoGenerationsTable(db) {
  db.exec(`
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY,
      task_id TEXT,
      provider_task_id TEXT,
      status TEXT,
      error_msg TEXT,
      updated_at TEXT,
      deleted_at TEXT,
      billing_authorization_id TEXT,
      owner_user_id INTEGER
    );
    CREATE TABLE omni_video_jobs (
      id INTEGER PRIMARY KEY,
      video_generation_id INTEGER,
      request_snapshot_json TEXT
    );
  `);
}

describe('taskService.failOrphanedAsyncTasksOnStartup', () => {
  it('marks pending and processing tasks as failed on startup', () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run('task-pending', 'background_extraction', 'pending', '42', now, now);
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run('task-processing', 'background_extraction', 'processing', '42', now, now);
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, 100, '', ?, ?, ?, ?)`
    ).run('task-done', 'background_extraction', 'completed', '42', now, now, now);

    const count = taskService.failOrphanedAsyncTasksOnStartup(db, { warn() {}, info() {} });
    assert.equal(count, 2);

    const pending = taskService.getTask(db, 'task-pending');
    const processing = taskService.getTask(db, 'task-processing');
    const done = taskService.getTask(db, 'task-done');

    assert.equal(pending.status, 'failed');
    assert.equal(processing.status, 'failed');
    assert.equal(pending.error, taskService.ORPHAN_ASYNC_TASK_MSG);
    assert.equal(done.status, 'completed');
  });

  it('cancelTask marks active task as failed', () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run('task-active', 'background_extraction', 'processing', '42', now, now);

    const result = taskService.cancelTask(db, { info() {} }, 'task-active');
    assert.equal(result.ok, true);
    const task = taskService.getTask(db, 'task-active');
    assert.equal(task.status, 'failed');
    assert.equal(task.error, taskService.USER_CANCEL_TASK_MSG);
  });

  it('preserves processing async tasks that belong to a recoverable video generation', () => {
    const db = createTestDb();
    addVideoGenerationsTable(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run('video-task', 'video_generation', 'processing', '99', now, now);
    db.prepare('INSERT INTO video_generations (id, task_id, provider_task_id, status) VALUES (?, ?, ?, ?)')
      .run(1, 'video-task', 'provider-123', 'processing');

    const count = taskService.failOrphanedAsyncTasksOnStartup(db, { warn() {}, info() {} });
    assert.equal(count, 0);
    assert.equal(taskService.getTask(db, 'video-task').status, 'processing');
  });

  it('preserves async tasks while a locally archived source is being interpolated', () => {
    const db = createTestDb();
    addVideoGenerationsTable(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 85, '', ?, ?, ?)`
    ).run('interpolation-task', 'video_generation', 'processing', '12', now, now);
    db.prepare('INSERT INTO video_generations (id, task_id, provider_task_id, status) VALUES (?, ?, ?, ?)')
      .run(12, 'interpolation-task', 'generation-provider-task', 'interpolating');

    const count = taskService.failOrphanedAsyncTasksOnStartup(db, { warn() {}, info() {} });
    assert.equal(count, 0);
    assert.equal(taskService.getTask(db, 'interpolation-task').status, 'processing');
  });

  it('marks interrupted videos without a provider task id as retryable', () => {
    const db = createTestDb();
    addVideoGenerationsTable(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run('retry-task', 'video_generation', 'processing', '12', now, now);
    db.prepare('INSERT INTO video_generations (id, task_id, status) VALUES (?, ?, ?)')
      .run(2, 'retry-task', 'processing');

    resumeProcessingVideoGenerations(db, { warn() {}, info() {}, error() {} });

    assert.equal(db.prepare('SELECT status FROM video_generations WHERE id = 2').get().status, 'retryable');
    assert.equal(taskService.getTask(db, 'retry-task').status, 'failed');
  });

  it('marks historical empty omni jobs as invalid instead of retryable', () => {
    const db = createTestDb();
    addVideoGenerationsTable(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run('empty-task', 'video_generation', 'processing', '13', now, now);
    db.prepare('INSERT INTO video_generations (id, task_id, status) VALUES (?, ?, ?)')
      .run(3, 'empty-task', 'processing');
    db.prepare('INSERT INTO omni_video_jobs (id, video_generation_id, request_snapshot_json) VALUES (?, ?, ?)')
      .run(1, 3, JSON.stringify({ prompt: '', assets: [] }));

    resumeProcessingVideoGenerations(db, { warn() {}, info() {}, error() {} });

    assert.equal(db.prepare('SELECT status FROM video_generations WHERE id = 3').get().status, 'invalid');
  });
});
