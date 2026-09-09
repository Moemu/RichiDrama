// Isolated local UI acceptance: empty database, no workers, fake IAM, intercepted metadata requests.
const { modelCatalogFixture } = require('./modelCatalogFixture');
const { seedCostActivity } = require('./costActivityFixture');
const activations = require('./volcengineAliasPrices');
(async () => {
  const f = await modelCatalogFixture(5679);
  seedCostActivity(f.db, f.admin.id);
  const tenant = f.db.prepare('SELECT id FROM tenants LIMIT 1').get();
  const org = require('../../src/services/customerOrganizationService').saveOrganization(f.db,f.admin.id,{name:'每日成本验收客户',config_tenant_id:tenant.id});
  f.db.prepare('UPDATE billing_usage_logs SET organization_id=?').run(org.id);
  f.db.prepare(`INSERT INTO supplier_cost_snapshots(id,snapshot_day,status,created_at,fetched_at,raw_json)
    VALUES('preview-sep7','2026-09-07','completed','2026-09-07T00:00:00.000Z','2026-09-07T00:00:00.000Z',?)`).run(JSON.stringify(activations));
  require('../../src/services/aiConfigService').createConfig(f.db,f.log,{service_type:'model_ark_asset',provider:'volcengine',name:'隔离元数据连接',model:'asset',settings:JSON.stringify({access_key_id:'fixture-ak',secret_access_key:'fixture-sk'})});
  const originalFetch=global.fetch;
  global.fetch=async(url,init)=>{
    if(String(url).startsWith('http://127.0.0.1:'))return originalFetch(url,init);
    if(!String(url).startsWith('https://open.volcengineapi.com'))throw new Error('Unexpected external request blocked');
    await new Promise(resolve=>setTimeout(resolve,350));
    return new Response(JSON.stringify({ResponseMetadata:{RequestId:'preview-metadata'},Result:{TotalCount:activations.length,Items:activations}}));
  };
  console.log('Isolated supplier cost preview ready at 127.0.0.1:5679');
  process.on('SIGINT',async()=>{await f.close();process.exit(0);});
})().catch(error=>{console.error(error);process.exitCode=1;});
