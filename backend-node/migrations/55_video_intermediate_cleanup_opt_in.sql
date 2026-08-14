-- Safety boundary: existing rows remain untouched. Only videos created after
-- this migration opt in to retaining a single final local video artifact.
ALTER TABLE video_generations ADD COLUMN intermediate_cleanup_enabled INTEGER NOT NULL DEFAULT 0;
