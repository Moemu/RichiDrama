-- Only post-process generations created or explicitly retried by the
-- recovery-aware code opt into automatic startup finalization. Existing rows
-- remain excluded through the safe default of zero.
ALTER TABLE video_generations ADD COLUMN postprocess_recovery_version INTEGER NOT NULL DEFAULT 0;
