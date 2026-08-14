CREATE TABLE IF NOT EXISTS video_upscale_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_generation_id INTEGER NOT NULL UNIQUE,
  owner_user_id INTEGER NOT NULL,
  billing_authorization_id TEXT,
  target_resolution TEXT NOT NULL DEFAULT '1080p',
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
  output_fps REAL,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_msg TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_video_upscale_status ON video_upscale_jobs(status, updated_at);

-- NULL means that generative enhancement/upscaling was not selected.
ALTER TABLE video_generations ADD COLUMN upscale_resolution TEXT;
ALTER TABLE video_generations ADD COLUMN upscale_job_id INTEGER;
ALTER TABLE video_generations ADD COLUMN upscale_status TEXT;
ALTER TABLE video_generations ADD COLUMN upscale_local_path TEXT;
ALTER TABLE video_generations ADD COLUMN upscale_billing_authorization_id TEXT;

-- A restarted existing database has already been converted to micro-points;
-- a new database is converted by migrateBillingPrecision after SQL migrations.
UPDATE billing_price_book_items
SET unit_price_micro = CASE
      WHEN EXISTS (SELECT 1 FROM billing_settings WHERE key = 'billing_precision_scale_v2') THEN 220000
      ELSE 22
    END,
    updated_at = '2026-08-14T00:00:00.000Z'
WHERE model = 'doubao-seedream-5-0-260128'
  AND service_type IN ('image', 'storyboard_image') AND meter = 'image';

INSERT INTO billing_price_book_items
  (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
SELECT pb.id, 'video_postprocess', 'volcengine-video-generative-enhancement', 'millisecond',
  CASE WHEN EXISTS (SELECT 1 FROM billing_settings WHERE key = 'billing_precision_scale_v2') THEN 10000 ELSE 1 END, 0,
  '{"currency":"CNY","unit_size":60000,"source":"https://www.volcengine.com/docs/6448/2486473?lang=zh","verified_on":"2026-08-14","provider":"volcengine","default_rate_id":"1080p_60","rates":[{"id":"720p_30","when":{"resolution_tier":"720p","fps_tier":"lte30"},"unit_price_points":250,"unit_size":60000},{"id":"720p_60","when":{"resolution_tier":"720p","fps_tier":"lte60"},"unit_price_points":500,"unit_size":60000},{"id":"720p_120","when":{"resolution_tier":"720p","fps_tier":"lte120"},"unit_price_points":1000,"unit_size":60000},{"id":"1080p_30","when":{"resolution_tier":"1080p","fps_tier":"lte30"},"unit_price_points":500,"unit_size":60000},{"id":"1080p_60","when":{"resolution_tier":"1080p","fps_tier":"lte60"},"unit_price_points":1000,"unit_size":60000},{"id":"1080p_120","when":{"resolution_tier":"1080p","fps_tier":"lte120"},"unit_price_points":2000,"unit_size":60000},{"id":"2k_30","when":{"resolution_tier":"2k","fps_tier":"lte30"},"unit_price_points":1000,"unit_size":60000},{"id":"2k_60","when":{"resolution_tier":"2k","fps_tier":"lte60"},"unit_price_points":2000,"unit_size":60000},{"id":"2k_120","when":{"resolution_tier":"2k","fps_tier":"lte120"},"unit_price_points":4000,"unit_size":60000}],"pricing_note":"Official AI MediaKit generative enhancement output-duration price, 100 points = CNY 1"}',
  '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z'
FROM billing_price_books pb
WHERE pb.status = 'published' AND pb.owner_user_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM billing_price_book_items i
    WHERE i.price_book_id = pb.id AND i.service_type = 'video_postprocess'
      AND i.model = 'volcengine-video-generative-enhancement' AND i.meter = 'millisecond'
  );
