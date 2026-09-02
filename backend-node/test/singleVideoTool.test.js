const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { getDb, closeDb } = require('../src/db')
const { runMigrationsAndEnsure } = require('../src/db/migrate')
const auth = require('../src/services/authService')
const assetService = require('../src/services/assetService')
const dramaService = require('../src/services/dramaService')
const omniVideoService = require('../src/services/omniVideoService')
const videoService = require('../src/services/videoService')

function fixture(name) {
  const dbPath = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}.db`)
  const db = getDb({ path: dbPath, type: 'sqlite' })
  runMigrationsAndEnsure(db)
  const log = { info() {}, warn() {}, error() {} }
  const user = auth.ensureBootstrapAdmin(db, log)
  return { db, dbPath, log, user }
}

function cleanup(dbPath) {
  closeDb()
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix) } catch (_) {} }
}

function responseRecorder() {
  return { statusCode: null, body: null, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
}

test('single-video route permits only the explicit projectless tool context', () => {
  const { db, dbPath, log, user } = fixture('single-video-route')
  const originalCreate = omniVideoService.create
  try {
    omniVideoService.create = (_db, _log, body) => body
    const routes = require('../src/routes/omniVideo')(db, log, {})

    const standalone = responseRecorder()
    routes.create({ auth: user, body: { source_context: 'single_video_tool', prompt: 'test' } }, standalone)
    assert.equal(standalone.statusCode, 201)
    assert.equal(standalone.body.data.source_context, 'single_video_tool')

    const normal = responseRecorder()
    routes.create({ auth: user, body: { prompt: 'test' } }, normal)
    assert.equal(normal.statusCode, 400)
    assert.match(normal.body.error.message, /计费归属项目/)

    const bound = responseRecorder()
    routes.create({ auth: user, body: { source_context: 'single_video_tool', storyboard_id: 9, prompt: 'test' } }, bound)
    assert.equal(bound.statusCode, 400)
    assert.match(bound.body.error.message, /不能绑定项目/)

    const project = dramaService.createDrama(db, log, { title: '不应绑定', owner_user_id: user.id })
    const projectBound = responseRecorder()
    routes.create({ auth: user, body: { source_context: 'single_video_tool', drama_id: project.id, prompt: 'test' } }, projectBound)
    assert.equal(projectBound.statusCode, 400)
    assert.match(projectBound.body.error.message, /不能绑定项目/)
  } finally {
    omniVideoService.create = originalCreate
    cleanup(dbPath)
  }
})

test('single-video history excludes storyboard and multi-shot jobs', () => {
  const { db, dbPath, user } = fixture('single-video-history')
  try {
    const now = new Date().toISOString()
    const addVideo = db.prepare(`INSERT INTO video_generations
      (id, drama_id, storyboard_id, owner_user_id, prompt, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'completed', ?, ?)`)
    addVideo.run(1, 0, null, user.id, 'legacy tool', now, now)
    addVideo.run(2, 7, 12, user.id, 'storyboard', now, now)
    addVideo.run(3, 0, null, user.id, 'new tool', now, now)
    addVideo.run(4, 7, null, user.id, 'multi shot', now, now)
    addVideo.run(5, 7, null, user.id, 'project video', now, now)
    const addJob = db.prepare(`INSERT INTO omni_video_jobs
      (video_generation_id, owner_user_id, prompt, sequence_id, shot_id, storyboard_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    addJob.run(3, user.id, 'new tool', null, null, null, now, now)
    addJob.run(4, user.id, 'multi shot', 20, 21, null, now, now)

    assert.deepEqual(omniVideoService.list(db, { owner_user_id: user.id, tool_only: 1 }).map((item) => item.video_generation_id), [3])
    assert.deepEqual(videoService.list(db, { owner_user_id: user.id, tool_only: 1, page_size: 30 }).items.map((item) => item.id).sort((a, b) => a - b), [1, 3])
  } finally { cleanup(dbPath) }
})

test('all asset scope includes personal and project assets owned by the user', () => {
  const { db, dbPath, log, user } = fixture('single-video-assets')
  try {
    const project = dramaService.createDrama(db, log, { title: '素材项目', owner_user_id: user.id })
    assetService.create(db, log, { owner_user_id: user.id, name: '个人图片', type: 'image' })
    assetService.create(db, log, { owner_user_id: user.id, drama_id: project.id, name: '项目视频', type: 'video' })
    assert.deepEqual(assetService.list(db, { owner_user_id: user.id, scope: 'all', page_size: 100 }).items.map((item) => item.name).sort(), ['个人图片', '项目视频'])
  } finally { cleanup(dbPath) }
})
