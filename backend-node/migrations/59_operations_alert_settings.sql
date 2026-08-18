-- Persistent, local-only thresholds for the operations console.
CREATE TABLE IF NOT EXISTS operations_alert_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO operations_alert_settings (key, value, updated_at) VALUES
  ('stale_minutes', '30', '2026-08-17T00:00:00.000Z'),
  ('failed_count', '3', '2026-08-17T00:00:00.000Z'),
  ('failed_window_hours', '24', '2026-08-17T00:00:00.000Z'),
  ('pending_reconciliation_count', '1', '2026-08-17T00:00:00.000Z'),
  ('archive_failed_count', '1', '2026-08-17T00:00:00.000Z');
