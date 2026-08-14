-- AI MediaKit is one shared connection for two explicitly selected stages.
-- Do not let the configuration display imply that every new shot interpolates.
UPDATE ai_service_configs
SET default_model = 'volcengine-video-generative-enhancement',
    billing_key = NULL,
    updated_at = '2026-08-14T04:00:00.000Z'
WHERE service_type = 'video_postprocess'
  AND provider = 'volcengine_mediakit'
  AND default_model = 'volcengine-video-frame-interpolation';
