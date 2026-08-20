-- Every billable free-creation sequence and AI tool run has one immutable
-- project context. Existing history is deliberately left NULL for audit.
ALTER TABLE omni_video_sequences ADD COLUMN drama_id INTEGER;
ALTER TABLE tool_runs ADD COLUMN drama_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_omni_sequences_project ON omni_video_sequences(owner_user_id, drama_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_tool_runs_project ON tool_runs(owner_user_id, drama_id, deleted_at);
