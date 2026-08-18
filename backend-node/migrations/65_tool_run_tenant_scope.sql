-- Tool runs can resume after a restart, so their configuration scope must be durable.
ALTER TABLE tool_runs ADD COLUMN tenant_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_tool_runs_tenant_created ON tool_runs(tenant_id, created_at DESC);
