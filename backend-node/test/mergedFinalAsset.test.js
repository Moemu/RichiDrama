const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const Database = require('better-sqlite3')
const { runMigrationsAndEnsure } = require('../src/db/migrate')
const auth = require('../src/services/authService')
const dramaService = require('../src/services/dramaService')
const merges = require('../src/services/videoMergeService')

const log = { info() {}, warn() {}, error() {}, debug() {}, infow() {}, warnw() {}, errorw() {} }

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richidrama-merge-asset-'))
  const storage = path.join(root, 'storage')
  fs.mkdirSync(path.join(storage, 'videos', 'merged'), { recursive: true })
  const source = path.join(storage, 'videos', 'merged', 'merged_test.mp4')
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=24:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
  const db = new Database(':memory:')
  const out = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {}
  try { runMigrationsAndEnsure(db) } finally { console.log = out; console.warn = warn }
  const admin = auth.ensureBootstrapAdmin(db, log)
  const project = dramaService.createDrama(db, log, { title: '成片登记项目', owner_user_id: admin.id })
  const episode = db.prepare("INSERT INTO episodes(drama_id,episode_number,title,status,created_at,updated_at) VALUES(?,7,'第七集','editing',datetime('now'),datetime('now'))").run(project.id).lastInsertRowid
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }) })
  return { db, storage, admin, project, episode, source }
}

test('merged episode final is registered as a project asset and reused on re-merge', async (t) => {
  const { db, storage, project, episode } = setup(t)
  const assetId = await merges.registerMergedFinalAsset(db, log, { episodeId: episode, mergeId: 101, localPath: 'videos/merged/merged_test.mp4', storageRoot: storage })
  assert.ok(assetId)
  const row = db.prepare('SELECT * FROM assets WHERE id=?').get(assetId)
  assert.equal(row.source_type, 'merged_final')
  assert.equal(row.category, 'final')
  assert.equal(row.type, 'video')
  assert.equal(row.drama_id, project.id)
  assert.equal(row.local_path, 'videos/merged/merged_test.mp4')
  assert.equal(row.url, '/static/videos/merged/merged_test.mp4')
  assert.equal(row.width, 640)
  assert.equal(row.height, 360)
  assert.ok(Math.abs(row.duration - 2) < 0.5)
  assert.ok(row.file_size > 0)
  assert.match(row.name, /^第7集 成片/)
  const meta = JSON.parse(row.metadata_json)
  assert.equal(meta.episode_id, episode)
  assert.equal(meta.merge_id, 101)
  // 重组合并：更新同一条素材指向新路径，不产生第二条成片素材
  fs.copyFileSync(path.join(storage, 'videos', 'merged', 'merged_test.mp4'), path.join(storage, 'videos', 'merged', 'merged_v2.mp4'))
  const again = await merges.registerMergedFinalAsset(db, log, { episodeId: episode, mergeId: 102, localPath: 'videos/merged/merged_v2.mp4', storageRoot: storage })
  assert.equal(again, assetId)
  const updated = db.prepare('SELECT local_path, file_size FROM assets WHERE id=?').get(assetId)
  assert.equal(updated.local_path, 'videos/merged/merged_v2.mp4')
  assert.equal(updated.file_size, fs.statSync(path.join(storage, 'videos', 'merged', 'merged_v2.mp4')).size)
  assert.equal(db.prepare("SELECT COUNT(*) c FROM assets WHERE source_type='merged_final'").get().c, 1)
})

test('registration is best-effort: missing episode or file never throws into the merge result', async (t) => {
  const { db, storage, episode } = setup(t)
  assert.equal(await merges.registerMergedFinalAsset(db, log, { episodeId: 99999, mergeId: 1, localPath: 'videos/merged/merged_test.mp4', storageRoot: storage }), null)
  assert.equal(await merges.registerMergedFinalAsset(db, log, { episodeId: episode, mergeId: 1, localPath: 'videos/merged/missing.mp4', storageRoot: storage }), null)
  assert.equal(db.prepare("SELECT COUNT(*) c FROM assets WHERE source_type='merged_final'").get().c, 0)
})
