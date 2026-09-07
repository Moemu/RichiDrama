const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const AdmZip = require('adm-zip');

const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const auth = require('../src/services/authService');
const { setupRouter } = require('../src/routes');

function insertRow(db, table, values) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  const names = Object.keys(values).filter((name) => columns.has(name));
  const result = db.prepare(
    `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`
  ).run(...names.map((name) => values[name]));
  return Number(result.lastInsertRowid);
}

function listFiles(root, base = root) {
  const output = [];
  if (!fs.existsSync(root)) return output;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...listFiles(absolute, base));
    else output.push(path.relative(base, absolute).replace(/\\/g, '/'));
  }
  return output.sort();
}

function makeZip(project, files = {}) {
  const zip = new AdmZip();
  zip.addFile('project.json', Buffer.from(JSON.stringify(project), 'utf8'));
  for (const [name, contents] of Object.entries(files)) {
    zip.addFile(name, Buffer.isBuffer(contents) ? contents : Buffer.from(String(contents)));
  }
  return zip.toBuffer();
}

async function createHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minidrama-drama-http-'));
  const previousCwd = process.cwd();
  process.chdir(root);
  const cfg = {
    app: { name: 'Drama transfer HTTP test', language: 'zh' },
    server: {},
    database: { type: 'sqlite', path: path.join(root, 'test.db') },
    storage: { type: 'local', local_path: path.join(root, 'storage') },
    payments: { enabled: false },
    image_proxy: { use_for_video: false },
    vendor_lock: { enabled: false },
  };
  fs.writeFileSync(path.join(root, 'config.yaml'), JSON.stringify(cfg));
  const log = { info() {}, warn() {}, error() {}, debug() {}, infow() {}, warnw() {}, errorw() {} };
  let db;
  let server;
  let base;

  async function start() {
    db = getDb(cfg.database);
    runMigrationsAndEnsure(db);
    const app = express();
    app.use(express.json());
    app.use('/api/v1', setupRouter(cfg, db, log));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  }

  async function stop() {
    if (server) {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      server = null;
    }
    closeDb();
  }

  async function request(method, route, token, options = {}) {
    const headers = { ...(token ? { 'x-lmd-session': token } : {}), ...(options.headers || {}) };
    const result = await fetch(base + route, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: options.body }),
    });
    const contentType = result.headers.get('content-type') || '';
    const body = contentType.includes('json') ? await result.json() : Buffer.from(await result.arrayBuffer());
    return { status: result.status, headers: result.headers, body };
  }

  async function close() {
    await stop();
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }

  await start();
  return { root, cfg, db: () => db, storage: cfg.storage.local_path, request, start, stop, close };
}

