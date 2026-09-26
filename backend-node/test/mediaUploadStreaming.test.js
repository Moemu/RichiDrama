const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const { spawnSync } = require('node:child_process')
const express = require('express')
const Database = require('better-sqlite3')
const { runMigrationsAndEnsure } = require('../src/db/migrate')
const { setupRouter } = require('../src/routes')
const auth = require('../src/services/authService')
const mediaAsset = require('../src/services/mediaAssetService')
const uploadService = require('../src/services/uploadService')

const log = { info() {}, warn() {}, error() {}, debug() {}, infow() {}, warnw() {}, errorw() {} }

function makeVideo(file, duration = 2) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=blue:s=640x360:r=24:d=${duration}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${duration}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
}

function multipart(file, fields) {
  const boundary = `----streamtest${Date.now()}`
  const buffer = fs.readFileSync(file)
  const head = Object.entries(fields || {}).map(([name, value]) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`).join('')
  const fileHead = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(file)}"\r\nContent-Type: video/mp4\r\n\r\n`
  return { body: Buffer.concat([Buffer.from(head + fileHead, 'utf8'), buffer, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')]), boundary }
}

function tempDirEntries(dir) {
  try { return fs.readdirSync(dir) } catch (_) { return [] }
}

test('media upload streams through disk temp, renames into storage, and leaves no temp residue', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richidrama-upload-stream-'))
  const storage = path.join(root, 'storage')
  fs.mkdirSync(storage, { recursive: true })
  const video = path.join(root, 'ep.mp4')
  makeVideo(video)
  const db = new Database(':memory:')
  const out = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {}
  try { runMigrationsAndEnsure(db) } finally { console.log = out; console.warn = warn }
  const admin = auth.ensureBootstrapAdmin(db, log)
  const user = auth.createUser(db, { username: `up-${Date.now()}`, password: 'test-password' }, admin.id)
  const cfg = { storage: { type: 'local', local_path: storage }, server: {}, payments: { enabled: false }, vendor_lock: { enabled: false } }
  const app = express(); app.use(express.json()); app.use('/api/v1', setupRouter(cfg, db, log))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}/api/v1`
  t.after(() => { server.close(); db.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const login = await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user.username, password: 'test-password' }) })).json()
  const token = login.data.token
  async function upload(file) {
    const part = multipart(file, {})
    const res = await fetch(`${base}/media/upload`, { method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${part.boundary}`, 'x-lmd-session': token }, body: part.body })
    return { status: res.status, json: await res.json() }
  }
  const tempDir = mediaAsset.uploadTempDir(storage)
  const first = await upload(video)
  assert.equal(first.status, 201, JSON.stringify(first.json))
  const asset = first.json.data.asset
  assert.match(asset.local_path, /(^|\/)videos\/.+\.mp4$/, `无项目上传应落在 <前缀>/videos/，实际 ${asset.local_path}`)
  assert.ok(fs.existsSync(path.join(storage, asset.local_path)), '成片必须已转正到 storage')
  assert.deepEqual(tempDirEntries(tempDir), [], '成功后临时目录必须为空（rename 转正 + finally 兜底）')
  // 去重命中：复用既有素材，同样不留临时文件
  const second = await upload(video)
  assert.equal(second.status, 201)
  assert.equal(second.json.data.asset.deduplicated, true)
  assert.equal(second.json.data.asset.id, asset.id)
  assert.deepEqual(tempDirEntries(tempDir), [])
  // 伪装扩展名（文本冒充 mp4）：签名校验拒绝，且临时文件被 finally 清掉
  const fake = path.join(root, 'fake.mp4')
  fs.writeFileSync(fake, 'this is definitely not an mp4 file at all')
  const rejected = await upload(fake)
  assert.equal(rejected.status, 400)
  assert.match(rejected.json.error.message, /媒体类型不匹配/)
  assert.deepEqual(tempDirEntries(tempDir), [], '校验失败也不能残留临时文件')
})

test('upload temp sweep removes only stale files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richidrama-upload-sweep-'))
  try {
    const tempDir = mediaAsset.uploadTempDir(root)
    fs.mkdirSync(tempDir, { recursive: true })
    const stale = path.join(tempDir, 'stale.mp4'); fs.writeFileSync(stale, 'x')
    const fresh = path.join(tempDir, 'fresh.mp4'); fs.writeFileSync(fresh, 'x')
    const old = new Date(Date.now() - 7 * 3600_000)
    fs.utimesSync(stale, old, old)
    assert.deepEqual(mediaAsset.sweepUploadTemp(root, log), { removed: 1 })
    assert.ok(!fs.existsSync(stale) && fs.existsSync(fresh))
    assert.deepEqual(mediaAsset.sweepUploadTemp(root, log, undefined, Date.now() + 8 * 3600_000).removed, 1, '进行中请求（mtime 未超时）不能被清扫')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('uploadFileFromPath renames the temp file into the category layout', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richidrama-upload-rename-'))
  try {
    const tempDir = mediaAsset.uploadTempDir(root)
    fs.mkdirSync(tempDir, { recursive: true })
    const source = path.join(tempDir, 'tmp-name.mp4')
    fs.writeFileSync(source, 'payload')
    const result = uploadService.uploadFileFromPath(root, '', log, source, '剧集 1.mp4', 'video/mp4', 'videos', null)
    assert.match(result.local_path, /^videos\/\d{8}T[\w-]+_[a-f0-9-]{36}\.mp4$/)
    assert.equal(result.url, `/static/${result.local_path}`)
    assert.ok(fs.existsSync(path.join(root, result.local_path)))
    assert.ok(!fs.existsSync(source), 'rename 转正后临时文件不应存在')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('media limits stay single-sourced for multer and validation', () => {
  assert.equal(mediaAsset.LIMITS.video, 2048)
  assert.equal(mediaAsset.limits().files.video.max_mb, 2048, '/upload-limits 下发同一来源，前端提示自动跟随')
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'upload.js'), 'utf8')
  assert.match(routeSource, /limits: \{ fileSize: mediaAsset\.LIMITS\.video \* 1024 \* 1024 \}/, 'multer 上限必须引用同一 LIMITS 来源')
  assert.doesNotMatch(routeSource, /50 \* 1024 \* 1024/, '媒体上传不得再各自硬编码 50MB')
})
