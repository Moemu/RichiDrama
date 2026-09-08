const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const sharp = require('sharp');
const { modelCatalogFixture } = require('./helpers/modelCatalogFixture');
const { model, activation } = require('./helpers/seedreamProPrices');
const prices = require('../src/services/providerPriceService');
const billing = require('../src/services/billingService');
const configs = require('../src/services/aiConfigService');
const pro = require('../src/services/seedreamProPricing');

// The production adapters use loadConfig as well as the router's config.
// Override its storage/profile so this fixture cannot write production media.
process.env.MINIDRAMA_PROFILE = 'dev';
process.env.CFG_STORAGE__TYPE = 'local';

async function configure(f, baseUrl = 'http://supplier.invalid') {
  process.env.CFG_STORAGE__LOCAL_PATH = path.join(f.root, 'storage');
  configs.createConfig(f.db, f.log, { service_type: 'image', provider: 'volcengine', name: 'Pro fixture', model, billing_key: model, base_url: baseUrl, api_key: 'fixture-only' });
  const rows = prices.buildCandidateRows(f.db, activation);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.mapping_status === 'mapped'));
  const items = rows.map(row => ({ service_type: row.service_type, model: row.billing_key, meter: row.meter, unit_price: row.new_unit_price_micro / 10000, conditions_json: JSON.parse(row.new_conditions_json) }));
  const session = await f.request('POST', '/auth/login', { username: f.admin.username, password: 'fixture-password' });
  assert.equal(session.status, 200);
  const cookie = session.cookie;
  const book = await f.request('POST', '/admin/price-books', { name: 'Seedream Pro fixture', status: 'published', items }, cookie);
  assert.equal(book.status, 201, JSON.stringify(book.body));
  billing.adjustBalance(f.db, f.admin.id, f.admin.id, 1000, 'isolated test');
  return { cookie, items, book: book.body.data };
}

test('Seedream Pro maps all five account prices and quotes pixel boundaries and per-request free inputs over HTTP', async () => {
  const f = await modelCatalogFixture();
  try {
    const { cookie, items } = await configure(f);
    assert.equal(items.find(item => item.meter === 'input_image').unit_price, 1.2);
    assert.deepEqual(items.find(item => item.meter === 'image').conditions_json.rates.map(rate => rate.unit_price_points), [18, 36, 9, 18]);
    assert.equal(prices.buildCandidateRows(f.db, { ...activation, MultiChargeItems: [] }).length, 2);
    const missing = structuredClone(activation);
    missing.MultiChargeItems[0].ChargeItems = missing.MultiChargeItems[0].ChargeItems.filter(item => item.Type !== 'ToIPrompt');
    assert.ok(prices.buildCandidateRows(f.db, missing).every(row => row.mapping_status === 'unmapped'));
    for (const [size, layer, inputs, expected] of [
      ['1740x1500', false, 0, 18], ['1740x1500', false, 1, 18], ['1740x1500', false, 3, 20.4],
      ['1741x1500', false, 2, 37.2], ['1740x1500', true, 2, 10.2], ['1741x1500', true, 1, 18],
    ]) {
      const response = await f.request('POST', '/billing/quotes', { service_type: 'image', model, usage: { image: 1 }, pricing_context: pro.context({ size, layer_decomposition: layer, reference_images: Array(inputs).fill('fixture') }) }, cookie);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.data.amount, expected);
    }
    const missingContext = await f.request('POST', '/billing/quotes', { service_type: 'image', model, usage: { image: 1 } }, cookie);
    assert.equal(missingContext.status, 400);
    const batch = await f.request('POST', '/billing/resource-image-quotes', { model, count: 3, image_input_count: 3, size: '1024x1024', reference_images: ['one', 'two'] }, cookie);
    assert.equal(batch.status, 200, JSON.stringify(batch.body));
    assert.equal(batch.body.data.amount, 57.6);
    const partial = await f.request('POST', '/admin/price-books', { name: 'incomplete', items: [items[0]] }, cookie);
    assert.equal(partial.status, 400);
    await f.restart();
    const legacy = await f.request('POST', '/billing/quotes', { service_type: 'image', model: 'existing-image', usage: { image: 2 } }, cookie);
    assert.equal(legacy.body.data.amount, 2);
  } finally { await f.close(); }
});

