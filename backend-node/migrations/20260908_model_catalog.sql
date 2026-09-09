CREATE TABLE IF NOT EXISTS ai_model_catalog (
  service_type TEXT NOT NULL,
  model TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','retired')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (service_type, model)
);
