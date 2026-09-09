ALTER TABLE users ADD COLUMN verified_email TEXT;
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN temporary_password_expires_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_verified_email ON users(verified_email) WHERE verified_email IS NOT NULL;
CREATE TABLE IF NOT EXISTS auth_email_challenges (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK(purpose IN ('bind', 'reset')),
  email TEXT NOT NULL,
  user_id INTEGER,
  session_version INTEGER,
  source_ip TEXT NOT NULL,
  code_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'sent', 'failed', 'consumed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_email_limit ON auth_email_challenges(email, created_at);
CREATE INDEX IF NOT EXISTS idx_auth_ip_limit ON auth_email_challenges(source_ip, created_at);
