ALTER TABLE storyboards ADD COLUMN omni_asset_ids TEXT;
ALTER TABLE storyboards ADD COLUMN audio_strategy TEXT DEFAULT 'reference_only';
ALTER TABLE storyboards ADD COLUMN keep_original_audio INTEGER DEFAULT 0;
ALTER TABLE storyboards ADD COLUMN audio_volume REAL DEFAULT 1;
ALTER TABLE storyboards ADD COLUMN audio_fade_seconds REAL DEFAULT 0;
ALTER TABLE storyboards ADD COLUMN omni_creation_mode TEXT DEFAULT 'multi_reference';
ALTER TABLE storyboards ADD COLUMN omni_first_frame_asset_id INTEGER;
ALTER TABLE storyboards ADD COLUMN omni_last_frame_asset_id INTEGER;
ALTER TABLE storyboards ADD COLUMN omni_asset_usage_json TEXT;
