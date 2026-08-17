CREATE TABLE IF NOT EXISTS operations_report_snapshots (
  report_date TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  summary_json TEXT NOT NULL
);
