const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { modelCatalogFixture } = require('./helpers/modelCatalogFixture');
const configs = require('../src/services/aiConfigService');
const billing = require('../src/services/billingService');
const prices = require('../src/services/costPriceService');
const ledger = require('../src/services/costLedgerService');

test('project HTTP routes record image, TTS, video, upscale and interpolation attempts and restore without resubmitting', async () => {
  const fixture = await modelCatalogFixture();
  const { db, admin, log } = fixture;
  const seen = [];
  let provider;
  let base;
  let generationSubmits = 0;
  let disconnectSpeech = false;
  try {
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'blue' } }).png().toBuffer();
    const media = {};
    for (const [name, size, fps] of [['source','640x360',24], ['upscale','1280x720',24], ['interpolation','1280x720',60]]) {
      const file = path.join(fixture.root, name + '.mp4');
      const result = spawnSync(require('../src/utils/ffmpegPath').getFfmpegPath(), ['-v','error','-f','lavfi','-i',`color=c=blue:s=${size}:r=${fps}:d=1`,'-c:v','libx264','-pix_fmt','yuv420p',file], { windowsHide: true, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      media[`/${name}.mp4`] = fs.readFileSync(file);
    }
    provider = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        seen.push(req.url);
        if (media[req.url]) { res.writeHead(200, { 'content-type': 'video/mp4' }); res.end(media[req.url]); return; }
        if (req.url === '/upload') { res.writeHead(200); res.end(); return; }
        if (req.url.includes('request-media-upload-url')) { res.setHeader('content-type','application/json'); res.end(JSON.stringify({ result: { upload_url: base + '/upload', file_id: 'fake-file' } })); return; }
        if (req.method === 'GET' && req.url.startsWith('/api/v1/tasks/')) {
          const kind = req.url.includes('upscale') ? 'upscale' : 'interpolation';
          res.setHeader('content-type','application/json'); res.end(JSON.stringify({ status: 'completed', request_id: `${kind}-request`, result: { video_url: `${base}/${kind}.mp4` } })); return;
        }
        generationSubmits++;
        assert.ok(db.prepare('SELECT COUNT(*) n FROM cost_calls').get().n >= generationSubmits, 'persist attempt before the supplier receives bytes');
        if (req.url === '/audio/speech') {
          if (disconnectSpeech) { disconnectSpeech = false; req.socket.destroy(); return; }
          res.writeHead(200, { 'content-type': 'audio/mpeg', 'x-request-id': 'fake-speech-request' });
          res.end(Buffer.from('isolated audio result'));
        } else if (req.url.endsWith('/contents/generations/tasks')) {
          res.setHeader('content-type','application/json'); res.end(JSON.stringify({ video_url: base + '/source.mp4', usage: { completion_tokens: 1000 } }));
        } else if (req.url.includes('enhance-video-generative') || req.url.includes('video-frame-interpolation')) {
          const kind = req.url.includes('enhance') ? 'upscale' : 'interpolation';
          res.setHeader('content-type','application/json'); res.end(JSON.stringify({ task_id: `${kind}-task`, request_id: `${kind}-submit` }));
        } else {
          res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'fake-image-request' });
          const url = `data:image/png;base64,${png.toString('base64')}`;
          res.end(JSON.stringify({ data: [{ url }, { url }] }));
        }
      });
    });
    provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
    base = `http://127.0.0.1:${provider.address().port}`;
    const image = configs.createConfig(db, log, { name: 'Cost fake image', service_type: 'image', provider: 'volcengine', api_protocol: 'volcengine', base_url: base, api_key: 'fake-only', model: ['fake-cost-image'], default_model: 'fake-cost-image', is_default: true });
    const tts = configs.createConfig(db, log, { name: 'Cost fake speech', service_type: 'tts', provider: 'openai', base_url: base, api_key: 'fake-only', model: ['fake-cost-tts'], default_model: 'fake-cost-tts', is_default: true });
    billing.savePriceBook(db, admin.id, { name: 'cost fake platform points', status: 'published', items: [{ service_type: 'image', model: 'fake-cost-image', meter: 'image', unit_price: 1 }, { service_type: 'tts', model: 'fake-cost-tts', meter: 'character', unit_price: 0.1 }] });
    const account = Number(db.prepare('INSERT INTO cost_accounts(name,provider,created_at,created_by) VALUES(?,?,?,?)').run('fake provider account', 'fixture', new Date().toISOString(), admin.id).lastInsertRowid);
    for (const [config, model, service, meter] of [[image, 'fake-cost-image', 'image', 'request'], [tts, 'fake-cost-tts', 'tts', 'character']]) {
      db.prepare('INSERT INTO cost_account_bindings VALUES(?,?,?)').run(config.id, account, new Date().toISOString());
      const draft = prices.saveDraft(db, admin.id, { account_id: account, model, service_type: service, source: 'fake HTTP provider', effective_from: '2026-01-01T00:00:00Z', rules: [{ meter, price: '0.1', unit_size: '1' }] });
      prices.publish(db, admin.id, draft.id);
    }
    const cookie = (await fixture.request('POST', '/auth/login', { username: admin.username, password: 'fixture-password' })).cookie;
    const project = await fixture.request('POST', '/dramas', { title: 'cost HTTP fixture' }, cookie);
    assert.equal(project.status, 201);
    const submitted = await fixture.request('POST', '/images', { drama_id: project.body.data.id, model: 'fake-cost-image', prompt: 'blue square', size: '32x32', idempotency_key: 'cost-image-1' }, cookie);
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
    let result;
    for (let n = 0; n < 100; n++) {
      result = await fixture.request('GET', `/images/${submitted.body.data.id}`, undefined, cookie);
      if (['completed','failed'].includes(result.body.data?.status)) break;
      await delay(30);
    }
    assert.equal(result.body.data.status, 'completed', result.body.data.error_msg);
    const imageCall = db.prepare("SELECT id FROM cost_calls WHERE service_type='image'").get();
    const observed = ledger.get(db, imageCall.id).revisions.at(-1);
    assert.equal(observed.usage.image, 2);
    assert.equal(observed.usage.request, 1);
    assert.equal(observed.amount_micro, 100000, 'one request price regardless of returned image count');
    const speech = await fixture.request('POST', '/audio/extract', { text: '你好🙂' }, cookie);
    assert.equal(speech.status, 200, JSON.stringify(speech.body));
    const speechCall = db.prepare("SELECT id FROM cost_calls WHERE service_type='tts'").get();
    const speechCost = ledger.get(db, speechCall.id);
    assert.equal(speechCost.provider_request_id, 'fake-speech-request');
    assert.equal(speechCost.revisions.at(-1).usage.character, 3);
    assert.equal(speechCost.revisions.at(-1).amount_micro, 300000);
    // Failure before an attempt is durable prevents any HTTP supplier submit.
    db.exec("CREATE TRIGGER cost_write_failure BEFORE INSERT ON cost_calls BEGIN SELECT RAISE(ABORT, 'fixture cost persistence failure'); END");
    const rejected = await fixture.request('POST', '/audio/extract', { text: '应在调用前失败' }, cookie);
    assert.equal(rejected.status, 500);
    assert.equal(seen.length, 2);
    db.exec('DROP TRIGGER cost_write_failure');
    const videoModel = 'doubao-seedance-1-0-pro-250528';
    const upscaleModel = 'volcengine-video-generative-enhancement', interpolationModel = 'volcengine-video-frame-interpolation';
    const videoConfig = configs.createConfig(db, log, { name: 'Cost fake video', service_type: 'video', provider: 'volcengine', api_protocol: 'volcengine', base_url: base, endpoint: '/v1/videos/generations', api_key: 'fake-only', model: [videoModel], default_model: videoModel, is_default: true });
    const postConfig = configs.createConfig(db, log, { name: 'Cost fake postprocess', service_type: 'video_postprocess', provider: 'volcengine_mediakit', base_url: base, api_key: 'fake-only', model: [upscaleModel, interpolationModel], default_model: upscaleModel, is_default: true });
    billing.savePriceBook(db, admin.id, { name: 'cost fake video platform', status: 'published', items: [{ service_type: 'video', model: videoModel, meter: 'request', unit_price: 1 }] });
    billing.adjustBalance(db, admin.id, admin.id, 100000, 'isolated video stages');
    for (const config of [videoConfig, postConfig]) db.prepare('INSERT INTO cost_account_bindings VALUES(?,?,?)').run(config.id, account, new Date().toISOString());
    for (const [model, service, meter, unit] of [[videoModel,'video','output_token','1000'], [upscaleModel,'video_postprocess','millisecond','1000'], [interpolationModel,'video_postprocess','millisecond','1000']]) {
      const price = prices.saveDraft(db, admin.id, { account_id: account, model, service_type: service, source: 'fake HTTP provider', effective_from: '2026-01-01T00:00:00Z', rules: [{ meter, price: '0.1', unit_size: unit }] });
      prices.publish(db, admin.id, price.id);
    }
    const video = await fixture.request('POST', '/videos', { drama_id: project.body.data.id, model: videoModel, prompt: 'blue video', duration: 5, aspect_ratio: '16:9', resolution: '480p', upscale_resolution: '720p', target_fps: 60, idempotency_key: 'cost-all-stages' }, cookie);
    assert.equal(video.status, 201, JSON.stringify(video.body));
    let videoRow;
    for (let n = 0; n < 200; n++) {
      videoRow = db.prepare('SELECT * FROM video_generations WHERE id=?').get(video.body.data.id);
      if (['completed','failed'].includes(videoRow.status)) break;
      await delay(50);
    }
    assert.equal(videoRow.status, 'completed', videoRow.error_msg);
    assert.equal(generationSubmits, 5);
    const videoCost = db.prepare("SELECT c.id,r.usage_json FROM cost_calls c JOIN cost_revisions r ON c.latest_revision_id=r.id WHERE c.service_type='video'").get();
    assert.equal(JSON.parse(videoCost.usage_json).output_token, 1000);
    const stages = db.prepare("SELECT c.id,r.usage_json,r.cost_status FROM cost_calls c JOIN cost_revisions r ON c.latest_revision_id=r.id WHERE c.service_type='video_postprocess'").all();
    assert.equal(stages.length, 2);
    assert.ok(stages.every(row => JSON.parse(row.usage_json).millisecond === 1000 && row.cost_status === 'calculated'));
    disconnectSpeech = true;
    assert.equal((await fixture.request('POST', '/audio/extract', { text: '结果不明' }, cookie)).status, 500);
    const unknown = db.prepare("SELECT id FROM cost_calls WHERE status='unknown'").get();
    assert.ok(unknown);
    assert.equal(ledger.get(db, unknown.id).revisions.at(-1).cost_status, 'unverified');
    assert.equal(generationSubmits, 6, 'network uncertainty must not resubmit');
    db.exec("CREATE TRIGGER cost_observation_failure BEFORE INSERT ON cost_revisions BEGIN SELECT RAISE(ABORT, 'fixture observation persistence failure'); END");
    assert.equal((await fixture.request('POST', '/audio/extract', { text: '用量保存失败' }, cookie)).status, 200, 'successful generation survives observation persistence failure');
    db.exec('DROP TRIGGER cost_observation_failure');
    assert.equal(generationSubmits, 7);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cost_calls WHERE latest_revision_id IS NULL').get().n, 1);
    const requestsBeforeRestart = seen.length;
    await fixture.restart();
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM cost_calls').get().n, 7);
    assert.equal(seen.length, requestsBeforeRestart, 'restart and reading never resubmit suppliers');
  } finally {
    if (provider) await new Promise(resolve => provider.close(resolve));
    await fixture.close();
  }
});
