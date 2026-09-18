CREATE TABLE IF NOT EXISTS creative_boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  graph_json TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_creative_boards_owner ON creative_boards(owner_user_id, deleted_at, updated_at);
ALTER TABLE image_generations ADD COLUMN board_id INTEGER;
ALTER TABLE video_generations ADD COLUMN board_id INTEGER;
ALTER TABLE image_generations ADD COLUMN board_request_id TEXT;
ALTER TABLE video_generations ADD COLUMN board_request_id TEXT;
CREATE INDEX IF NOT EXISTS idx_board_images ON image_generations(board_id, owner_user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_board_videos ON video_generations(board_id, owner_user_id, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_board_image_request ON image_generations(owner_user_id, board_request_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_board_video_request ON video_generations(owner_user_id, board_request_id);
CREATE TABLE IF NOT EXISTS creative_board_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL,
  owner_user_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  input_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  finished_local_path TEXT,
  clean_local_path TEXT,
  srt_local_path TEXT,
  error_msg TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_board_deliveries ON creative_board_deliveries(board_id, owner_user_id, created_at);