test('drama export/import HTTP preserves Omni references, assets, links, and restart reads', { concurrency: false }, async () => {
  const harness = await createHarness();
  try {
    const db = harness.db();
    const user = auth.createUser(db, { username: 'drama-transfer-user', password: 'test-password' }, null);
    const otherUser = auth.createUser(db, { username: 'drama-transfer-other', password: 'test-password' }, null);
    const login = await harness.request('POST', '/auth/login', null, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: user.username, password: 'test-password' }),
    });
    assert.equal(login.status, 200);
    const token = login.body.data.token;

    const created = await harness.request('POST', '/dramas', token, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Omni transfer source', style: 'cinematic' }),
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const sourceDramaId = created.body.data.id;
    const now = new Date().toISOString();
    const episodeId = insertRow(db, 'episodes', {
      drama_id: sourceDramaId, episode_number: 1, title: '第一集', script_content: 'A short script', duration: 8,
      created_at: now, updated_at: now,
    });
    const characterId = insertRow(db, 'characters', {
      drama_id: sourceDramaId, name: 'Hero', role: 'lead', description: 'The lead character', sort_order: 0,
      created_at: now, updated_at: now,
    });
    const sourceMediaRelative = 'projects/source/hero.bin';
    fs.mkdirSync(path.dirname(path.join(harness.storage, sourceMediaRelative)), { recursive: true });
    const media = Buffer.from('durable hero media');
    fs.writeFileSync(path.join(harness.storage, sourceMediaRelative), media);
    const assetId = insertRow(db, 'assets', {
      drama_id: sourceDramaId,
      owner_user_id: user.id,
      name: 'Hero reference',
      reference_alias: 'hero_ref',
      type: 'image',
      category: 'character',
      url: '',
      local_path: sourceMediaRelative,
      file_size: media.length,
      mime_type: 'application/octet-stream',
      width: 64,
      height: 64,
      source_type: 'project_resource',
      metadata_json: JSON.stringify({ resource_type: 'character', resource_id: characterId }),
      tags_json: JSON.stringify(['hero', 'identity']),
      is_favorite: 1,
      checksum: 'source-checksum',
      processing_status: 'ready',
      requires_sd2_identity: 1,
      created_at: now,
      updated_at: now,
    });
    const globalParentId = insertRow(db, 'assets', {
      drama_id: null,
      owner_user_id: user.id,
      name: 'Shared parent reference',
      reference_alias: 'shared_parent',
      type: 'image',
      category: 'library',
      source_type: 'library',
      processing_status: 'ready',
      created_at: now,
      updated_at: now,
    });
    const globalReferencedId = insertRow(db, 'assets', {
      drama_id: null,
      owner_user_id: user.id,
      name: 'Shared referenced reference',
      reference_alias: 'shared_ref',
      type: 'image',
      category: 'library',
      source_type: 'library',
      parent_asset_id: globalParentId,
      processing_status: 'ready',
      created_at: now,
      updated_at: now,
    });
    const globalUnreferencedId = insertRow(db, 'assets', {
      drama_id: null,
      owner_user_id: user.id,
      name: 'Shared unreferenced reference',
      reference_alias: 'shared_unused',
      type: 'image',
      category: 'library',
      source_type: 'library',
      processing_status: 'ready',
      created_at: now,
      updated_at: now,
    });
    const otherOwnerReferencedId = insertRow(db, 'assets', {
      drama_id: null,
      owner_user_id: otherUser.id,
      name: 'Other owner reference',
      reference_alias: 'other_owner',
      type: 'image',
      category: 'library',
      source_type: 'library',
      processing_status: 'ready',
      created_at: now,
      updated_at: now,
    });
    insertRow(db, 'asset_resource_links', {
      owner_user_id: user.id, drama_id: sourceDramaId, resource_type: 'character', resource_id: characterId,
      role: 'primary_image', asset_id: assetId, status: 'active', created_at: now, updated_at: now,
    });
    insertRow(db, 'asset_resource_links', {
      owner_user_id: user.id, drama_id: sourceDramaId, resource_type: 'character', resource_id: characterId,
      role: 'secondary_image', asset_id: globalReferencedId, status: 'active', created_at: now, updated_at: now,
    });
    insertRow(db, 'asset_resource_links', {
      owner_user_id: user.id, drama_id: sourceDramaId, resource_type: 'character', resource_id: characterId,
      role: 'foreign_reference', asset_id: otherOwnerReferencedId, status: 'active', created_at: now, updated_at: now,
    });
    const storyboardId = insertRow(db, 'storyboards', {
      episode_id: episodeId,
      storyboard_number: 1,
      title: 'Omni shot',
      description: 'A shot with a stable identity reference',
      location: 'Rooftop',
      time: 'Night',
      dialogue: 'Stay with me.',
      narration: 'The wind rises.',
      action: 'Hero turns toward camera.',
      atmosphere: 'Cold blue light',
      result: 'A close portrait',
      shot_type: 'medium',
      angle: 'eye_level',
      angle_h: 'front',
      angle_v: 'eye_level',
      angle_s: 'medium',
      movement: 'slow_push',
      lighting_style: 'moonlight',
      depth_of_field: 'shallow',
      image_prompt: 'A cinematic rooftop portrait',
      polished_prompt: 'A polished cinematic rooftop portrait',
      video_prompt: 'Hero turns slowly',
      duration: 8,
      emotion: 'determined',
      emotion_intensity: 3,
      segment_index: 0,
      segment_title: 'Identity beat',
      continuity_snapshot: JSON.stringify({ hero: { position: 'center' } }),
      creation_mode: 'universal',
      universal_segment_text: 'Hero_ref moves under moonlight.',
      layout_description: 'Hero centered, skyline behind.',
      text_model: 'text-fixture',
      video_model: 'video-fixture',
      video_resolution: '1080p',
      video_aspect_ratio: '16:9',
      video_upscale_resolution: '2k',
      video_target_fps: 60,
      generation_overrides_json: JSON.stringify({ duration: 8, seed: 42 }),
      audio_strategy: 'mix_original',
      keep_original_audio: 1,
      audio_volume: 0.75,
      audio_fade_seconds: 0.4,
      omni_creation_mode: 'first_last_frame',
      omni_asset_ids: JSON.stringify([assetId, globalReferencedId, otherOwnerReferencedId]),
      omni_asset_usage_json: JSON.stringify({
        [assetId]: 'identity',
        [globalReferencedId]: 'identity_secondary',
        [otherOwnerReferencedId]: 'foreign_should_not_export',
      }),
      omni_first_frame_asset_id: assetId,
      omni_last_frame_asset_id: globalReferencedId,
      omni_asset_send_policy: 'selected_only',
      omni_prompt_document_json: JSON.stringify({
        text: 'Use @hero_ref as the identity anchor.',
        refs: [
          { asset_id: assetId, alias: 'hero_ref', occurrence: 1, start: 4, end: 13 },
          { asset_id: globalReferencedId, alias: 'shared_ref', occurrence: 1, start: 17, end: 27 },
          { asset_id: otherOwnerReferencedId, alias: 'other_owner', occurrence: 1, start: 30, end: 41 },
        ],
      }),
      characters: JSON.stringify([characterId]),
      created_at: now,
      updated_at: now,
    });

    const exported = await harness.request('GET', `/dramas/${sourceDramaId}/export`, token);
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-type') || '', /application\/zip/);
    const archive = new AdmZip(exported.body);
    const project = JSON.parse(archive.readAsText('project.json'));
    assert.equal(project.version, '1.5');
    assert.deepEqual(project.assets.map((asset) => asset.name), [
      'Hero reference', 'Shared parent reference', 'Shared referenced reference',
    ]);
    assert.equal(project.assets.some((asset) => asset.name === 'Shared unreferenced reference'), false);
    assert.equal(project.assets.some((asset) => asset.name === 'Other owner reference'), false);
    assert.deepEqual(project.asset_resource_links, [
      {
        asset_index: 0,
        resource_type: 'character',
        resource_index: 0,
        role: 'primary_image',
        status: 'active',
        detached_at: null,
      },
      {
        asset_index: 2,
        resource_type: 'character',
        resource_index: 0,
        role: 'secondary_image',
        status: 'active',
        detached_at: null,
      },
    ]);
    const exportedStoryboard = project.episodes[0].storyboards[0];
    assert.deepEqual(exportedStoryboard.omni_asset_refs, [
      { asset_index: 0, usage: 'identity' },
      { asset_index: 2, usage: 'identity_secondary' },
    ]);
    assert.equal(exportedStoryboard.omni_first_frame_asset_index, 0);
    assert.equal(exportedStoryboard.omni_last_frame_asset_index, 2);
    assert.deepEqual(exportedStoryboard.omni_prompt_document.refs.map((ref) => ref.asset_index), [0, 2]);
    assert.ok(archive.getEntry('media/assets/asset_' + assetId + '.bin'));

    const form = new FormData();
    form.append('file', new Blob([exported.body], { type: 'application/zip' }), 'omni-transfer.zip');
    const imported = await harness.request('POST', '/dramas/import', token, { body: form });
    assert.equal(imported.status, 201, JSON.stringify(imported.body));
    const importedDramaId = imported.body.data.drama_id;
    assert.notEqual(importedDramaId, sourceDramaId);

    const importedDrama = db.prepare('SELECT * FROM dramas WHERE id=?').get(importedDramaId);
    const importedAssets = db.prepare('SELECT * FROM assets WHERE drama_id=? ORDER BY id').all(importedDramaId);
    const importedAsset = importedAssets.find((asset) => asset.name === 'Hero reference');
    const importedParent = importedAssets.find((asset) => asset.name === 'Shared parent reference');
    const importedGlobal = importedAssets.find((asset) => asset.name === 'Shared referenced reference');
    const importedCharacter = db.prepare('SELECT * FROM characters WHERE drama_id=?').get(importedDramaId);
    const importedStoryboard = db.prepare(
      'SELECT * FROM storyboards WHERE episode_id IN (SELECT id FROM episodes WHERE drama_id=?)'
    ).get(importedDramaId);
    assert.equal(importedDrama.owner_user_id, user.id);
    assert.equal(importedAsset.name, 'Hero reference');
    assert.equal(importedAssets.length, 3);
    assert.equal(importedParent.parent_asset_id, null);
    assert.equal(importedGlobal.parent_asset_id, importedParent.id);
    assert.equal(importedAsset.source_type, 'project_resource');
    assert.equal(importedAsset.url, '', 'local archive media must be durable, not a source URL');
    assert.ok(importedAsset.local_path);
    assert.deepEqual(fs.readFileSync(path.join(harness.storage, importedAsset.local_path)), media);
    assert.deepEqual(JSON.parse(importedAsset.metadata_json), { resource_type: 'character', resource_id: importedCharacter.id });
    assert.deepEqual(JSON.parse(importedStoryboard.omni_asset_ids), [importedAsset.id, importedGlobal.id]);
    assert.deepEqual(JSON.parse(importedStoryboard.omni_asset_usage_json), {
      [importedAsset.id]: 'identity',
      [importedGlobal.id]: 'identity_secondary',
    });
    assert.equal(importedStoryboard.omni_first_frame_asset_id, importedAsset.id);
    assert.equal(importedStoryboard.omni_last_frame_asset_id, importedGlobal.id);
    assert.equal(importedStoryboard.omni_asset_send_policy, 'selected_only');
    assert.equal(importedStoryboard.video_model, 'video-fixture');
    assert.equal(importedStoryboard.video_resolution, '1080p');
    assert.equal(importedStoryboard.video_aspect_ratio, '16:9');
    assert.equal(importedStoryboard.video_upscale_resolution, '2k');
    assert.equal(importedStoryboard.video_target_fps, 60);
    assert.deepEqual(JSON.parse(importedStoryboard.generation_overrides_json), { duration: 8, seed: 42 });
    assert.equal(importedStoryboard.audio_strategy, 'mix_original');
    assert.equal(importedStoryboard.keep_original_audio, 1);
    assert.equal(importedStoryboard.audio_volume, 0.75);
    assert.equal(importedStoryboard.audio_fade_seconds, 0.4);
    const importedPrompt = JSON.parse(importedStoryboard.omni_prompt_document_json);
    assert.deepEqual(importedPrompt.refs.map((ref) => ref.asset_id), [importedAsset.id, importedGlobal.id]);
    assert.equal(importedPrompt.refs[0].alias, 'hero_ref');
    const importedLinks = db.prepare('SELECT * FROM asset_resource_links WHERE drama_id=? ORDER BY id').all(importedDramaId);
    assert.equal(importedLinks.length, 2);
    assert.equal(importedLinks[0].resource_type, 'character');
    assert.equal(importedLinks[0].resource_id, importedCharacter.id);
    assert.equal(importedLinks[0].asset_id, importedAsset.id);
    assert.equal(importedLinks[0].owner_user_id, user.id);
    assert.equal(importedLinks[1].asset_id, importedGlobal.id);
    assert.equal(importedLinks[1].role, 'secondary_image');

    await harness.stop();
    await harness.start();
    const restored = await harness.request('GET', `/dramas/${importedDramaId}`, token);
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    assert.equal(restored.body.data.title, 'Omni transfer source 导入1');
    const restoredStoryboard = restored.body.data.episodes[0].storyboards[0];
    assert.equal(restoredStoryboard.omni_prompt_document.refs[0].asset_id, importedAsset.id);
    assert.ok(harness.db().prepare('SELECT 1 FROM assets WHERE id=? AND local_path IS NOT NULL').get(importedAsset.id));
  } finally {
    await harness.close();
  }
});

