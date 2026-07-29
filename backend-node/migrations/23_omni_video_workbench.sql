-- 通用媒体资产与全能视频工作台
ALTER TABLE assets ADD COLUMN source_type TEXT DEFAULT 'upload';
ALTER TABLE assets ADD COLUMN parent_asset_id INTEGER;
ALTER TABLE assets ADD COLUMN thumbnail_local_path TEXT;
ALTER TABLE assets ADD COLUMN metadata_json TEXT;
ALTER TABLE assets ADD COLUMN tags_json TEXT;
ALTER TABLE assets ADD COLUMN checksum TEXT;
ALTER TABLE assets ADD COLUMN processing_status TEXT DEFAULT 'ready';
ALTER TABLE assets ADD COLUMN error_msg TEXT;

CREATE TABLE IF NOT EXISTS omni_video_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_generation_id INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT 'omni',
  prompt TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT,
  model_requested TEXT,
  model_resolved TEXT,
  capability_snapshot_json TEXT,
  request_snapshot_json TEXT,
  preprocess_snapshot_json TEXT,
  input_summary_json TEXT,
  audio_strategy TEXT DEFAULT 'reference_only',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS omni_video_job_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  omni_job_id INTEGER NOT NULL,
  asset_id INTEGER,
  ordinal INTEGER NOT NULL DEFAULT 0,
  alias TEXT,
  media_type TEXT,
  role TEXT,
  usage TEXT,
  send_to_model INTEGER NOT NULL DEFAULT 0,
  derived_asset_id INTEGER,
  provider_asset_ref TEXT,
  snapshot_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_omni_video_jobs_video_generation ON omni_video_jobs(video_generation_id);
CREATE INDEX IF NOT EXISTS idx_omni_video_job_assets_job ON omni_video_job_assets(omni_job_id);
