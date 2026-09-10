const test = require('node:test');
const assert = require('node:assert/strict');
const { modelCatalogFixture } = require('./helpers/modelCatalogFixture');
const { seedCostActivity } = require('./helpers/costActivityFixture');
const rates = require('../src/services/supplierCostRates');
const activations = require('./helpers/volcengineAliasPrices');
const ai = require('../src/services/aiConfigService');

test('daily supplier costs use raw prices independently of platform review, retain history, and exclude fixed MediaKit models', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-11T02:00:00.000Z') });
  const f = await modelCatalogFixture(); const originalFetch = global.fetch;
  try {
    seedCostActivity(f.db, f.admin.id);
    for (const table of ['billing_usage_logs', 'billing_transactions']) f.db.prepare(`UPDATE ${table} SET snapshot_json=json_set(snapshot_json,'$.pricing_context',json('{"has_video_input":false,"resolution":"720p"}'))`).run();
    f.db.prepare(`INSERT INTO provider_price_syncs(id,provider,status,trigger_type,created_at,updated_at,fetched_at,raw_response_json)
      VALUES('historical-raw','volcengine','completed','manual','2026-09-07T00:00:00.000Z','2026-09-07T00:00:00.000Z','2026-09-07T00:00:00.000Z',?)`).run(JSON.stringify(activations));
    f.db.prepare(`INSERT INTO supplier_cost_snapshots(id,snapshot_day,status,created_at,fetched_at,raw_json)
      VALUES('day-before','2026-09-06','completed','2026-09-06T15:59:59.000Z','2026-09-07T00:01:00.000Z',?)`).run(JSON.stringify(activations));
    const historical = require('../src/services/supplierCostSnapshotService').snapshots(f.db);
    assert.equal(historical.length, 1, 'a request that crosses midnight belongs to its successful fetch day');
    assert.equal(historical[0].id, 'provider-sync:historical-raw', 'reuse the first successful raw response without requiring review');
    const originalUsage = JSON.stringify(f.db.prepare('SELECT * FROM billing_usage_logs ORDER BY id').all());
    const originalTransactions = JSON.stringify(f.db.prepare('SELECT * FROM billing_transactions ORDER BY id').all());
    const cookie = (await f.request('POST', '/auth/login', { username: f.admin.username, password: 'fixture-password' })).cookie;
    const call = (method, route, body) => f.request(method, route, body, cookie);
    const get = async suffix => { const r = await call('GET', '/admin/costs/activity' + suffix); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.data; };
    const filter = '?basis=supplier_daily_v1&drama_id=73&date_from=2026-09-08&date_to=2026-09-08';
    const result = await get(filter);
    assert.equal(result.summary.supplier_priced_calls, 222);
    assert.equal(result.summary.supplier_fixed_calls, 106);
    assert.equal(result.summary.supplier_stale_calls, 116);
    assert.notEqual(result.summary.supplier_amount_micro, result.summary.charged_micro);
    const video = await get('/usage:legacy-0?basis=supplier_daily_v1');
    assert.equal(video.supplier_amount_micro, 9015975, '324900 × CNY 27.75 / million, without another discount');
    assert.equal(video.supplier.price_day, '2026-09-07');
    assert.equal(video.supplier.stale, true);
    assert.equal(video.supplier.rates[0].unit_price_cny, 27.75);
    assert.equal((await get('?basis=supplier_daily_v1&cost_status=calculated')).summary.calls, 222);
    f.db.prepare('UPDATE billing_price_book_items SET unit_price_micro=987654321').run();
    f.db.prepare("INSERT INTO cost_accounts(name,provider,created_at,created_by) VALUES('arbitrary','volcengine','2026-09-01',1)").run();
    f.db.prepare("INSERT INTO cost_prices(account_id,model,service_type,currency,effective_from,rules_json,source,status,created_at,created_by) VALUES(1,'doubao-seedance-2-0-fast-260128','video','CNY','2026-01-01','[]','manual','published','2026-09-01',1)").run();
    assert.deepEqual((await get(filter)).summary, result.summary, 'editable price books and cost rules cannot affect supplier costs');
    f.db.prepare(`INSERT INTO supplier_cost_snapshots(id,snapshot_day,status,created_at,fetched_at,raw_json)
      VALUES('future','2026-09-10','completed','2026-09-10T00:00:00.000Z','2026-09-10T00:00:00.000Z',?)`).run(JSON.stringify(activations.map(i => ({ ...i, MultiChargeItems: [] }))));
    assert.deepEqual((await get(filter)).summary, result.summary, 'future prices cannot overwrite prior estimates');
    const tenant = f.db.prepare('SELECT id FROM tenants LIMIT 1').get();
    const org = require('../src/services/customerOrganizationService').saveOrganization(f.db,f.admin.id,{ name:'Daily report fixture',config_tenant_id:tenant.id });
    f.db.prepare('UPDATE billing_usage_logs SET organization_id=? WHERE id=?').run(org.id,'legacy-0');
    const report = await call('POST','/admin/costs/reports',{ organization_id:org.id,month:'2026-09',basis:'supplier_daily_v1' });
    assert.equal(report.status,200,JSON.stringify(report.body));
    assert.equal(report.body.data.summary.supplier_amount_micro,9015975);
    const saved = JSON.stringify(report.body.data);
    f.db.prepare('UPDATE billing_usage_logs SET organization_id=NULL WHERE id=?').run('legacy-0');
    assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM billing_usage_logs ORDER BY id').all()),originalUsage);
    assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM billing_transactions ORDER BY id').all()),originalTransactions);
    ai.createConfig(f.db,f.log,{ service_type:'model_ark_asset',provider:'volcengine',name:'Fixture IAM',model:'asset',settings:JSON.stringify({ access_key_id:'fixture-ak',secret_access_key:'fixture-sk' }) });
    ai.createConfig(f.db,f.log,{ service_type:'video_postprocess',provider:'volcengine',name:'Fixed fixture',model:Object.keys({ 'volcengine-video-frame-interpolation':1,'volcengine-video-generative-enhancement':1 }) });
    let requests = 0;
    global.fetch = async (url, init) => {
      if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url,init);
      assert.match(String(url),/^https:\/\/open\.volcengineapi\.com/); requests++;
      return new Response(JSON.stringify({ ResponseMetadata:{RequestId:'daily-fixture'},Result:{TotalCount:activations.length,Items:activations} }));
    };
    assert.equal((await f.request('POST','/admin/costs/supplier-prices/sync',{})).status,401);
    const queued = await call('POST','/admin/costs/supplier-prices/sync',{});
    assert.equal(queued.status,200,JSON.stringify(queued.body));
    for (let i=0;i<100;i++) { const state=await call('GET','/admin/costs/supplier-prices'); if(state.body.data.status==='completed') break; await new Promise(r=>setTimeout(r,10)); }
    const requestCount=requests;
    assert.ok(requestCount>0);
    await call('POST','/admin/costs/supplier-prices/sync',{});
    assert.equal(requests,requestCount,'same-day refresh is idempotent');
    const sync = await call('POST','/admin/provider-prices/volcengine/sync',{});
    assert.equal(sync.status,200,JSON.stringify(sync.body));
    assert.ok(sync.body.data.candidates.every(c=>!rates.fixedRate(c.provider_model)),'fixed prices stay out of sync and review');
    await f.restart();
    assert.equal(JSON.stringify((await call('GET',`/admin/costs/reports/${report.body.data.id}`)).body.data),saved);
    assert.deepEqual((await get(filter)).summary,result.summary);
    const csv = require('../src/services/costQueryService').reportCsv(f.db,report.body.data.id,true);
    assert.match(csv,/供应商每日价格/); assert.match(csv,/9.015975/); assert.match(csv,/2026-09-07/);
    assert.equal((await get('/usage:legacy-0')).supplier_amount_micro,12021300,'old API keeps its explicit legacy semantics');
  } finally { global.fetch=originalFetch; await f.close(); }
});

