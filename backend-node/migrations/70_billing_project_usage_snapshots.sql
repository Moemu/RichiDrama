-- Project attribution is a billing snapshot, not a mutable lookup. Existing
-- ledger rows remain valid and unassigned until an operator explicitly audits
-- an unambiguous historical mapping.
ALTER TABLE billing_transactions ADD COLUMN drama_id INTEGER;
ALTER TABLE billing_transactions ADD COLUMN project_title_snapshot TEXT;
ALTER TABLE billing_transactions ADD COLUMN source_kind TEXT;
ALTER TABLE billing_transactions ADD COLUMN source_id TEXT;
ALTER TABLE billing_usage_logs ADD COLUMN drama_id INTEGER;
ALTER TABLE billing_usage_logs ADD COLUMN project_title_snapshot TEXT;
ALTER TABLE billing_usage_logs ADD COLUMN source_kind TEXT;
ALTER TABLE billing_usage_logs ADD COLUMN source_id TEXT;
CREATE INDEX IF NOT EXISTS idx_billing_usage_project_created ON billing_usage_logs(drama_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_usage_user_created ON billing_usage_logs(user_id, created_at DESC);
ALTER TABLE storyboards ADD COLUMN omni_asset_send_policy TEXT NOT NULL DEFAULT 'all_selected';
-- Hiding a version only removes it from the creator's working history. The
-- generation, ledger and adopted storyboard output stay intact for audit.
ALTER TABLE omni_video_jobs ADD COLUMN hidden_at TEXT;
ALTER TABLE omni_video_jobs ADD COLUMN hidden_by_user_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_omni_jobs_owner_visible ON omni_video_jobs(owner_user_id, hidden_at, id DESC);
