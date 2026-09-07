const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const auth = require('../src/services/authService');
const aiClient = require('../src/services/aiClient');
const imageClient = require('../src/services/imageClient');

test('authenticated batch and direct-id APIs stay inside the caller project', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minidrama-ownership-'));
  const previousCwd = process.cwd();
  const cfg = {
    app: { language: 'zh' }, database: { path: path.join(root, 'test.db'), type: 'sqlite' },
    storage: { type: 'local', local_path: path.join(root, 'storage') },
    payments: { enabled: false }, server: {},
  };
  fs.writeFileSync(path.join(root, 'config.yaml'), JSON.stringify(cfg));
  process.chdir(root);
  const log = { info() {}, warn() {}, error() {}, infow() {}, warnw() {} };
  const { setupRouter } = require('../src/routes');
  const ttsService = require('../src/services/ttsService');
  const characterLibraryService = require('../src/services/characterLibraryService');
  const originalSynthesize = ttsService.synthesize;
  const originalBatch = characterLibraryService.batchGenerateCharacterImages;
  const originalGenerateText = aiClient.generateText;
  const originalCreateAndGenerateImage = imageClient.createAndGenerateImage;
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

  async function request(method, route, body, cookie) {
    const result = await fetch(base + route, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: result.status,
      body: await result.json(),
      cookie: result.headers.get('set-cookie')?.split(';')[0],
    };
  }

  async function waitForTask(taskId, cookie, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await request('GET', `/tasks/${taskId}`, undefined, cookie);
      if (result.status === 200 && ['completed', 'failed'].includes(result.body.data?.status)) {
        return result.body.data;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`task ${taskId} did not reach a terminal status`);
  }

  try {
    await start();
    const userA = auth.createUser(db, { username: 'isolation-a', password: 'test-password' }, null);
    const userB = auth.createUser(db, { username: 'isolation-b', password: 'test-password' }, null);
    const consoleAdmin = auth.createUser(db, {
      username: 'library-console-admin', password: 'test-password', account_kind: 'platform_admin',
    }, null);
    const adminWithoutConsole = auth.createUser(db, { username: 'library-role-only', password: 'test-password' }, null);
    db.prepare("UPDATE users SET role = 'admin', console_access = 0, account_kind = 'creator' WHERE id = ?")
      .run(adminWithoutConsole.id);
    const loginA = await request('POST', '/auth/login', { username: userA.username, password: 'test-password' });
    const loginB = await request('POST', '/auth/login', { username: userB.username, password: 'test-password' });
    const loginConsoleAdmin = await request('POST', '/auth/login', { username: consoleAdmin.username, password: 'test-password' });
    const loginAdminWithoutConsole = await request('POST', '/auth/login', { username: adminWithoutConsole.username, password: 'test-password' });
    assert.equal(loginA.status, 200);
    assert.equal(loginB.status, 200);
    const cookieA = loginA.cookie;
    const cookieB = loginB.cookie;
    const consoleAdminCookie = loginConsoleAdmin.cookie;
    const adminWithoutConsoleCookie = loginAdminWithoutConsole.cookie;

    const now = new Date().toISOString();
    db.prepare(`INSERT INTO dramas (id, title, owner_user_id, created_at, updated_at)
      VALUES (101, 'A project', ?, ?, ?), (102, 'B project', ?, ?, ?)`).run(userA.id, now, now, userB.id, now, now);
    db.prepare(`INSERT INTO episodes (id, drama_id, episode_number, title, created_at, updated_at)
      VALUES (201, 101, 1, 'A episode', ?, ?), (202, 102, 1, 'B episode', ?, ?)`).run(now, now, now, now);
    db.prepare(`INSERT INTO storyboards (id, episode_id, storyboard_number, title, dialogue, characters, status, created_at, updated_at)
      VALUES (301, 201, 1, 'A shot', 'A dialogue', '[]', 'pending', ?, ?),
             (302, 202, 1, 'B shot', 'B dialogue', '[]', 'pending', ?, ?)`).run(now, now, now, now);
    db.prepare(`UPDATE storyboards SET
      text_model = 'text-rich', video_model = 'video-rich', video_resolution = '1080p',
      video_upscale_resolution = '4k', video_target_fps = 60, video_aspect_ratio = '9:16',
      generation_overrides_json = '{"duration":12}', continuity_snapshot = '{"lighting":"night"}',
      emotion = '紧张', emotion_intensity = 2, lighting_style = 'dramatic', depth_of_field = 'shallow',
      omni_asset_ids = '[901]', audio_strategy = 'post_mix', keep_original_audio = 1,
      audio_volume = 0.75, audio_fade_seconds = 0.4, omni_creation_mode = 'first_last_frame',
      omni_asset_send_policy = 'selected_only', omni_first_frame_asset_id = 901,
      omni_last_frame_asset_id = 901, omni_asset_usage_json = '{"901":"reference"}',
      omni_prompt_document_json = '{"text":"@图片1","refs":[{"asset_id":901}]}',
      layout_description = '站在窗边', local_path = 'videos/a.mp4', video_url = NULL,
      updated_at = ? WHERE id = 301`).run(now);
    db.prepare(`INSERT INTO characters (id, drama_id, name, role, appearance, personality, description, voice_style, created_at, updated_at)
      VALUES (401, 101, 'A character', 'lead', 'appearance', 'personality', 'description', 'voice', ?, ?),
             (402, 102, 'B character', ?, ?, ?, ?, ?, ?, ?)`).run(now, now, 'support', 'appearance-b', 'personality-b', 'description-b', 'voice-b', now, now);
    db.prepare(`INSERT INTO scenes (id, drama_id, episode_id, location, time, prompt, description, polished_prompt, polished_prompt_single, negative_prompt, created_at, updated_at)
      VALUES (411, 101, 201, 'A scene', 'day', 'scene prompt', 'scene description', 'QUAD-SAVED-PROMPT', 'SINGLE-SAVED-PROMPT', 'scene negative', ?, ?),
             (412, 102, 202, 'B scene', 'night', 'B scene prompt', 'B scene description', NULL, NULL, NULL, ?, ?)`).run(now, now, now, now);
    db.prepare(`INSERT INTO props (id, drama_id, episode_id, name, type, description, prompt, negative_prompt, created_at, updated_at)
      VALUES (501, 101, 201, 'A prop', 'tool', 'prop description', 'prop prompt', 'prop negative', ?, ?),
             (502, 102, 202, 'B prop', ?, ?, ?, ?, ?, ?)`).run(now, now, 'object', 'B prop description', 'B prop prompt', 'B prop negative', now, now);
    db.prepare("UPDATE episodes SET script_content = 'A script with existing resources.' WHERE id = 201").run();
    db.prepare('INSERT INTO episode_characters (episode_id, character_id) VALUES (201, 401)').run();
    db.prepare(`INSERT INTO assets (id, owner_user_id, name, type, source_type, local_path, processing_status, created_at, updated_at)
      VALUES (901, ?, 'A media', 'image', 'upload', 'library/images/a-owned.png', 'ready', ?, ?),
             (902, ?, 'B media', 'image', 'upload', 'library/images/b-owned.png', 'ready', ?, ?)`).run(userA.id, now, now, userB.id, now, now);
    db.prepare(`INSERT INTO character_libraries (id, drama_id, name, created_at, updated_at)
      VALUES (601, 101, 'A library character', ?, ?), (602, NULL, 'Shared character', ?, ?)`).run(now, now, now, now);
    db.prepare(`INSERT INTO scene_libraries (id, drama_id, location, created_at, updated_at)
      VALUES (611, 101, 'A library scene', ?, ?), (612, NULL, 'Shared scene', ?, ?)`).run(now, now, now, now);
    db.prepare(`INSERT INTO prop_libraries (id, drama_id, name, created_at, updated_at)
      VALUES (621, 101, 'A library prop', ?, ?), (622, NULL, 'Shared prop', ?, ?)`).run(now, now, now, now);
    db.prepare(`UPDATE character_libraries SET category = 'lead', description = 'library description', tags = 'library tags', image_url = 'library-image', local_path = 'library-path' WHERE id = 601`).run();
    db.prepare(`UPDATE scene_libraries SET category = 'interior', time = 'library time', prompt = 'library prompt', description = 'library description', tags = 'library tags', image_url = 'library-image', local_path = 'library-path' WHERE id = 611`).run();
    db.prepare(`UPDATE prop_libraries SET category = 'hand', description = 'library description', prompt = 'library prompt', tags = 'library tags', image_url = 'library-image', local_path = 'library-path' WHERE id = 621`).run();

    async function assertStoryboardResponseContract() {
      const dramaResponse = await request('GET', '/dramas/101', undefined, cookieA);
      const storyboardResponse = await request('GET', '/storyboards/301', undefined, cookieA);
      assert.equal(dramaResponse.status, 200, JSON.stringify(dramaResponse.body));
      assert.equal(storyboardResponse.status, 200, JSON.stringify(storyboardResponse.body));
      const fromDrama = dramaResponse.body.data.episodes.find((episode) => episode.id === 201)?.storyboards?.find((storyboard) => storyboard.id === 301);
      const direct = storyboardResponse.body.data;
      assert.ok(fromDrama, 'project detail should include the persisted storyboard');
      for (const field of [
        'video_model', 'video_resolution', 'video_upscale_resolution', 'video_target_fps', 'video_aspect_ratio',
        'generation_overrides', 'omni_asset_ids', 'audio_strategy', 'keep_original_audio', 'audio_volume',
        'audio_fade_seconds', 'omni_creation_mode', 'omni_asset_send_policy', 'omni_first_frame_asset_id',
        'omni_last_frame_asset_id', 'omni_asset_usage', 'omni_prompt_document', 'layout_description',
        'continuity_snapshot', 'emotion', 'emotion_intensity', 'lighting_style', 'depth_of_field',
      ]) {
        assert.deepEqual(fromDrama[field], direct[field], `project detail field ${field}`);
      }
      assert.equal(fromDrama.video_url, '/static/videos/a.mp4');
      assert.equal(direct.video_url, '/static/videos/a.mp4');
    }

    // A persisted storyboard must expose the same generation settings and
    // material references through the project and direct detail endpoints.
    await assertStoryboardResponseContract();

    // D07: the explicit single/quad selector must choose the matching scene
    // prompt. An omitted selector preserves the historical quad default.
    const imageCalls = [];
    imageClient.createAndGenerateImage = (_db, _log, opts) => {
      imageCalls.push(opts);
      return { id: imageCalls.length, task_id: `mock-image-${imageCalls.length}`, status: 'pending' };
    };
    const singleImage = await request('POST', '/scenes/generate-image', { scene_id: 411, mode: 'single' }, cookieA);
    const explicitQuadImage = await request('POST', '/scenes/generate-image', { scene_id: 411, mode: 'quad' }, cookieA);
    const legacyDefaultImage = await request('POST', '/scenes/generate-image', { scene_id: 411 }, cookieA);
    assert.equal(singleImage.status, 200, JSON.stringify(singleImage.body));
    assert.equal(explicitQuadImage.status, 200, JSON.stringify(explicitQuadImage.body));
    assert.equal(legacyDefaultImage.status, 200, JSON.stringify(legacyDefaultImage.body));
    assert.deepEqual(imageCalls.map((call) => call.prompt), [
      'SINGLE-SAVED-PROMPT',
      'QUAD-SAVED-PROMPT',
      'QUAD-SAVED-PROMPT',
    ]);
    imageClient.createAndGenerateImage = originalCreateAndGenerateImage;

    // D06: JSON null clears nullable text fields, while an omitted property
    // leaves its previous value unchanged for all project resource types.
    const characterCleared = await request('PUT', '/characters/401', {
      role: null, appearance: null, personality: null, description: null, voice_style: null,
    }, cookieA);
    assert.equal(characterCleared.status, 200, JSON.stringify(characterCleared.body));
    const clearedCharacter = db.prepare('SELECT role, appearance, personality, description, voice_style FROM characters WHERE id = 401').get();
    assert.deepEqual(clearedCharacter, { role: null, appearance: null, personality: null, description: null, voice_style: null });
    await request('PUT', '/characters/401', {
      role: 'retained role', appearance: 'retained appearance', personality: 'retained personality',
      description: 'retained description', voice_style: 'retained voice',
    }, cookieA);
    const characterPartialClear = await request('PUT', '/characters/401', { appearance: null }, cookieA);
    assert.equal(characterPartialClear.status, 200, JSON.stringify(characterPartialClear.body));
    assert.deepEqual(db.prepare('SELECT role, appearance, personality, description, voice_style FROM characters WHERE id = 401').get(), {
      role: 'retained role', appearance: null, personality: 'retained personality',
      description: 'retained description', voice_style: 'retained voice',
    });

    const sceneCleared = await request('PUT', '/scenes/411', {
      location: null, time: null, prompt: null, description: null, polished_prompt: null,
      polished_prompt_single: null, negative_prompt: null,
    }, cookieA);
    assert.equal(sceneCleared.status, 200, JSON.stringify(sceneCleared.body));
    assert.deepEqual(db.prepare('SELECT location, time, prompt, description, polished_prompt, polished_prompt_single, negative_prompt FROM scenes WHERE id = 411').get(), {
      location: null, time: null, prompt: null, description: null, polished_prompt: null,
      polished_prompt_single: null, negative_prompt: null,
    });
    await request('PUT', '/scenes/411', { location: 'retained location', time: 'retained time', prompt: 'retained prompt', description: 'retained description' }, cookieA);
    const scenePartialClear = await request('PUT', '/scenes/411', { prompt: null }, cookieA);
    assert.equal(scenePartialClear.status, 200, JSON.stringify(scenePartialClear.body));
    assert.deepEqual(db.prepare('SELECT location, time, prompt, description FROM scenes WHERE id = 411').get(), {
      location: 'retained location', time: 'retained time', prompt: null, description: 'retained description',
    });

    const propCleared = await request('PUT', '/props/501', {
      type: null, description: null, prompt: null, negative_prompt: null,
    }, cookieA);
    assert.equal(propCleared.status, 200, JSON.stringify(propCleared.body));
    assert.deepEqual(db.prepare('SELECT type, description, prompt, negative_prompt FROM props WHERE id = 501').get(), {
      type: null, description: null, prompt: null, negative_prompt: null,
    });
    await request('PUT', '/props/501', { type: 'retained type', description: 'retained description', prompt: 'retained prompt' }, cookieA);
    const propPartialClear = await request('PUT', '/props/501', { description: null }, cookieA);
    assert.equal(propPartialClear.status, 200, JSON.stringify(propPartialClear.body));
    assert.deepEqual(db.prepare('SELECT type, description, prompt FROM props WHERE id = 501').get(), {
      type: 'retained type', description: null, prompt: 'retained prompt',
    });

    for (const [route, id, clearField, table, retainedField] of [
      ['/character-library', 601, 'description', 'character_libraries', 'tags'],
      ['/scene-library', 611, 'description', 'scene_libraries', 'tags'],
      ['/prop-library', 621, 'description', 'prop_libraries', 'tags'],
    ]) {
      const cleared = await request('PUT', `${route}/${id}`, { [clearField]: null, [retainedField]: 'retained tags' }, cookieA);
      assert.equal(cleared.status, 200, `${route} null clear: ${JSON.stringify(cleared.body)}`);
      assert.deepEqual(db.prepare(`SELECT ${clearField}, ${retainedField} FROM ${table} WHERE id = ?`).get(id), {
        [clearField]: null, [retainedField]: 'retained tags',
      });
      const omitted = await request('PUT', `${route}/${id}`, { [clearField]: 'retained description' }, cookieA);
      assert.equal(omitted.status, 200, `${route} omitted field: ${JSON.stringify(omitted.body)}`);
      assert.equal(db.prepare(`SELECT ${retainedField} FROM ${table} WHERE id = ?`).get(id)[retainedField], 'retained tags');
    }

    // B08: an empty extraction is terminally failed and leaves all existing
    // episode resources untouched, so users can retry without data loss.
    aiClient.generateText = async () => '[]';
    const characterExtraction = await request('POST', '/generation/characters', { drama_id: 101, episode_id: 201 }, cookieA);
    const sceneExtraction = await request('POST', '/images/episode/201/backgrounds/extract', {}, cookieA);
    const propExtraction = await request('POST', '/episodes/201/props/extract', {}, cookieA);
    assert.equal(characterExtraction.status, 200, JSON.stringify(characterExtraction.body));
    assert.equal(sceneExtraction.status, 200, JSON.stringify(sceneExtraction.body));
    assert.equal(propExtraction.status, 200, JSON.stringify(propExtraction.body));
    const [characterTask, sceneTask, propTask] = await Promise.all([
      waitForTask(characterExtraction.body.data.task_id, cookieA),
      waitForTask(sceneExtraction.body.data.task_id, cookieA),
      waitForTask(propExtraction.body.data.task_id, cookieA),
    ]);
    assert.equal(characterTask.status, 'failed');
    assert.equal(sceneTask.status, 'failed');
    assert.equal(propTask.status, 'failed');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM characters WHERE id = 401 AND deleted_at IS NULL').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM scenes WHERE id = 411 AND deleted_at IS NULL').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM props WHERE id = 501 AND deleted_at IS NULL').get().count, 1);
    aiClient.generateText = originalGenerateText;
    // Historical rows created without drama_id must remain readable through
    // their valid episode's project after the ownership hardening.
    db.prepare(`INSERT INTO video_merges
      (id, episode_id, drama_id, title, provider, status, scenes, task_id, created_at, deleted_at)
      VALUES (701, 201, 0, 'Legacy A merge', 'ffmpeg', 'completed', '[]', NULL, '2020-01-01T00:00:00.000Z', NULL)`).run();

    for (const [route, id, field, table, expected] of [
      ['/character-library', 601, 'name', 'character_libraries', 'A library character'],
      ['/scene-library', 611, 'location', 'scene_libraries', 'A library scene'],
      ['/prop-library', 621, 'name', 'prop_libraries', 'A library prop'],
    ]) {
      assert.equal((await request('GET', `${route}/${id}`, undefined, cookieA)).status, 200, `${route} own read`);
      assert.equal((await request('GET', `${route}/${id}`, undefined, cookieB)).status, 404, `${route} cross read`);
      assert.equal((await request('PUT', `${route}/${id}`, { [field]: 'blocked' }, cookieB)).status, 404, `${route} cross update`);
      assert.equal((await request('DELETE', `${route}/${id}`, undefined, cookieB)).status, 404, `${route} cross delete`);
      assert.equal(db.prepare(`SELECT ${field} FROM ${table} WHERE id = ?`).get(id)[field], expected);
    }
    for (const [route, id] of [['/character-library', 602], ['/scene-library', 612], ['/prop-library', 622]]) {
      assert.equal((await request('GET', `${route}/${id}`, undefined, cookieB)).status, 200, `${route} shared read`);
      assert.equal((await request('PUT', `${route}/${id}`, { name: 'blocked' }, cookieB)).status, 404, `${route} shared update`);
      assert.equal((await request('DELETE', `${route}/${id}`, undefined, cookieB)).status, 404, `${route} shared delete`);
    }
    for (const route of ['/character-library', '/scene-library', '/prop-library']) {
      const listed = await request('GET', route, undefined, cookieB);
      assert.equal(listed.status, 200, `${route} list`);
      assert.ok(listed.body.data.items.every((item) => item.drama_id == null || item.drama_id === 102), `${route} list scope`);
    }
    assert.equal((await request('POST', '/character-library', { name: 'forbidden global' }, cookieB)).status, 403);
    assert.equal((await request('POST', '/character-library', { name: 'role-only global' }, adminWithoutConsoleCookie)).status, 403);
    const adminGlobal = await request('POST', '/character-library', { name: 'console global' }, consoleAdminCookie);
    assert.equal(adminGlobal.status, 201);
    assert.equal((await request('PUT', '/character-library/602', { name: 'Admin shared update' }, consoleAdminCookie)).status, 200);
    assert.equal((await request('DELETE', `/character-library/${adminGlobal.body.data.id}`, undefined, consoleAdminCookie)).status, 200);
    assert.equal((await request('POST', '/character-library', { drama_id: 101, name: 'A created' }, cookieA)).status, 201);
    assert.equal((await request('POST', '/character-library', { drama_id: 101, name: 'cross project' }, cookieB)).status, 404);

    let ttsCalls = [];
    ttsService.synthesize = async (_db, _log, input) => {
      ttsCalls.push(input.storyboard_id);
      return { local_path: `library/audio/${input.storyboard_id}.mp3` };
    };
    assert.equal((await request('POST', '/audio/extract/batch', { storyboard_ids: [301, 302] }, cookieA)).status, 404);
    assert.deepEqual(ttsCalls, []);
    assert.equal((await request('POST', '/audio/extract/batch', { storyboard_ids: [301] }, cookieA)).status, 200);
    assert.deepEqual(ttsCalls, [301]);
    assert.equal(db.prepare('SELECT audio_local_path FROM storyboards WHERE id = 301').get().audio_local_path, 'library/audio/301.mp3');
    assert.equal((await request('POST', '/audio/extract/batch', { storyboard_ids: [301, 301] }, cookieA)).status, 200);
    assert.deepEqual(ttsCalls, [301, 301], 'duplicate storyboard IDs synthesize once after de-duplication');
    const overLimitIds = Array.from({ length: 11 }, () => 301);
    assert.equal((await request('POST', '/audio/extract/batch', { storyboard_ids: overLimitIds }, cookieA)).status, 400);
    assert.deepEqual(ttsCalls, [301, 301], 'over-limit batch must not invoke TTS');

    let imageBatchCalls = [];
    characterLibraryService.batchGenerateCharacterImages = (_db, _log, _cfg, ids) => {
      imageBatchCalls.push(ids);
      return { ok: true, count: ids.length };
    };
    assert.equal((await request('POST', '/characters/batch-generate-images', { character_ids: [401, 402] }, cookieA)).status, 404);
    assert.deepEqual(imageBatchCalls, []);
    assert.equal((await request('POST', '/characters/batch-generate-images', { character_ids: [401] }, cookieA)).status, 200);
    assert.deepEqual(imageBatchCalls, [[401]]);

    const mergeA = await request('POST', '/video-merges', {
      episode_id: 201, drama_id: 101, title: 'A merge', scenes: [],
    }, cookieA);
    assert.equal(mergeA.status, 200);
    const mergeAId = mergeA.body.data.merge_id;
    assert.equal((await request('GET', `/video-merges/${mergeAId}`, undefined, cookieA)).status, 200);
    assert.equal((await request('GET', `/video-merges/${mergeAId}`, undefined, cookieB)).status, 404);
    assert.equal((await request('DELETE', `/video-merges/${mergeAId}`, undefined, cookieB)).status, 404);
    assert.equal((await request('POST', '/video-merges', { episode_id: 201, drama_id: 101, scenes: [] }, cookieB)).status, 404);
    const mergeB = await request('POST', '/video-merges', {
      episode_id: 202, drama_id: 102, title: 'B merge', scenes: [],
    }, cookieB);
    assert.equal(mergeB.status, 200);
    const listA = await request('GET', '/video-merges', undefined, cookieA);
    const listB = await request('GET', '/video-merges', undefined, cookieB);
    assert.equal(listA.status, 200);
    assert.deepEqual(listA.body.data.map((item) => item.id), [mergeAId, 701]);
    assert.deepEqual(listB.body.data.map((item) => item.id), [mergeB.body.data.merge_id]);

    assert.equal((await request('POST', '/storyboards/301/props', { prop_ids: [501, 502] }, cookieA)).status, 400);
    assert.deepEqual(db.prepare('SELECT prop_id FROM storyboard_props WHERE storyboard_id = 301').all(), []);
    assert.equal((await request('POST', '/storyboards/301/props', { prop_ids: [501] }, cookieA)).status, 200);
    assert.deepEqual(db.prepare('SELECT prop_id FROM storyboard_props WHERE storyboard_id = 301').all().map((row) => row.prop_id), [501]);
    assert.equal((await request('PUT', '/storyboards/301', { prop_ids: [502] }, cookieA)).status, 400);
    assert.equal((await request('PUT', '/storyboards/301', { character_ids: [401, 402] }, cookieA)).status, 400);
    assert.equal((await request('PUT', '/storyboards/301', { character_ids: [401] }, cookieA)).status, 200);

    const asset = await request('POST', '/assets', {
      drama_id: 101, name: 'safe asset', type: 'image', url: '', local_path: 'library/images/safe.png',
    }, cookieA);
    assert.equal(asset.status, 201);
    const assetId = asset.body.data.id;
    assert.equal((await request('POST', '/assets', {
      name: 'cross-owned media', type: 'image', local_path: 'library/images/a-owned.png',
    }, cookieB)).status, 403);
    assert.equal((await request('PUT', '/storyboards/301', {
      local_path: 'library/images/b-owned.png', image_url: '/static/library/images/b-owned.png',
    }, cookieA)).status, 403);
    assert.equal((await request('PUT', '/storyboards/301', {
      local_path: '../outside.png',
    }, cookieA)).status, 400);
    for (const badPath of ['../outside.png', '/absolute/outside.png', 'C:\\outside.png']) {
      assert.equal((await request('POST', '/assets', {
        drama_id: 101, name: 'bad asset', type: 'image', url: '', local_path: badPath,
      }, cookieA)).status, 400, badPath);
      assert.equal((await request('PUT', `/assets/${assetId}`, { local_path: badPath }, cookieA)).status, 400, badPath);
      assert.equal((await request('PUT', `/assets/${assetId}`, { thumbnail_local_path: badPath }, cookieA)).status, 400, `thumbnail ${badPath}`);
    }
    assert.equal((await request('PUT', `/assets/${assetId}`, { local_path: 'library/images/updated.png' }, cookieA)).status, 200);
    assert.equal((await request('GET', `/assets/${assetId}`, undefined, cookieB)).status, 404);

    await stop();
    await start();
    await assertStoryboardResponseContract();
    assert.equal((await request('GET', `/assets/${assetId}`, undefined, cookieA)).status, 200);
    assert.equal((await request('GET', '/character-library/601', undefined, cookieA)).status, 200);
    assert.equal((await request('GET', '/scene-library/611', undefined, cookieA)).status, 200);
    assert.equal((await request('GET', '/prop-library/621', undefined, cookieA)).status, 200);
    assert.equal((await request('GET', '/characters/401', undefined, cookieA)).status, 200);
    assert.equal((await request('GET', '/scenes/411', undefined, cookieA)).status, 200);
    assert.equal((await request('GET', '/props/501', undefined, cookieA)).status, 200);
    assert.equal((await request('GET', `/tasks/${characterTask.id}`, undefined, cookieA)).body.data.status, 'failed');
    assert.equal((await request('GET', `/tasks/${sceneTask.id}`, undefined, cookieA)).body.data.status, 'failed');
    assert.equal((await request('GET', `/tasks/${propTask.id}`, undefined, cookieA)).body.data.status, 'failed');
    assert.deepEqual(db.prepare('SELECT role, appearance, personality, description, voice_style FROM characters WHERE id = 401').get(), {
      role: 'retained role', appearance: null, personality: 'retained personality',
      description: 'retained description', voice_style: 'retained voice',
    });
    assert.deepEqual(db.prepare('SELECT location, time, prompt, description FROM scenes WHERE id = 411').get(), {
      location: 'retained location', time: 'retained time', prompt: null, description: 'retained description',
    });
    assert.deepEqual(db.prepare('SELECT type, description, prompt FROM props WHERE id = 501').get(), {
      type: 'retained type', description: null, prompt: 'retained prompt',
    });
    for (const [table, id] of [['character_libraries', 601], ['scene_libraries', 611], ['prop_libraries', 621]]) {
      assert.deepEqual(db.prepare(`SELECT description, tags FROM ${table} WHERE id = ?`).get(id), {
        description: 'retained description', tags: 'retained tags',
      });
    }
    assert.equal((await request('GET', '/video-merges/701', undefined, cookieA)).status, 200);
  } finally {
    ttsService.synthesize = originalSynthesize;
    characterLibraryService.batchGenerateCharacterImages = originalBatch;
    aiClient.generateText = originalGenerateText;
    imageClient.createAndGenerateImage = originalCreateAndGenerateImage;
    await stop();
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
