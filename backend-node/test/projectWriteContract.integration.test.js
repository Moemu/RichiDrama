const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { once } = require('node:events');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const express = require('express');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const auth = require('../src/services/authService');
const { setupRouter } = require('../src/routes');

test('actual frontend writes isolate fields and commands across continuous project updates', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-write-contract-'));
  const cfg = { storage: { type: 'local', local_path: path.join(root, 'storage') }, payments: { enabled: false }, image_proxy: { use_for_video: false }, vendor_lock: { enabled: false } };
  fs.mkdirSync(cfg.storage.local_path);
  const log = { info() {}, warn() {}, error() {}, debug() {}, infow() {}, warnw() {}, errorw() {} };
  let db, server, base;
  async function start() {
    db = new Database(path.join(root, 'test.db'));
    runMigrationsAndEnsure(db);
    const app = express();
    app.use(express.json({ limit: '4mb' }));
    app.use('/api/v1', setupRouter(cfg, db, log));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); db.close(); }
  await start();
  t.after(async () => { await stop(); delete globalThis.writeContractSession; fs.rmSync(root, { recursive: true, force: true }); });
  const password = crypto.randomBytes(18).toString('base64url');
  async function raw(token, method, route, data) {
    const response = await fetch(base + route, { method, signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json', 'x-lmd-session': token || '' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, data: await response.json() };
  }
  async function user(username) {
    const row = auth.createUser(db, { username, password });
    const login = await raw('', 'POST', '/auth/login', { username, password });
    return { id: row.id, token: login.data.data.token };
  }
  const owner = await user('write_owner'), peer = await user('write_peer'), viewer = await user('write_viewer');
  const created = await raw(owner.token, 'POST', '/dramas', { title: '写入隔离', description: '原文' });
  assert.equal(created.status, 201);
  const projectId = created.data.data.id, projectUrl = `/dramas/${projectId}`;
  await raw(owner.token, 'PUT', `${projectUrl}/collaboration/members`, { username: 'write_peer', role: 'editor' });
  await raw(owner.token, 'PUT', `${projectUrl}/collaboration/members`, { username: 'write_viewer', role: 'viewer' });
  await raw(owner.token, 'PUT', `${projectUrl}/episodes`, { episodes: [{ episode_number: 1, title: '第一集', script_content: '开场' }] });
  const project = (await raw(owner.token, 'GET', projectUrl)).data.data;
  const episodeId = project.episodes[0].id;
  const first = (await raw(owner.token, 'POST', '/storyboards', { episode_id: episodeId, title: '第一镜' })).data.data;
  await raw(owner.token, 'GET', `/episodes/${episodeId}/generation-settings`);
  const asset = (await raw(owner.token, 'POST', '/assets', { drama_id: projectId, name: '声明测试', type: 'image' })).data.data;
  assert.ok(asset.id);

  // Run the production frontend interceptor and snapshot code against real HTTP.
  const front = path.resolve(__dirname, '../../frontweb');
  const href = relative => pathToFileURL(path.join(front, relative)).href;
  const { browserModuleUrl, moduleSourceUrl } = await import(href('test/helpers/browserModule.js'));
  const snapshots = await import(href('src/utils/projectSnapshots.js'));
  const contractUrl = await browserModuleUrl(path.join(front, 'src/utils/projectWriteContract.js'), { './projectSnapshots': href('src/utils/projectSnapshots.js') });
  const state = (await raw(owner.token, 'GET', `${projectUrl}/collaboration/state`)).data.data;
  globalThis.writeContractSession = { id: projectId, enabled: true, canEdit: true, connected: false, revision: state.revision, writeContractVersion: state.write_contract_version };
  const sessionUrl = moduleSourceUrl('export const projectSession = globalThis.writeContractSession; export const hasPendingProjectText = () => false;');
  const { installProjectRequestSync } = await import(await browserModuleUrl(path.join(front, 'src/utils/projectRequestSync.js'), {
    '@/composables/useProjectCollaboration': sessionUrl,
    './projectSnapshots': href('src/utils/projectSnapshots.js'),
    './requestId': href('src/utils/requestId.js'),
    './projectWriteContract': contractUrl,
  }));
  const axios = (await import(href('node_modules/axios/index.js'))).default;
  const client = axios.create({ baseURL: base, timeout: 10000, headers: { 'x-lmd-session': owner.token }, validateStatus: () => true });
  const sent = [];
  client.interceptors.request.use(config => { sent.push({ method: config.method, url: config.url, data: structuredClone(config.data), headers: { ...config.headers } }); return config; });
  installProjectRequestSync(client);
  client.interceptors.response.use(response => {
    if (response.status < 400) {
      snapshots.rememberProjectResponse(response.config.url, response.data.data);
      snapshots.rememberProjectAcknowledgement(response.data.project_edit);
    }
    return response;
  });
  const read = async () => (await client.get(projectUrl)).data.data;
  const ok = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.data)); return response.data.data; };
  let serial = 0;
  const unrelated = () => raw(peer.token, 'PUT', projectUrl, { description: `无关更新${++serial}` });
  await read();
  await client.get(`/assets/${asset.id}`);
  const listShot = ok(await client.get(`/episodes/${episodeId}/storyboards`)).storyboards[0];
  const detailShot = ok(await client.get(`/storyboards/${first.id}`));
  const projectShot = (await read()).episodes[0].storyboards[0];
  const inputKeys = Object.keys(require('../src/services/storyboardInputState').storyboardInputState({}));
  for (const field of inputKeys) {
    assert.deepEqual(listShot[field], detailShot[field], `episode list must expose ${field}`);
    assert.deepEqual(projectShot[field], detailShot[field], `project detail must expose ${field}`);
  }
  await unrelated();
  ok(await client.put(`/storyboards/${first.id}`, {
    omni_asset_ids: [asset.id], omni_asset_usage_json: { [asset.id]: 'reference' },
    omni_asset_send_policy: 'prompt_references', omni_prompt_document: { text: '素材提示词', refs: [] },
  }, { projectBaseline: { ...listShot, __projectId: projectId } }));
  const readsBefore = sent.filter(item => item.method === 'get').length;
  await unrelated();
  const createOperation = crypto.randomUUID();
  const secondBody = { episode_id: episodeId, title: '第二镜' };
  const second = ok(await client.post('/storyboards', secondBody, { headers: { 'X-Project-Operation': createOperation } }), 201);
  assert.equal(ok(await client.post('/storyboards', secondBody, { headers: { 'X-Project-Operation': createOperation } }), 201).id, second.id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM storyboards WHERE episode_id=?').get(episodeId).n, 2);
  let certificationCalls = 0;
  t.mock.method(require('../src/services/assetSd2Service'), 'certify', async (_db, _log, _cfg, id, userId) => {
    assert.equal(Number(id), asset.id); assert.equal(userId, owner.id); certificationCalls++;
    return { ok: true, seedance2_asset: { status: 'ready' } };
  });
  for (const value of [true, false, true]) {
    await unrelated();
    ok(await client.put(`/assets/${asset.id}`, { requires_sd2_identity: value }));
    assert.equal((await raw(owner.token, 'GET', `/assets/${asset.id}`)).data.data.requires_sd2_identity, value);
    if (value) { await unrelated(); ok(await client.post(`/assets/${asset.id}/sd2-certify`)); }
  }
  assert.equal(certificationCalls, 2);
  assert.equal(sent.filter(item => item.method === 'get').length, readsBefore, 'writes must not perform a read/rebase round trip');
  assert.ok(sent.filter(item => item.method !== 'get').every(item => !item.headers['X-Project-Revision']));
  await unrelated();
  ok(await client.put('/storyboards/reorder', { episode_id: episodeId, ids: [second.id, first.id] }));
  assert.deepEqual(snapshots.projectSnapshot('episodes', episodeId).storyboard_order, [second.id, first.id]);
  await unrelated();
  ok(await client.put('/storyboards/reorder', { episode_id: episodeId, ids: [first.id, second.id] }));
  await client.get(`/episodes/${episodeId}/generation-settings`);
  for (const duration of [10, 12, 8]) {
    await unrelated();
    ok(await client.patch(`/storyboards/${first.id}/generation-settings`, { scope: 'current', settings: { duration } }));
  }
  await unrelated();
  ok(await client.put(`/storyboards/${first.id}`, { audio_volume: 0.7 }));
  await unrelated();
  ok(await client.put(`/storyboards/${first.id}`, { audio_volume: 0.9 }));
  const baseline = snapshots.captureProjectEdit('storyboards', first.id);
  await raw(peer.token, 'PUT', `/storyboards/${first.id}`, { audio_volume: 0.4 });
  const conflict = await client.put(`/storyboards/${first.id}`, { audio_volume: 0.6 }, baseline);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.error.code, 'PROJECT_FIELD_CHANGED');
  assert.equal((await raw(owner.token, 'GET', `/storyboards/${first.id}`)).data.data.audio_volume, 0.4);
  assert.equal(snapshots.projectSnapshot('storyboards', first.id).audio_volume, 0.9, 'a failed save cannot erase its baseline');
  await raw(peer.token, 'PUT', '/storyboards/reorder', { episode_id: episodeId, ids: [second.id, first.id] });
  assert.equal((await client.put('/storyboards/reorder', { episode_id: episodeId, ids: [first.id, second.id] })).status, 409);
  await read();
  const canvasBaseline = snapshots.captureProjectEdit('dramas', projectId);
  await unrelated();
  const layout = { version: 1, nodes: { first: { x: 10, y: 20 } } };
  ok(await client.put(`${projectUrl}/canvas-layout`, { canvas_layout: layout }, canvasBaseline));
  const oldCanvas = snapshots.captureProjectEdit('dramas', projectId);
  await raw(peer.token, 'PUT', `${projectUrl}/canvas-layout`, { canvas_layout: { version: 1, nodes: { first: { x: 99, y: 20 } } } });
  assert.equal((await client.put(`${projectUrl}/canvas-layout`, { canvas_layout: layout }, oldCanvas)).status, 409);
  const denied = await raw(viewer.token, 'PUT', `/assets/${asset.id}`, { requires_sd2_identity: false, _project_edit: { version: 1, checks: [] } });
  assert.equal(denied.status, 403);
  await raw(owner.token, 'PUT', `${projectUrl}/characters`, { characters: [{ name: '连续图片编辑' }] });
  const character = (await read()).characters[0];
  for (const image of ['data:image/png;base64,YQ==', 'data:image/png;base64,Yg==']) {
    await unrelated();
    ok(await client.put(`/characters/${character.id}/image`, { image_url: image }));
    assert.equal(snapshots.projectSnapshot('characters', character.id).image_url, image);
  }
  const imageBaseline = snapshots.captureProjectEdit('characters', character.id);
  ok(await client.put(`/characters/${character.id}/image`, { image_url: 'data:image/png;base64,Yw==' }));
  assert.equal((await client.put(`/characters/${character.id}/image`, { image_url: 'data:image/png;base64,ZA==' }, imageBaseline)).status, 409);
  const scene = ok(await client.post('/scenes', { drama_id: projectId, location: '车站', prompt: '初始' }), 201);
  await read();
  for (const prompt of ['第一次修改', '第二次修改']) {
    await unrelated();
    ok(await client.put(`/scenes/${scene.id}/prompt`, { prompt }));
    assert.equal(snapshots.projectSnapshot('scenes', scene.id).prompt, prompt);
  }
  await client.get(`/storyboards/${first.id}/frame-prompts`);
  for (const prompt of ['第一帧提示词', '第二帧提示词']) {
    await unrelated();
    ok(await client.put(`/storyboards/${first.id}/frame-prompts/first`, { prompt }));
  }
  const frameBaseline = snapshots.captureProjectEdit('storyboards', first.id);
  await raw(peer.token, 'PUT', `/storyboards/${first.id}/frame-prompts/first`, { prompt: '其他人的帧提示词' });
  assert.equal((await client.put(`/storyboards/${first.id}/frame-prompts/first`, { prompt: '过时覆盖' }, frameBaseline)).status, 409);
  const legacyId = Number(db.prepare('INSERT INTO dramas(title,owner_user_id) VALUES(?,?)').run('历史私有项目', owner.id).lastInsertRowid);
  await stop(); await start(); client.defaults.baseURL = base;
  assert.equal((await raw(owner.token, 'GET', `/assets/${asset.id}`)).data.data.requires_sd2_identity, true);
  assert.equal((await raw(owner.token, 'GET', `/storyboards/${first.id}`)).data.data.audio_volume, 0.4);
  assert.equal((await raw(owner.token, 'GET', `/dramas/${legacyId}`)).data.data.permissions.collaboration_enabled, false);
  assert.equal(ok(await client.post('/storyboards', secondBody, { headers: { 'X-Project-Operation': createOperation } }), 201).id, second.id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM storyboards WHERE episode_id=?').get(episodeId).n, 2);
});