test('supplier arithmetic covers fixed minute rates, tiers, image conditions and bounded dated discounts', () => {
  const row = { model:'volcengine-video-generative-enhancement',price_at:'2026-09-08T00:00:00.000Z',usage:{millisecond:15105} };
  assert.equal(rates.estimate(row,[]).amount_micro,629375);
  assert.equal(rates.estimate({...row,model:'volcengine-video-frame-interpolation'},[]).amount_micro,151050);
  const lite = rates.decode(activations[0],'2026-09-08T00:00:00.000Z');
  assert.equal(rates.calculate(lite,{input_token:40000,output_token:1000}).amount_micro,41400);
  const fast = rates.decode(activations.find(i=>i.FoundationModelName==='doubao-seedance-2-0-fast'),'2026-09-08T00:00:00.000Z');
  assert.equal(rates.calculate(fast,{output_token:1000000},{}).status,'missing_price','do not assume no input video');
  const mini = activations.find(i=>i.FoundationModelName==='doubao-seedance-2-0-mini');
  assert.equal(rates.calculate(rates.decode(mini,'2026-09-01T00:00:00.000Z'),{output_token:1000000},{has_video_input:false}).amount_micro,9200000);
  assert.equal(rates.calculate(rates.decode(mini,'2026-09-08T00:00:00.000Z'),{output_token:1000000},{has_video_input:false}).amount_micro,23000000);
  const image = {FoundationModelName:'doubao-seedream-4-0',MultiChargeItems:[{ChargeItems:[{Type:'I2ICompletion',Price:0.2,UnitCode:'张'},{Type:'T2ICompletion',Price:0.3,UnitCode:'张'}]}]};
  assert.equal(rates.calculate(rates.decode(image,'2026-09-08'),{image:1},{has_image_input:true}).amount_micro,200000);
  assert.equal(rates.calculate(lite,{input_token:1000,output_token:100,cache_token:20}).status,'missing_price','unknown cached-token pricing cannot silently omit cost');
});