test('Seedream Pro HTTP generation freezes final inputs, saves original pixels, settles once, and preserves results after restart', async () => {
  const f = await modelCatalogFixture();
  const png = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: 'red' } }).png().toBuffer();
  fs.mkdirSync(path.join(f.root, 'storage'), { recursive: true });
  fs.writeFileSync(path.join(f.root, 'storage', 'reference.png'), png);
  const reference = 'reference.png';
  const requests = [];
  let mode = 'success';
  const provider = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      requests.push(JSON.parse(raw));
      res.setHeader('content-type', 'application/json');
      res.setHeader('x-request-id', `pro-request-${requests.length}`);
      if (mode === 'unknown') { res.statusCode = 500; res.end('{}'); return; }
      res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
    });
  });
  try {
    provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
    const { cookie } = await configure(f, `http://127.0.0.1:${provider.address().port}/api/v3`);
    const project = await f.request('POST', '/dramas', { title: 'Pro billing fixture' }, cookie);
    assert.equal(project.status, 201, JSON.stringify(project.body));
    const dramaId = project.body.data.id;
    async function generate(key) {
      const created = await f.request('POST', '/images', { drama_id: dramaId, prompt: 'A red square', model, size: '1024x1024', reference_images: [reference, reference, reference], idempotency_key: key }, cookie);
      assert.equal(created.status, 201, JSON.stringify(created.body));
      let result;
      for (let attempt = 0; attempt < 150; attempt++) {
        result = await f.request('GET', `/images/${created.body.data.id}`, undefined, cookie);
        if (['completed', 'failed'].includes(result.body.data?.status)) return result.body.data;
        await delay(25);
      }
      assert.fail('image did not finish');
    }
    const result = await generate('pro-native-1');
    assert.equal(result.status, 'completed', result.error_msg);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].size, '1024x1024');
    assert.equal(requests[0].image.length, 3);
    assert.match(result.image_url, /^\/static\//);
    assert.ok(fs.existsSync(path.join(f.root, 'storage', result.local_path)));
    const record = f.db.prepare('SELECT * FROM image_generations WHERE id=?').get(result.id);
    const usage = f.db.prepare('SELECT * FROM billing_usage_logs WHERE authorization_id=?').get(record.billing_authorization_id);
    assert.equal(usage.charged_micro, 204000);
    assert.equal(usage.provider_request_id, 'pro-request-1');
    assert.deepEqual(JSON.parse(usage.usage_json), { image: 1, input_image: 3, image_size: '1024x1024' });
    assert.equal(f.db.prepare('SELECT status FROM billing_reconciliation_cases WHERE authorization_id=?').get(record.billing_authorization_id).status, 'resolved');
    assert.equal(billing.settleAuthorization(f.db, f.admin, record.billing_authorization_id, { usage: { image: 1 } }).reused, true);
    const at = new Date().toISOString();
    const characterId = Number(f.db.prepare('INSERT INTO characters(drama_id,name,polished_prompt,created_at,updated_at) VALUES (?,?,?,?,?)').run(dramaId, 'Fixture actor', 'A red square', at, at).lastInsertRowid);
    const character = await f.request('POST', `/characters/${characterId}/generate-image`, { model }, cookie);
    assert.equal(character.status, 200, JSON.stringify(character.body));
    const characterImageId = character.body.data.image_generation.id;
    let characterImage;
    for (let attempt = 0; attempt < 150; attempt++) {
      characterImage = (await f.request('GET', `/images/${characterImageId}`, undefined, cookie)).body.data;
      if (['completed', 'failed'].includes(characterImage?.status)) break;
      await delay(25);
    }
    assert.equal(characterImage.status, 'completed', characterImage.error_msg);
    assert.match(characterImage.image_url, /^\/static\//);
    const characterAuth = f.db.prepare('SELECT billing_authorization_id FROM image_generations WHERE id=?').get(characterImageId).billing_authorization_id;
    assert.equal(f.db.prepare('SELECT charged_micro FROM billing_usage_logs WHERE authorization_id=?').get(characterAuth).charged_micro, 180000);
    const prop = await f.request('POST', '/props', { drama_id: dramaId, name: 'Fixture prop', prompt: 'A red square' }, cookie);
    assert.equal(prop.status, 201, JSON.stringify(prop.body));
    const propTask = await f.request('POST', `/props/${prop.body.data.id}/generate`, { model }, cookie);
    assert.equal(propTask.status, 200, JSON.stringify(propTask.body));
    let propResult;
    for (let attempt = 0; attempt < 150; attempt++) {
      propResult = (await f.request('GET', `/tasks/${propTask.body.data.task_id}`, undefined, cookie)).body.data;
      if (['completed', 'failed'].includes(propResult?.status)) break;
      await delay(25);
    }
    assert.equal(propResult.status, 'completed', propResult.error);
    const propUsage = f.db.prepare("SELECT charged_micro FROM billing_usage_logs WHERE source_id=? AND service_type='image'").get(`prop_${prop.body.data.id}`);
    assert.equal(propUsage.charged_micro, 180000);
    mode = 'unknown';
    const failed = await generate('pro-native-unknown');
    assert.equal(failed.status, 'failed');
    const pendingId = f.db.prepare('SELECT billing_authorization_id FROM image_generations WHERE id=?').get(failed.id).billing_authorization_id;
    assert.equal(f.db.prepare('SELECT status FROM billing_reconciliation_cases WHERE authorization_id=?').get(pendingId).status, 'pending');
    assert.equal(f.db.prepare("SELECT COUNT(*) count FROM billing_transactions WHERE authorization_id=? AND type='void'").get(pendingId).count, 0);
    await delay(50);
    await f.restart();
    const restored = await f.request('GET', `/images/${result.id}`, undefined, cookie);
    assert.equal(restored.body.data.local_path, result.local_path);
    assert.equal(restored.body.data.status, 'completed');
    assert.equal(requests.length, 4);
    assert.equal(billing.recoverInterruptedImageReconciliations(f.db).recovered, 0);
    const layer = await f.request('POST', '/images', { drama_id: dramaId, model, layer_decomposition: true }, cookie);
    assert.equal(layer.status, 400);
    assert.equal(requests.length, 4);
  } finally { await new Promise(resolve => provider.close(resolve)); await f.close(); }
});

