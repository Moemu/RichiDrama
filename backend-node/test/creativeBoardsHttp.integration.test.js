const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../src/services/authService');
const assets = require('../src/services/assetService');
const images = require('../src/services/imageService');
const videos = require('../src/services/videoService');
const ai = require('../src/services/aiConfigService');
const billing = require('../src/services/billingService');
const { modelCatalogFixture } = require('./helpers/modelCatalogFixture');

test('board HTTP routes isolate owners and keep legacy media readable after restart', { concurrency: false }, async () => {
  const f = await modelCatalogFixture();
  try {
    const other = auth.createUser(f.db, { username: 'board-other', password: 'fixture-password', account_kind: 'customer' }, null);
    const login = async (username) => {
      const result = await f.request('POST', '/auth/login', { username, password: 'fixture-password' });
      assert.equal(result.status, 200);
      return result.cookie;
    };
    const ownerCookie = await login(f.admin.username), otherCookie = await login(other.username);
    const created = await f.request('POST', '/creative-boards', { name: '独立画布' }, ownerCookie);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const board = created.body.data;
    assert.deepEqual(board.graph, { nodes: [], edges: [] });
    assert.equal((await f.request('GET', '/creative-boards', undefined, otherCookie)).body.data.length, 0);
    assert.equal((await f.request('GET', `/creative-boards/${board.id}`, undefined, otherCookie)).status, 404);
    const ownerAsset = assets.create(f.db, f.log, { owner_user_id: f.admin.id, name: '参考', type: 'image', local_path: 'test/reference.png' });
    const otherAsset = assets.create(f.db, f.log, { owner_user_id: other.id, name: '他人参考', type: 'image', local_path: 'test/other.png' });
    const valid = { nodes: [{ id: `asset:${ownerAsset.id}`, source_type: 'asset', source_id: ownerAsset.id, x: 12, y: 24 }], edges: [] };
    const updated = await f.request('PUT', `/creative-boards/${board.id}`, { revision: board.revision, graph: valid }, ownerCookie);
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.data.revision, board.revision + 1);
    assert.equal((await f.request('PUT', `/creative-boards/${board.id}`, { revision: board.revision, graph: valid }, ownerCookie)).status, 409);
    const foreign = { nodes: [{ id: `asset:${otherAsset.id}`, source_type: 'asset', source_id: otherAsset.id, x: 0, y: 0 }], edges: [] };
    assert.equal((await f.request('PUT', `/creative-boards/${board.id}`, { revision: updated.body.data.revision, graph: foreign }, ownerCookie)).status, 400);
    assert.equal((await f.request('POST', '/images', { source_context: 'creative_board', board_id: board.id, idempotency_key: 'image-foreign', prompt: 'test', model: 'existing-image', aspect_ratio: '16:9', reference_sources: [{ source_type: 'asset', source_id: otherAsset.id }] }, ownerCookie)).status, 400);
    assert.equal((await f.request('POST', '/omni-video-jobs', { source_context: 'creative_board', board_id: board.id, idempotency_key: 'video-foreign', prompt: 'test', assets: [{ asset_id: otherAsset.id }] }, ownerCookie)).status, 400);
    const at = new Date().toISOString();
    const legacy = f.db.prepare("INSERT INTO video_generations(owner_user_id,prompt,status,local_path,created_at,updated_at) VALUES(?, '历史视频', 'completed', 'test/legacy.mp4', ?, ?)").run(f.admin.id, at, at);
    const boardVideo = f.db.prepare("INSERT INTO video_generations(owner_user_id,board_id,prompt,status,local_path,created_at,updated_at) VALUES(?, ?, '画布视频', 'completed', 'test/board.mp4', ?, ?)").run(f.admin.id, board.id, at, at);
    const boardImage = f.db.prepare("INSERT INTO image_generations(owner_user_id,board_id,prompt,status,local_path,created_at,updated_at) VALUES(?, ?, '画布图', 'completed', 'test/board.png', ?, ?)").run(f.admin.id, board.id, at, at);
    assert.equal((await f.request('GET', `/videos/${boardVideo.lastInsertRowid}`, undefined, otherCookie)).status, 404);
    assert.equal((await f.request('GET', `/images/${boardImage.lastInsertRowid}`, undefined, otherCookie)).status, 404);
    assert.equal((await f.request('DELETE', `/videos/${boardVideo.lastInsertRowid}`, undefined, otherCookie)).status, 404);
    assert.equal((await f.request('DELETE', `/images/${boardImage.lastInsertRowid}`, undefined, otherCookie)).status, 404);
    assert.equal((await f.request('GET', `/videos/${legacy.lastInsertRowid}`, undefined, ownerCookie)).status, 200);
    await f.restart();
    const restored = await f.request('GET', `/videos/${legacy.lastInsertRowid}`, undefined, ownerCookie);
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    assert.equal(restored.body.data.prompt, '历史视频');
    assert.equal((await f.request('GET', `/creative-boards/${board.id}`, undefined, ownerCookie)).body.data.revision, board.revision + 1);
  } finally { await f.close(); }
});