test('daily refresh failure preserves prior prices and an interrupted refresh can recover after restart', async () => {
  const f=await modelCatalogFixture(); const originalFetch=global.fetch;
  try {
    const at=new Date(), today=new Date(at.getTime()+28800000).toISOString().slice(0,10);
    ai.createConfig(f.db,f.log,{service_type:'model_ark_asset',provider:'volcengine',name:'Recovery IAM',model:'asset',settings:JSON.stringify({access_key_id:'fixture-ak',secret_access_key:'fixture-sk'})});
    f.db.prepare("INSERT INTO supplier_cost_snapshots(id,snapshot_day,status,created_at) VALUES('interrupted',?,'processing',?)").run(today,new Date(at.getTime()-7200000).toISOString());
    await f.restart();
    const cookie=(await f.request('POST','/auth/login',{username:f.admin.username,password:'fixture-password'})).cookie;
    const call=(method,path)=>f.request(method,'/admin/costs/supplier-prices'+path,{},cookie);
    let failure=true;
    global.fetch=async(url,init)=>{
      if(String(url).startsWith('http://127.0.0.1:'))return originalFetch(url,init);
      assert.match(String(url),/^https:\/\/open\.volcengineapi\.com/);
      return new Response(JSON.stringify(failure ? {ResponseMetadata:{RequestId:'denied',Error:{Code:'AccessDenied',Message:'fixture denied'}}} : {ResponseMetadata:{RequestId:'recovered'},Result:{TotalCount:activations.length,Items:activations}}),{status:failure?403:200});
    };
    const wait=async expected=>{for(let i=0;i<100;i++){const result=await f.request('GET','/admin/costs/supplier-prices',undefined,cookie);if(result.body.data.status===expected)return result.body.data;await new Promise(r=>setTimeout(r,10));}assert.fail('snapshot worker did not reach '+expected);};
    assert.equal((await call('POST','/sync')).status,200);
    assert.match((await wait('failed')).error,/fixture denied/);
    const failedId=f.db.prepare('SELECT id FROM supplier_cost_snapshots').get().id;
    assert.notEqual(failedId,'interrupted');
    failure=false;
    await call('POST','/sync');
    assert.equal((await wait('completed')).latest.day,today);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM supplier_cost_snapshots WHERE status='completed'").get().n,1);
    await f.restart();
    assert.equal((await wait('completed')).latest.day,today);
  } finally {global.fetch=originalFetch;await f.close();}
});
