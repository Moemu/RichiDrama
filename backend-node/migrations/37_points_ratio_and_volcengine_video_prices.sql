-- Monetary values are stored as whole points. 100 points equal CNY 1.
CREATE TABLE IF NOT EXISTS billing_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);

UPDATE billing_accounts
SET balance_micro = CASE WHEN balance_micro >= 0 THEN (balance_micro + 5000) / 10000 ELSE -((-balance_micro + 5000) / 10000) END,
    frozen_micro = CASE WHEN frozen_micro >= 0 THEN (frozen_micro + 5000) / 10000 ELSE -((-frozen_micro + 5000) / 10000) END,
    total_recharged_micro = CASE WHEN total_recharged_micro >= 0 THEN (total_recharged_micro + 5000) / 10000 ELSE -((-total_recharged_micro + 5000) / 10000) END,
    total_consumed_micro = CASE WHEN total_consumed_micro >= 0 THEN (total_consumed_micro + 5000) / 10000 ELSE -((-total_consumed_micro + 5000) / 10000) END
WHERE NOT EXISTS (SELECT 1 FROM billing_settings WHERE key = 'points_ratio_v1');

UPDATE billing_price_book_items
SET unit_price_micro = (unit_price_micro + 5000) / 10000
WHERE NOT EXISTS (SELECT 1 FROM billing_settings WHERE key = 'points_ratio_v1');

INSERT OR IGNORE INTO billing_settings (key, value, updated_at) VALUES ('points_ratio_v1', '100', '2026-08-10T00:00:00.000Z');

UPDATE billing_price_book_items
SET unit_price_micro = 22,
    conditions_json = '{"currency":"CNY","unit_size":1,"source":"https://www.volcengine.com/docs/82379/1544106?lang=zh","verified_on":"2026-08-10","provider":"volcengine","pricing_note":"Official public pay-as-you-go base price (100 points = CNY 1)"}'
WHERE model = 'doubao-seedream-5-0-260128' AND service_type IN ('image','storyboard_image') AND meter = 'image';

INSERT INTO billing_price_book_items (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
SELECT id, 'video', 'doubao-seedance-2-0-260128', 'input_token', 4600, 0,
  '{"currency":"CNY","unit_size":1000000,"source":"https://www.volcengine.com/product/yunque","verified_on":"2026-08-10","provider":"volcengine","default_rate_id":"no_video_input","rates":[{"id":"with_video_input","when":{"has_video_input":true,"resolution":"480p"},"unit_price_points":2800,"unit_size":1000000},{"id":"no_video_input","when":{"has_video_input":false,"resolution":"480p"},"unit_price_points":4600,"unit_size":1000000},{"id":"with_video_input_1080p","when":{"has_video_input":true,"resolution":"1080p"},"unit_price_points":3100,"unit_size":1000000},{"id":"no_video_input_1080p","when":{"has_video_input":false,"resolution":"1080p"},"unit_price_points":5100,"unit_size":1000000}],"pricing_note":"Official public pay-as-you-go base rates"}',
  '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'
FROM billing_price_books b WHERE name = '火山引擎官方公开价目（2026-08-10）' AND status = 'published'
  AND NOT EXISTS (SELECT 1 FROM billing_price_book_items i WHERE i.price_book_id = b.id AND i.service_type = 'video' AND i.model = 'doubao-seedance-2-0-260128');

INSERT INTO billing_price_book_items (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
SELECT id, 'video', 'doubao-seedance-2-0-fast-260128', 'input_token', 3700, 0,
  '{"currency":"CNY","unit_size":1000000,"source":"https://www.volcengine.com/product/yunque","verified_on":"2026-08-10","provider":"volcengine","default_rate_id":"no_video_input","rates":[{"id":"with_video_input","when":{"has_video_input":true},"unit_price_points":2200,"unit_size":1000000},{"id":"no_video_input","when":{"has_video_input":false},"unit_price_points":3700,"unit_size":1000000}],"pricing_note":"Official public pay-as-you-go base rates"}',
  '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'
FROM billing_price_books b WHERE name = '火山引擎官方公开价目（2026-08-10）' AND status = 'published'
  AND NOT EXISTS (SELECT 1 FROM billing_price_book_items i WHERE i.price_book_id = b.id AND i.service_type = 'video' AND i.model = 'doubao-seedance-2-0-fast-260128');

INSERT INTO billing_price_book_items (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
SELECT id, 'video', 'doubao-seedance-1-5-pro-251215', 'input_token', 800, 0,
  '{"currency":"CNY","unit_size":1000000,"source":"https://www.volcengine.com/product/doubao/","verified_on":"2026-08-10","provider":"volcengine","default_rate_id":"silent_video","rates":[{"id":"silent_video","when":{"has_audio":false},"unit_price_points":800,"unit_size":1000000},{"id":"audio_video","when":{"has_audio":true},"unit_price_points":1600,"unit_size":1000000}],"pricing_note":"Official public pay-as-you-go base rates"}',
  '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'
FROM billing_price_books b WHERE name = '火山引擎官方公开价目（2026-08-10）' AND status = 'published'
  AND NOT EXISTS (SELECT 1 FROM billing_price_book_items i WHERE i.price_book_id = b.id AND i.service_type = 'video' AND i.model = 'doubao-seedance-1-5-pro-251215');