test('final image authorization preserves old prices, rolls back insufficient funds, and never re-dispatches after restart', async () => {
  const f = await modelCatalogFixture();
  try {
    await configure(f);
    const input = { service_type: 'image', model, usage: { image: 1 }, pricing_context: pro.context({ size: '1024x1024' }), idempotency_key: 'prepare-test' };
    const original = billing.createAuthorization(f.db, f.admin, input);
    const frozenBefore = billing.account(f.db, f.admin.id).frozen_micro;
    billing.setBalance(f.db, f.admin.id, f.admin.id, 18, 'isolated insufficient funds');
    assert.throws(() => billing.authorizeImageRequest(f.db, original.authorization_id, pro.context({ size: '1024x1024', reference_images: ['one', 'two'] })), /余额不足/);
    assert.equal(billing.account(f.db, f.admin.id).frozen_micro, frozenBefore);
    assert.equal(billing.imageAuthorization(f.db, original.authorization_id).id, original.authorization_id);
    billing.adjustBalance(f.db, f.admin.id, f.admin.id, 100, 'isolated funding');
    f.db.prepare("UPDATE billing_price_book_items SET unit_price_micro=999999 WHERE model=? AND meter='input_image'").run(model);
    const prepared = billing.authorizeImageRequest(f.db, original.authorization_id, pro.context({ size: '1024x1024', reference_images: ['one', 'two'] }));
    assert.equal(prepared.snapshot.amount_micro, 192000);
    assert.equal(billing.getAuthorization(f.db, original.authorization_id).snapshot.amount_micro, 180000);
    await f.restart();
    assert.equal(billing.recoverInterruptedImageReconciliations(f.db).recovered, 1);
    assert.equal(billing.recoverInterruptedImageReconciliations(f.db).recovered, 0);
    assert.throws(() => billing.authorizeImageRequest(f.db, original.authorization_id, input.pricing_context), /不能重复/);
    const settled = billing.settleAuthorization(f.db, f.admin, prepared.authorization_id, { usage: { image: 1, image_size: '1024x1024' } });
    assert.equal(settled.charged_micro, 192000);
    assert.equal(billing.account(f.db, f.admin.id).frozen_micro, 0);
  } finally { await f.close(); }
});

test('billing meter upgrade preserves historical rows, snapshots, extra columns, indexes and allocation sequence', async () => {
  const f = await modelCatalogFixture();
  try {
    await f.restart();
    const original = billing.createAuthorization(f.db, f.admin, { service_type: 'image', model: 'existing-image', usage: { image: 1 }, idempotency_key: 'legacy-before-meter-upgrade' });
    const before = f.db.prepare('SELECT * FROM billing_price_book_items ORDER BY id').all();
    const snapshot = billing.getAuthorization(f.db, original.authorization_id).snapshot_json;
    const sql = f.db.prepare("SELECT sql FROM sqlite_master WHERE name='billing_price_book_items'").get().sql.replace("'input_image', ", '');
    f.db.exec('ALTER TABLE billing_price_book_items RENAME TO fixture_price_items');
    f.db.exec(sql);
    f.db.exec('INSERT INTO billing_price_book_items SELECT * FROM fixture_price_items');
    f.db.exec('DROP TABLE fixture_price_items');
    f.db.exec("ALTER TABLE billing_price_book_items ADD COLUMN fixture_note TEXT DEFAULT 'preserved'");
    f.db.exec('CREATE INDEX fixture_price_index ON billing_price_book_items(model)');
    f.db.prepare("UPDATE sqlite_sequence SET seq=99999 WHERE name='billing_price_book_items'").run();
    await f.restart();
    await f.restart();
    const after = f.db.prepare('SELECT * FROM billing_price_book_items ORDER BY id').all();
    for (const row of before) assert.deepEqual(after.find(item => item.id === row.id), { ...row, fixture_note: 'preserved' });
    assert.ok(f.db.prepare("SELECT seq FROM sqlite_sequence WHERE name='billing_price_book_items'").get().seq >= 99999);
    assert.ok(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='fixture_price_index'").get());
    assert.equal(billing.getAuthorization(f.db, original.authorization_id).snapshot_json, snapshot);
    assert.equal(billing.authorizeImageRequest(f.db, original.authorization_id, pro.context({ size: '1024x1024', reference_images: ['one', 'two'] })), null);
    assert.equal(billing.settleAuthorization(f.db, f.admin, original.authorization_id, { usage: { image: 1 } }).charged_micro, 10000);
  } finally { await f.close(); }
});
