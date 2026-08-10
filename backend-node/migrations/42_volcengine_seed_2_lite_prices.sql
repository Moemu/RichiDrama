-- Official public on-demand rates for the enabled low-cost text model.
-- 100 points equal CNY 1, so CNY 0.6 / 3.6 per million tokens are 60 / 360 points.
INSERT OR IGNORE INTO billing_price_book_items (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
SELECT id, 'text', 'doubao-seed-2-0-lite-260428', 'input_token', 60, 0,
  '{"currency":"CNY","unit_size":1000000,"source":"https://www.volcengine.com/product/doubao/","verified_on":"2026-08-10","provider":"volcengine","pricing_note":"Official public online inference price: CNY 0.6 per million input tokens for context up to 32K"}',
  '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'
FROM billing_price_books
WHERE status = 'published' AND owner_user_id IS NULL AND name LIKE '%2026-08-10%';

INSERT OR IGNORE INTO billing_price_book_items (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
SELECT id, 'text', 'doubao-seed-2-0-lite-260428', 'output_token', 360, 0,
  '{"currency":"CNY","unit_size":1000000,"source":"https://www.volcengine.com/product/doubao/","verified_on":"2026-08-10","provider":"volcengine","pricing_note":"Official public online inference price: CNY 3.6 per million output tokens for context up to 32K"}',
  '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'
FROM billing_price_books
WHERE status = 'published' AND owner_user_id IS NULL AND name LIKE '%2026-08-10%';
