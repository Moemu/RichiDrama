-- Successful supplier calls without verifiable usage remain frozen until reconciled.
CREATE TABLE IF NOT EXISTS billing_reconciliation_cases (
  id TEXT PRIMARY KEY,
  authorization_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  service_type TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_request_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'resolved', 'expired', 'waived')),
  reason TEXT,
  observed_usage_json TEXT,
  resolution_json TEXT,
  due_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_billing_reconciliation_pending_due
  ON billing_reconciliation_cases(status, due_at);
CREATE INDEX IF NOT EXISTS idx_billing_reconciliation_user_pending
  ON billing_reconciliation_cases(user_id, service_type, model, status);
