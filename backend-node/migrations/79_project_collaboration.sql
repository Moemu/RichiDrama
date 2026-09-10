CREATE TABLE IF NOT EXISTS project_collaboration (
  drama_id INTEGER PRIMARY KEY REFERENCES dramas(id),
  enabled_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS project_members (
  drama_id INTEGER NOT NULL REFERENCES dramas(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (drama_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id, drama_id);
CREATE TABLE IF NOT EXISTS project_episode_assignments (
  episode_id INTEGER PRIMARY KEY REFERENCES episodes(id),
  user_id INTEGER NOT NULL REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS project_text_documents (
  drama_id INTEGER NOT NULL REFERENCES dramas(id),
  entity_kind TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  field TEXT NOT NULL,
  epoch INTEGER NOT NULL DEFAULT 1,
  state BLOB NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (drama_id, entity_kind, entity_id, field)
);
CREATE TABLE IF NOT EXISTS project_operations (
  drama_id INTEGER NOT NULL REFERENCES dramas(id),
  operation_id TEXT NOT NULL,
  actor_id INTEGER NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (drama_id, operation_id)
);
CREATE TABLE IF NOT EXISTS project_asset_copies (
  drama_id INTEGER NOT NULL REFERENCES dramas(id),
  source_asset_id INTEGER NOT NULL,
  source_version TEXT NOT NULL,
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  added_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (drama_id, source_asset_id, source_version)
);
CREATE TABLE IF NOT EXISTS project_task_links (
  task_id TEXT PRIMARY KEY REFERENCES async_tasks(id),
  drama_id INTEGER NOT NULL REFERENCES dramas(id)
);
CREATE TABLE IF NOT EXISTS project_generated_suggestions (
  id INTEGER PRIMARY KEY,
  drama_id INTEGER NOT NULL REFERENCES dramas(id),
  entity_kind TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  field TEXT NOT NULL,
  proposed_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  applied_at TEXT
);
