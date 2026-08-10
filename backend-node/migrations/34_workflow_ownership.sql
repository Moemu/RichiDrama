-- Ownership columns for the workflow paths that are not rooted by dramas.
ALTER TABLE omni_video_sequences ADD COLUMN owner_user_id INTEGER;
ALTER TABLE omni_video_jobs ADD COLUMN owner_user_id INTEGER;
ALTER TABLE tool_runs ADD COLUMN owner_user_id INTEGER;
ALTER TABLE tool_runs ADD COLUMN billing_authorization_id TEXT;

CREATE INDEX IF NOT EXISTS idx_omni_sequences_owner ON omni_video_sequences(owner_user_id, deleted_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_omni_jobs_owner ON omni_video_jobs(owner_user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_tool_runs_owner ON tool_runs(owner_user_id, deleted_at, updated_at);
