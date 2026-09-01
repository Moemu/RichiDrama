const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const auth = require('../src/services/authService');
const billing = require('../src/services/billingService');
const billingContext = require('../src/services/billingRequestContext');
const configs = require('../src/services/aiConfigService');
const dramas = require('../src/services/dramaService');
const taskService = require('../src/services/taskService');
const tenants = require('../src/services/tenantService');
const { createResourceImageBilling, quoteResourceImages } = require('../src/services/imageBillingService');

const log = { info() {}, warn() {}, error() {} };

function setup() {
  const dbPath = path.join(os.tmpdir(), `maintainer-restore-${Date.now()}-${Math.random()}.db`);
  const db = getDb({ path: dbPath, type: 'sqlite' });
  runMigrationsAndEnsure(db);
  return { db, dbPath, admin: auth.ensureBootstrapAdmin(db, log) };
}

function teardown(dbPath) {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix); } catch (_) {} }
}

function responseCapture() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('AI config routes mask secrets and a masked update preserves the stored key', () => {
  const { db, dbPath, admin } = setup();
  try {
    const tenant = tenants.tenantForUser(db, admin.id);
    const config = configs.createConfig(db, log, {
      service_type: 'image', provider: 'openai', name: 'masked config',
      base_url: 'https://example.invalid', api_key: 'abcd-secret-wxyz',
      model: ['masked-model'], is_default: true,
    });
    tenants.bindGlobalConfigToLegacyTenants(db, config);
    const routes = require('../src/routes/aiConfig')(db, log, {});
    const listed = responseCapture();
    routes.list({ auth: admin, query: { tenant_id: tenant.id } }, listed);
    const publicConfig = listed.body.data.find((item) => item.id === config.id);
    assert.equal(publicConfig.api_key, 'abcd****wxyz');

    const updated = responseCapture();
    routes.update({ auth: admin, params: { id: config.id }, query: { tenant_id: tenant.id }, body: { api_key: publicConfig.api_key } }, updated);
    assert.equal(updated.statusCode, 200);
    assert.equal(configs.getConfig(db, config.id).api_key, 'abcd-secret-wxyz');
  } finally { teardown(dbPath); }
});

test('request-scoped tasks and resource image billing inherit the current owner and tenant', () => {
  const { db, dbPath, admin } = setup();
  try {
    const tenant = tenants.tenantForUser(db, admin.id);
    const config = configs.createConfig(db, log, {
      service_type: 'image', provider: 'openai', name: 'resource image billing',
      base_url: 'https://example.invalid', api_key: 'test',
      model: ['resource-image-model'], default_model: 'resource-image-model', is_default: true,
    });
    tenants.bindGlobalConfigToLegacyTenants(db, config);
    billing.savePriceBook(db, admin.id, {
      name: 'resource image price', status: 'published',
      items: [{ service_type: 'image', model: 'resource-image-model', meter: 'image', unit_price: 12,
        conditions_json: { unit_size: 1, default_rate_id: 'text_to_image', rates: [
          { id: 'image_to_image', when: { has_image_input: true }, unit_price_points: 8, unit_size: 1 },
          { id: 'text_to_image', when: { has_image_input: false }, unit_price_points: 12, unit_size: 1 },
        ] },
      }],
    });
    billing.adjustBalance(db, admin.id, admin.id, 100, 'resource image test');
    const project = dramas.createDrama(db, log, { title: 'resource billing project', owner_user_id: admin.id });

    const batchQuote = quoteResourceImages(db, admin, {
      model: 'resource-image-model', count: 3, image_input_count: 1,
    });
    assert.equal(batchQuote.amount_micro, 320000);
    assert.equal(batchQuote.amount, 32);
    assert.deepEqual(batchQuote.groups.map((item) => [item.count, item.has_image_input, item.amount]), [
      [2, false, 24],
      [1, true, 8],
    ]);

    billingContext.run({ actor: admin, tenant_id: tenant.id }, () => {
      const task = taskService.createTaskFromContext(db, log, 'image_generation', 'character_1');
      const storedTask = db.prepare('SELECT owner_user_id, tenant_id FROM async_tasks WHERE id=?').get(task.id);
      assert.deepEqual(storedTask, { owner_user_id: admin.id, tenant_id: tenant.id });

      const resourceBilling = createResourceImageBilling(db, {
        model: 'resource-image-model', dramaId: project.id, sourceId: 'character_1',
      });
      assert.ok(resourceBilling.authorizationId);
      resourceBilling.settle(log, 'provider-request-1');
      const usage = db.prepare('SELECT charged_micro FROM billing_usage_logs WHERE authorization_id=?').get(resourceBilling.authorizationId);
      assert.equal(usage.charged_micro, 120000);

      const referencedBilling = createResourceImageBilling(db, {
        model: 'resource-image-model', dramaId: project.id, sourceId: 'character_2',
        reference_image_urls: ['', '/static/reference.png'],
      });
      const referencedAuth = billing.getAuthorization(db, referencedBilling.authorizationId);
      assert.equal(referencedAuth.snapshot.pricing_context.has_image_input, true);
      assert.equal(referencedAuth.amount_micro, 80000);
      referencedBilling.settle(log, 'provider-request-2');
      const referencedUsage = db.prepare('SELECT charged_micro FROM billing_usage_logs WHERE authorization_id=?').get(referencedBilling.authorizationId);
      assert.equal(referencedUsage.charged_micro, 80000);
    });
  } finally { teardown(dbPath); }
});

test('migration 72 repairs only the legacy default group and is repeatable', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT, status TEXT, uses_legacy_global_configs INTEGER);
      CREATE TABLE ai_service_configs (id INTEGER PRIMARY KEY, service_type TEXT, priority INTEGER, is_active INTEGER, is_default INTEGER, owner_tenant_id INTEGER, deleted_at TEXT);
      CREATE TABLE tenant_ai_config_bindings (tenant_id INTEGER, service_type TEXT, ai_config_id INTEGER, is_active INTEGER, priority INTEGER, is_default INTEGER, created_at TEXT, updated_at TEXT, UNIQUE(tenant_id, ai_config_id));
      INSERT INTO tenants VALUES (1, '默认项目组', 'active', 0);
      INSERT INTO tenants VALUES (2, '隔离项目组', 'active', 0);
      INSERT INTO ai_service_configs VALUES (10, 'image', 5, 1, 1, 0, NULL);
    `);
    const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '72_repair_legacy_default_tenant_flag.sql'), 'utf8');
    db.exec(migration);
    db.exec(migration);
    assert.equal(db.prepare('SELECT uses_legacy_global_configs FROM tenants WHERE id=1').get().uses_legacy_global_configs, 1);
    assert.equal(db.prepare('SELECT uses_legacy_global_configs FROM tenants WHERE id=2').get().uses_legacy_global_configs, 0);
    assert.equal(db.prepare('SELECT owner_tenant_id FROM ai_service_configs WHERE id=10').get().owner_tenant_id, null);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM tenant_ai_config_bindings').get().count, 1);
  } finally { db.close(); }
});
