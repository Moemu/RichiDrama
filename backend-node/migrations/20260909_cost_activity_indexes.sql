CREATE INDEX IF NOT EXISTS idx_billing_usage_authorization ON billing_usage_logs(authorization_id);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_authorization_type ON billing_transactions(authorization_id,type);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_type_created ON billing_transactions(type,created_at);
CREATE INDEX IF NOT EXISTS idx_billing_reconciliation_authorization_created ON billing_reconciliation_cases(authorization_id,created_at);
