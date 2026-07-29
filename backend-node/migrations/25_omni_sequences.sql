-- A persistent editing layer above individual <=15s omni jobs.
CREATE TABLE IF NOT EXISTS omni_video_sequences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '未命名视频',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS omni_video_sequence_shots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sequence_id INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '未命名镜头',
  sort_order INTEGER NOT NULL DEFAULT 0,
  prompt TEXT NOT NULL DEFAULT '',
  assets_json TEXT,
  settings_json TEXT,
  omni_job_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_omni_sequence_shots_order
  ON omni_video_sequence_shots(sequence_id, sort_order);

ALTER TABLE omni_video_jobs ADD COLUMN sequence_id INTEGER;
ALTER TABLE omni_video_jobs ADD COLUMN shot_id INTEGER;
