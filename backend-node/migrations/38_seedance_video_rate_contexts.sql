-- Apply the complete official conditional rate table only once. Administrators
-- may subsequently publish or edit price books without startup overwriting them.
UPDATE billing_price_book_items
SET conditions_json = '{"currency":"CNY","unit_size":1000000,"source":"https://www.volcengine.com/product/yunque","verified_on":"2026-08-10","provider":"volcengine","default_rate_id":"no_video_input","rates":[{"id":"with_video_input_1080p","when":{"has_video_input":true,"resolution":"1080p"},"unit_price_points":3100,"unit_size":1000000},{"id":"no_video_input_1080p","when":{"has_video_input":false,"resolution":"1080p"},"unit_price_points":5100,"unit_size":1000000},{"id":"with_video_input","when":{"has_video_input":true},"unit_price_points":2800,"unit_size":1000000},{"id":"no_video_input","when":{"has_video_input":false},"unit_price_points":4600,"unit_size":1000000}],"pricing_note":"Official public pay-as-you-go base rates"}'
WHERE model = 'doubao-seedance-2-0-260128' AND service_type = 'video' AND meter = 'input_token'
  AND NOT EXISTS (SELECT 1 FROM billing_settings WHERE key = 'official_video_rate_contexts_v1');

INSERT OR IGNORE INTO billing_settings (key, value, updated_at) VALUES ('official_video_rate_contexts_v1', '1', '2026-08-10T00:00:00.000Z');