test('board image and Omni video HTTP submissions keep independent billing attribution and idempotency', { concurrency: false }, async (t) => {
  const f = await modelCatalogFixture();
  try {
    const login = await f.request('POST', '/auth/login', { username: f.admin.username, password: 'fixture-password' });
    assert.equal(login.status, 200);
    const cookie = login.cookie;
    const boardResponse = await f.request('POST', '/creative-boards', { name: '计费归属' }, cookie);
    const boardId = boardResponse.body.data.id;
    let imageRequests = 0;
    t.mock.method(images, 'create', (db, _log, req) => {
      imageRequests++;
      const at = new Date().toISOString();
      const row = db.prepare("INSERT INTO image_generations(owner_user_id,board_id,board_request_id,billing_authorization_id,prompt,model,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'pending',?,?)")
        .run(req.owner_user_id, req.board_id, req.idempotency_key, req.billing_authorization_id, req.prompt, req.model, at, at);
      return { id: Number(row.lastInsertRowid), status: 'pending' };
    });
    const imageBody = { source_context: 'creative_board', board_id: boardId, idempotency_key: 'board-image-once', prompt: '独立图片', model: 'existing-image', aspect_ratio: '16:9' };
    const image = await f.request('POST', '/images', imageBody, cookie);
    assert.equal(image.status, 201, JSON.stringify(image.body));
    const repeated = await f.request('POST', '/images', imageBody, cookie);
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.data.id, image.body.data.id);
    assert.equal(imageRequests, 1);
    const imageRow = f.db.prepare('SELECT board_id,drama_id,billing_authorization_id FROM image_generations WHERE id=?').get(image.body.data.id);
    assert.equal(imageRow.board_id, boardId);
    assert.equal(imageRow.drama_id, null);
    const imageAuthorization = f.db.prepare("SELECT source_kind,source_id,drama_id FROM billing_transactions WHERE id=? AND type='authorization'").get(imageRow.billing_authorization_id);
    assert.equal(imageAuthorization.source_kind, 'creative_board');
    assert.equal(Number(imageAuthorization.source_id), boardId);
    assert.equal(imageAuthorization.drama_id, null);
    ai.createConfig(f.db, f.log, { service_type: 'video', provider: 'fixture', name: '本地视频模型', base_url: 'http://supplier.invalid', api_key: 'fixture-only', model: ['fixture-video'], default_model: 'fixture-video', is_default: true });
    billing.savePriceBook(f.db, f.admin.id, { name: '画布视频价目', status: 'published', items: [{ service_type: 'video', model: 'fixture-video', meter: 'second', unit_price: 1 }] });
    t.mock.method(videos, 'processVideoGeneration', async () => {});
    const videoBody = { source_context: 'creative_board', board_id: boardId, idempotency_key: 'board-video-once', prompt: '独立视频', model: 'fixture-video', duration: 4, resolution: '480p', aspect_ratio: '16:9', assets: [] };
    const quote = await f.request('POST', '/omni-video-jobs/quote', { source_context: 'creative_board', board_id: boardId, model: 'fixture-video', duration: 4, resolution: '480p' }, cookie);
    assert.equal(quote.status, 200, JSON.stringify(quote.body));
    const video = await f.request('POST', '/omni-video-jobs', videoBody, cookie);
    assert.equal(video.status, 201, JSON.stringify(video.body));
    const videoAgain = await f.request('POST', '/omni-video-jobs', videoBody, cookie);
    assert.equal(videoAgain.status, 200);
    assert.equal(videoAgain.body.data.video_generation_id, video.body.data.video_generation_id);
    const videoRow = f.db.prepare('SELECT board_id,drama_id,billing_authorization_id FROM video_generations WHERE id=?').get(video.body.data.video_generation_id);
    assert.equal(videoRow.board_id, boardId);
    assert.equal(videoRow.drama_id, null);
    const videoAuthorization = f.db.prepare("SELECT source_kind,source_id,drama_id FROM billing_transactions WHERE id=? AND type='authorization'").get(videoRow.billing_authorization_id);
    assert.equal(videoAuthorization.source_kind, 'creative_board');
    assert.equal(Number(videoAuthorization.source_id), boardId);
    assert.equal(videoAuthorization.drama_id, null);
    const secondBoard = (await f.request('POST', '/creative-boards', { name: '另一张画布' }, cookie)).body.data.id;
    assert.equal((await f.request('POST', '/images', { ...imageBody, board_id: secondBoard }, cookie)).status, 400);
    assert.equal((await f.request('POST', '/omni-video-jobs', { ...videoBody, board_id: secondBoard }, cookie)).status, 400);
    await f.restart();
    const restored = await f.request('GET', `/creative-boards/${boardId}`, undefined, cookie);
    assert.equal(restored.status, 200);
    assert.ok(restored.body.data.generated_images.some((row) => row.id === image.body.data.id));
    assert.ok(restored.body.data.generated_videos.some((row) => row.id === video.body.data.video_generation_id));
    assert.equal((await f.request('POST', '/omni-video-jobs', videoBody, cookie)).body.data.video_generation_id, video.body.data.video_generation_id);
  } finally { t.mock.restoreAll(); await f.close(); }
});

