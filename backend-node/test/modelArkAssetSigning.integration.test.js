const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../src/services/authService');
const { modelCatalogFixture } = require('./helpers/modelCatalogFixture');
const fixtures = require('./fixtures/volcengineOpenApiSignatures.json');

test('asset HTTP API preserves signed credentials, authorization, errors and restart behavior', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-31T02:00:00.000Z') });
  const f = await modelCatalogFixture();
  const nativeFetch = global.fetch;
  const calls = [];
  let upstreamStatus = 200;
  let upstreamPayload = { ResponseMetadata: { RequestId: 'asset-fixture-request' }, Result: { Items: [] } };
  t.mock.method(global, 'fetch', async (url, init) => {
    if (String(url).startsWith('http://127.0.0.1:')) return nativeFetch(url, init);
    assert.ok(['open.volcengineapi.com', 'open.byteplusapi.com', 'asset-gateway.invalid'].includes(new URL(url).host));
    calls.push({ url, ...init });
    return new Response(JSON.stringify(upstreamPayload), { status: upstreamStatus });
  });
  try {
    const login = await f.request('POST', '/auth/login', { username: 'catalog-admin', password: 'fixture-password' });
    assert.equal(login.status, 200);
    const route = '/ai-configs/model-ark-asset';
    const domestic = fixtures.cases.find(row => row.name === 'asset project query escaping and UTF-8 body');
    const international = fixtures.cases.find(row => row.name === 'BytePlus session credentials');
    function requestBody(fixture, baseUrl) {
      const payload = { ...fixture.input.body };
      if (fixture === international) delete payload.ProjectName;
      return {
        base_url: baseUrl,
        auth_mode: 'volc_sign', path_mode: 'open_api_query',
        action: fixture.input.action, payload,
        access_key_id: ` ${fixture.input.accessKeyId} `,
        secret_access_key: ` ${fixture.input.secretAccessKey} `,
        session_token: fixture.input.sessionToken ? ` ${fixture.input.sessionToken} ` : undefined,
        project_name: fixture.input.projectName,
      };
    }
    const domesticBody = requestBody(domestic, 'https://ark.cn-beijing.volces.com/api/v3');
    assert.equal((await f.request('POST', route, domesticBody)).status, 401);
    auth.createUser(f.db, { username: 'asset-viewer', password: 'fixture-password' }, null);
    const viewer = await f.request('POST', '/auth/login', { username: 'asset-viewer', password: 'fixture-password' });
    assert.equal((await f.request('POST', route, domesticBody, viewer.cookie)).status, 403);
    assert.equal(calls.length, 0, 'unauthorized callers never reach the provider');

    for (const [fixture, baseUrl] of [
      [domestic, 'https://ark.cn-beijing.volces.com/api/v3'],
      [international, 'https://ark.ap-southeast.bytepluses.com/api/v3'],
    ]) {
      const result = await f.request('POST', route, requestBody(fixture, baseUrl), login.cookie);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.deepEqual(result.body.data, upstreamPayload);
      const actual = calls.at(-1);
      assert.deepEqual({ url: actual.url, bodyText: actual.body, headers: actual.headers }, fixture.expected);
      assert.equal(actual.method, 'POST');
      assert.equal(actual.redirect, 'manual');
      assert.equal(JSON.stringify(result.body).includes(fixture.input.secretAccessKey), false);
    }

    const beforeInvalid = calls.length;
    for (const invalid of [
      { ...domesticBody, action: 'RunInstances' },
      { ...domesticBody, secret_access_key: '' },
      { ...domesticBody, path_mode: 'flat' },
    ]) {
      assert.equal((await f.request('POST', route, invalid, login.cookie)).status, 400);
    }
    assert.equal(calls.length, beforeInvalid);

    upstreamStatus = 403;
    upstreamPayload = { ResponseMetadata: { RequestId: 'asset-denied-request', Error: { Code: 'AccessDenied', Message: 'Fixture access denied' } } };
    const denied = await f.request('POST', route, domesticBody, login.cookie);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.code, 'MODEL_ARK_ASSET');
    assert.match(denied.body.error.message, /Fixture access denied/);
    assert.ok(JSON.stringify(denied.body).includes('asset-denied-request'));

    upstreamStatus = 200;
    upstreamPayload = { Result: { Items: [{ Id: 'existing-asset' }] } };
    for (const [pathMode, method, suffix] of [['flat', 'GET', '/ListAssets'], ['asset_subpath', 'POST', '/asset/ListAssets']]) {
      const result = await f.request('POST', route, {
        base_url: 'https://asset-gateway.invalid', api_key: 'Bearer fixture-token',
        action: 'ListAssets', path_mode: pathMode, http_method: method, payload: { PageSize: 5 },
      }, login.cookie);
      assert.equal(result.status, 200);
      const actual = calls.at(-1);
      assert.equal(actual.url, `https://asset-gateway.invalid${suffix}`);
      assert.equal(actual.method, method);
      assert.equal(actual.headers.Authorization, 'Bearer fixture-token');
      assert.equal(actual.redirect, 'manual');
      assert.equal(actual.body, method === 'GET' ? undefined : '{"PageSize":5}');
    }

    const legacy = f.db.prepare('SELECT model,default_model,billing_key FROM ai_service_configs WHERE id=?').get(f.config.id);
    await f.restart();
    assert.deepEqual(f.db.prepare('SELECT model,default_model,billing_key FROM ai_service_configs WHERE id=?').get(f.config.id), legacy);
    const reread = await f.request('POST', route, domesticBody, login.cookie);
    assert.equal(reread.status, 200);
    assert.deepEqual(reread.body.data, upstreamPayload);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM billing_transactions WHERE type='authorization'").get().n, 0);
  } finally {
    t.mock.restoreAll();
    t.mock.timers.reset();
    await f.close();
  }
});
