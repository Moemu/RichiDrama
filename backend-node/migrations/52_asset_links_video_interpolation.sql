CREATE TABLE IF NOT EXISTS asset_resource_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL,
  drama_id INTEGER NOT NULL,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('character', 'scene', 'prop')),
  resource_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'primary_image',
  asset_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'detached', 'missing_source')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  detached_at TEXT,
  UNIQUE(drama_id, resource_type, resource_id, role)
);

CREATE INDEX IF NOT EXISTS idx_asset_resource_links_asset ON asset_resource_links(asset_id, status);
CREATE INDEX IF NOT EXISTS idx_asset_resource_links_owner_scope ON asset_resource_links(owner_user_id, drama_id, status);

INSERT OR IGNORE INTO asset_resource_links
  (owner_user_id, drama_id, resource_type, resource_id, role, asset_id, status, created_at, updated_at, detached_at)
SELECT COALESCE(d.owner_user_id, a.owner_user_id), a.drama_id,
       json_extract(a.metadata_json, '$.resource_type'),
       CAST(json_extract(a.metadata_json, '$.resource_id') AS INTEGER),
       'primary_image', a.id,
       CASE WHEN a.deleted_at IS NULL THEN 'active' ELSE 'detached' END,
       COALESCE(a.created_at, CURRENT_TIMESTAMP), COALESCE(a.updated_at, CURRENT_TIMESTAMP), a.deleted_at
FROM assets a
LEFT JOIN dramas d ON d.id = a.drama_id
WHERE a.source_type = 'project_resource'
  AND a.drama_id IS NOT NULL
  AND json_valid(a.metadata_json)
  AND json_extract(a.metadata_json, '$.resource_type') IN ('character', 'scene', 'prop')
  AND json_extract(a.metadata_json, '$.resource_id') IS NOT NULL
  AND COALESCE(d.owner_user_id, a.owner_user_id) IS NOT NULL;

CREATE TABLE IF NOT EXISTS video_interpolation_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_generation_id INTEGER NOT NULL UNIQUE,
  owner_user_id INTEGER NOT NULL,
  billing_authorization_id TEXT,
  target_fps INTEGER NOT NULL DEFAULT 60,
  input_video_url TEXT,
  source_local_path TEXT,
  output_local_path TEXT,
  provider_task_id TEXT,
  provider_request_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  output_width INTEGER,
  output_height INTEGER,
  output_duration_ms INTEGER,
  output_resolution TEXT,
  output_fps INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_msg TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_video_interpolation_status ON video_interpolation_jobs(status, updated_at);

ALTER TABLE video_generations ADD COLUMN source_local_path TEXT;
ALTER TABLE video_generations ADD COLUMN interpolation_job_id INTEGER;
ALTER TABLE video_generations ADD COLUMN interpolation_status TEXT;
-- NULL means that frame interpolation was not selected for this generation.
ALTER TABLE video_generations ADD COLUMN target_fps INTEGER;
ALTER TABLE video_generations ADD COLUMN interpolation_billing_authorization_id TEXT;
ALTER TABLE video_generations ADD COLUMN output_width INTEGER;
ALTER TABLE video_generations ADD COLUMN output_height INTEGER;
ALTER TABLE video_generations ADD COLUMN output_resolution TEXT;
ALTER TABLE video_generations ADD COLUMN output_fps REAL;
ALTER TABLE video_generations ADD COLUMN output_duration_ms INTEGER;

INSERT INTO billing_price_book_items
  (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
SELECT pb.id, 'video_postprocess', 'volcengine-video-frame-interpolation', 'millisecond',
  CASE WHEN EXISTS (SELECT 1 FROM billing_settings WHERE key = 'billing_precision_scale_v2') THEN 10000 ELSE 1 END, 0,
  '{"currency":"CNY","unit_size":60000,"source":"https://www.volcengine.com/docs/6448/2486473?lang=zh","verified_on":"2026-08-13","provider":"volcengine","default_rate_id":"720p_60","rates":[{"id":"720p_30","when":{"resolution_tier":"720p","fps_tier":"lte30"},"unit_price_points":60,"unit_size":60000},{"id":"720p_60","when":{"resolution_tier":"720p","fps_tier":"lte60"},"unit_price_points":120,"unit_size":60000},{"id":"720p_120","when":{"resolution_tier":"720p","fps_tier":"lte120"},"unit_price_points":240,"unit_size":60000},{"id":"1080p_30","when":{"resolution_tier":"1080p","fps_tier":"lte30"},"unit_price_points":120,"unit_size":60000},{"id":"1080p_60","when":{"resolution_tier":"1080p","fps_tier":"lte60"},"unit_price_points":240,"unit_size":60000},{"id":"1080p_120","when":{"resolution_tier":"1080p","fps_tier":"lte120"},"unit_price_points":480,"unit_size":60000},{"id":"2k_30","when":{"resolution_tier":"2k","fps_tier":"lte30"},"unit_price_points":240,"unit_size":60000},{"id":"2k_60","when":{"resolution_tier":"2k","fps_tier":"lte60"},"unit_price_points":480,"unit_size":60000},{"id":"2k_120","when":{"resolution_tier":"2k","fps_tier":"lte120"},"unit_price_points":960,"unit_size":60000},{"id":"4k_30","when":{"resolution_tier":"4k","fps_tier":"lte30"},"unit_price_points":480,"unit_size":60000},{"id":"4k_60","when":{"resolution_tier":"4k","fps_tier":"lte60"},"unit_price_points":960,"unit_size":60000},{"id":"4k_120","when":{"resolution_tier":"4k","fps_tier":"lte120"},"unit_price_points":1920,"unit_size":60000}],"pricing_note":"Official AI MediaKit frame interpolation output-duration price, 100 points = CNY 1"}',
  '2026-08-13T00:00:00.000Z', '2026-08-13T00:00:00.000Z'
FROM billing_price_books pb
WHERE pb.status = 'published' AND pb.owner_user_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM billing_price_book_items i
    WHERE i.price_book_id = pb.id AND i.service_type = 'video_postprocess'
      AND i.model = 'volcengine-video-frame-interpolation' AND i.meter = 'millisecond'
  );
