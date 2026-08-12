-- One durable archive record per stable local_path.  The local path remains
-- the application-facing media identity even after a future cold-tier purge.
CREATE TABLE IF NOT EXISTS media_archive_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_path TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  source_id INTEGER,
  oss_key TEXT,
  oss_etag TEXT,
  archive_status TEXT NOT NULL DEFAULT 'local_ready',
  archive_attempts INTEGER NOT NULL DEFAULT 0,
  archive_error TEXT,
  verified_at TEXT,
  local_delete_after TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_archive_records_status ON media_archive_records(archive_status, updated_at);