test('board image and video submissions pass through draft_node_id and reject oversized values', { concurrency: false }, async (t) => {
  const f = await modelCatalogFixture();
  try {
    const login = await f.request('POST', '/auth/login', { username: f.admin.username, password: 'fixture-password' });
    assert.equal(login.status, 200);
    const cookie = login.cookie;
    const board = (await f.request('POST', '/creative-boards', { name: '草稿透传' }, cookie)).body.data;
    let capturedImageReq = null;
    t.mock.method(images, 'create', (db, _log, req) => {
      capturedImageReq = req;
      const at = new Date().toISOString();
      const row = db.prepare("INSERT INTO image_generations(owner_user_id,board_id,board_request_id,billing_authorization_id,prompt,model,draft_node_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'pending',?,?)")
        .run(req.owner_user_id, req.board_id, req.idempotency_key, req.billing_authorization_id, req.prompt, req.model, req.draft_node_id ?? null, at, at);
      return { id: Number(row.lastInsertRowid), status: 'pending', draft_node_id: req.draft_node_id ?? null };
    });
    const imageBody = { source_context: 'creative_board', board_id: board.id, idempotency_key: 'board-image-draft', prompt: '草稿图', model: 'existing-image', aspect_ratio: '16:9', draft_node_id: 'draft:image-1' };
    const image = await f.request('POST', '/images', imageBody, cookie);
    assert.equal(image.status, 201, JSON.stringify(image.body));
    assert.equal(capturedImageReq.draft_node_id, 'draft:image-1');
    assert.equal(image.body.data.draft_node_id, 'draft:image-1');
    assert.equal(f.db.prepare('SELECT draft_node_id FROM image_generations WHERE id=?').get(image.body.data.id).draft_node_id, 'draft:image-1');
    assert.equal((await f.request('POST', '/images', { ...imageBody, idempotency_key: 'board-image-draft-long', draft_node_id: 'x'.repeat(201) }, cookie)).status, 400);
    ai.createConfig(f.db, f.log, { service_type: 'video', provider: 'fixture', name: '本地视频模型', base_url: 'http://supplier.invalid', api_key: 'fixture-only', model: ['fixture-video'], default_model: 'fixture-video', is_default: true });
    billing.savePriceBook(f.db, f.admin.id, { name: '草稿视频价目', status: 'published', items: [{ service_type: 'video', model: 'fixture-video', meter: 'second', unit_price: 1 }] });
    t.mock.method(videos, 'processVideoGeneration', async () => {});
    const videoBody = { source_context: 'creative_board', board_id: board.id, idempotency_key: 'board-video-draft', prompt: '草稿视频', model: 'fixture-video', duration: 4, resolution: '480p', aspect_ratio: '16:9', assets: [], draft_node_id: 'draft:video-1' };
    const video = await f.request('POST', '/omni-video-jobs', videoBody, cookie);
    assert.equal(video.status, 201, JSON.stringify(video.body));
    assert.equal(f.db.prepare('SELECT draft_node_id FROM video_generations WHERE id=?').get(video.body.data.video_generation_id).draft_node_id, 'draft:video-1');
    assert.equal((await f.request('POST', '/omni-video-jobs', { ...videoBody, idempotency_key: 'board-video-draft-long', draft_node_id: 'x'.repeat(201) }, cookie)).status, 400);
    const secondImage = await f.request('POST', '/images', { ...imageBody, idempotency_key: 'board-image-draft-v2' }, cookie);
    assert.equal(secondImage.status, 201);
    const graph = { nodes: [
      { id: 'draft:image-1', kind: 'draft_image', x: -123, y: 77, draft: { prompt: '草稿图' } },
      { id: 'draft:video-1', kind: 'draft_video', x: 432, y: -55, draft: { prompt: '草稿视频' } },
      { id: 'delivery:1', kind: 'delivery', x: 880, y: 0, delivery_id: '123' },
    ], edges: [{ id: 'image-to-video', source: 'draft:image-1', target: 'draft:video-1', usage: 'first_frame' }] };
    const saved = await f.request('PUT', `/creative-boards/${board.id}`, { revision: board.revision, graph }, cookie);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    await f.restart();
    const restored = await f.request('GET', `/creative-boards/${board.id}`, undefined, cookie);
    assert.equal(restored.status, 200);
    assert.deepEqual(restored.body.data.graph, graph);
    assert.deepEqual(restored.body.data.generated_images.filter((row) => row.draft_node_id === 'draft:image-1').map((row) => row.id), [image.body.data.id, secondImage.body.data.id]);
    assert.equal(restored.body.data.generated_videos.find((row) => row.id === video.body.data.video_generation_id).draft_node_id, 'draft:video-1');
    // 普通模式携带 draft_node_id 不报错（透传由服务层按 source_context 过滤，见单元测试）
    assert.equal((await f.request('POST', '/omni-video-jobs', { source_context: 'single_video_tool', idempotency_key: 'single-draft', prompt: '单视频', model: 'fixture-video', duration: 4, resolution: '480p', aspect_ratio: '16:9', assets: [], draft_node_id: 'draft:ignored' }, cookie)).status, 201);
  } finally { t.mock.restoreAll(); await f.close(); }
});