test('failed drama import removes only files created by that import and preserves existing media', { concurrency: false }, async () => {
  const harness = await createHarness();
  try {
    const db = harness.db();
    const user = auth.createUser(db, { username: 'drama-cleanup-user', password: 'test-password' }, null);
    const login = await harness.request('POST', '/auth/login', null, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: user.username, password: 'test-password' }),
    });
    assert.equal(login.status, 200);
    const token = login.body.data.token;
    const oldRelative = 'projects/legacy/characters/keep.bin';
    fs.mkdirSync(path.dirname(path.join(harness.storage, oldRelative)), { recursive: true });
    const oldContents = Buffer.from('old media must survive');
    fs.writeFileSync(path.join(harness.storage, oldRelative), oldContents);

    const project = {
      version: '1.5',
      drama: { title: 'Rollback fixture', description: 'fails after writing one file' },
      characters: [
        { name: 'Written before failure', image_file: 'media/characters/first.bin' },
        null,
      ],
      episodes: [],
      scenes: [],
      props: [],
      assets: [],
    };
    const archive = makeZip(project, { 'media/characters/first.bin': Buffer.from('new media') });
    const form = new FormData();
    form.append('file', new Blob([archive], { type: 'application/zip' }), 'rollback.zip');
    const failed = await harness.request('POST', '/dramas/import', token, { body: form });
    assert.equal(failed.status, 500, JSON.stringify(failed.body));
    assert.equal(failed.body.success, false);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM dramas WHERE title='Rollback fixture'").get().count, 0);
    assert.deepEqual(fs.readFileSync(path.join(harness.storage, oldRelative)), oldContents);
    assert.deepEqual(listFiles(harness.storage), [oldRelative]);
  } finally {
    await harness.close();
  }
});
