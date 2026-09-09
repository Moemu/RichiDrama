CREATE TABLE IF NOT EXISTS cost_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO cost_settings(key,value) VALUES ('enabled_at',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE IF NOT EXISTS cost_accounts (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, provider TEXT NOT NULL,
 created_at TEXT NOT NULL, created_by INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cost_account_bindings (
 config_id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES cost_accounts(id), updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cost_prices (
 id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL REFERENCES cost_accounts(id),
 model TEXT NOT NULL, service_type TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'CNY',
 status TEXT NOT NULL DEFAULT 'draft', effective_from TEXT NOT NULL, effective_to TEXT,
 rules_json TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, created_by INTEGER NOT NULL,
 reviewed_at TEXT, reviewed_by INTEGER
);
CREATE INDEX IF NOT EXISTS cost_prices_lookup ON cost_prices(account_id,model,service_type,status,effective_from);
CREATE TABLE IF NOT EXISTS cost_calls (
 id TEXT PRIMARY KEY, source_key TEXT NOT NULL UNIQUE, operation_id TEXT NOT NULL, parent_operation_id TEXT,
 attempt INTEGER NOT NULL, authorization_id TEXT, organization_id INTEGER, customer_kind TEXT NOT NULL,
 organization_name TEXT, drama_id INTEGER, project_title TEXT, user_id INTEGER, user_name TEXT,
 source_kind TEXT NOT NULL, source_id TEXT, provider TEXT, config_id INTEGER, connection_id INTEGER, account_id INTEGER,
 model TEXT NOT NULL, service_type TEXT NOT NULL, context_json TEXT NOT NULL,
 submitted_at TEXT NOT NULL, time_basis TEXT NOT NULL DEFAULT 'supplier_submission', observed_at TEXT NOT NULL,
 completed_at TEXT, first_usage_at TEXT,
 provider_task_id TEXT, provider_request_id TEXT, status TEXT NOT NULL DEFAULT 'processing',
 price_id INTEGER, latest_revision_id INTEGER, origin TEXT NOT NULL DEFAULT 'live'
);
CREATE INDEX IF NOT EXISTS cost_calls_customer_time ON cost_calls(organization_id,submitted_at,id);
CREATE INDEX IF NOT EXISTS cost_calls_project_time ON cost_calls(drama_id,submitted_at,id);
CREATE INDEX IF NOT EXISTS cost_calls_user_time ON cost_calls(user_id,submitted_at,id);
CREATE INDEX IF NOT EXISTS cost_calls_auth ON cost_calls(authorization_id);
CREATE INDEX IF NOT EXISTS cost_calls_supplier_task ON cost_calls(provider_task_id);
CREATE INDEX IF NOT EXISTS cost_calls_account_time ON cost_calls(account_id,submitted_at);
CREATE INDEX IF NOT EXISTS cost_calls_operation ON cost_calls(operation_id,attempt);
CREATE TABLE IF NOT EXISTS cost_revisions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, call_id TEXT NOT NULL REFERENCES cost_calls(id),
 event_key TEXT NOT NULL, observed_at TEXT NOT NULL, usage_json TEXT, evidence_json TEXT NOT NULL,
 status TEXT NOT NULL, cost_status TEXT NOT NULL, price_id INTEGER, currency TEXT,
 amount_micro INTEGER, reason TEXT NOT NULL, actor_id INTEGER,
 UNIQUE(call_id,event_key)
);
CREATE TABLE IF NOT EXISTS cost_backfill_batches (
 id TEXT PRIMARY KEY, created_at TEXT NOT NULL, created_by INTEGER NOT NULL,
 filters_json TEXT NOT NULL, preview_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'preview',
 executed_at TEXT, result_json TEXT
);
CREATE TABLE IF NOT EXISTS cost_reports (
 id TEXT PRIMARY KEY, organization_id INTEGER NOT NULL, month TEXT NOT NULL,
 version INTEGER NOT NULL, generated_at TEXT NOT NULL, created_by INTEGER NOT NULL,
 summary_json TEXT NOT NULL, UNIQUE(organization_id,month,version)
);
CREATE TABLE IF NOT EXISTS cost_report_items (
 report_id TEXT NOT NULL REFERENCES cost_reports(id), call_id TEXT NOT NULL,
 revision_id INTEGER, detail_json TEXT NOT NULL, PRIMARY KEY(report_id,call_id)
);
CREATE TABLE IF NOT EXISTS cost_price_sources (
 id TEXT PRIMARY KEY, account_id INTEGER NOT NULL, config_id INTEGER NOT NULL,
 fetched_at TEXT NOT NULL, created_by INTEGER NOT NULL, evidence_json TEXT NOT NULL
);
