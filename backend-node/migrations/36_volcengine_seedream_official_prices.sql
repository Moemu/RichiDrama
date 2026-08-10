-- Official public pay-as-you-go price for the currently configured Seedream 5.0 model.
-- The INSERT is conditional so a manually published global price for either SKU
-- remains the source of truth and is never overwritten by startup migrations.
INSERT INTO billing_price_books (name, owner_user_id, status, effective_from, effective_to, created_by, created_at, updated_at)
SELECT '火山引擎官方公开价目（2026-08-10）', NULL, 'published', '2026-08-10T00:00:00.000Z', NULL, 1, '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'
WHERE NOT EXISTS (
  SELECT 1
  FROM billing_price_book_items pbi
  JOIN billing_price_books pb ON pb.id = pbi.price_book_id
  WHERE pb.status = 'published' AND pb.owner_user_id IS NULL
    AND pbi.model = 'doubao-seedream-5-0-260128'
    AND pbi.service_type IN ('image', 'storyboard_image')
    AND pbi.meter = 'image'
);

INSERT OR IGNORE INTO billing_price_book_items (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
SELECT id, 'image', 'doubao-seedream-5-0-260128', 'image', 220000, 0,
  '{"currency":"CNY","source":"https://www.volcengine.com/docs/82379/1544106?lang=zh","verified_on":"2026-08-10","provider":"volcengine","pricing_note":"Official public pay-as-you-go base price (1 credit = CNY 1)"}',
  '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'
FROM billing_price_books
WHERE name = '火山引擎官方公开价目（2026-08-10）' AND status = 'published';

INSERT OR IGNORE INTO billing_price_book_items (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
SELECT id, 'storyboard_image', 'doubao-seedream-5-0-260128', 'image', 220000, 0,
  '{"currency":"CNY","source":"https://www.volcengine.com/docs/82379/1544106?lang=zh","verified_on":"2026-08-10","provider":"volcengine","pricing_note":"Official public pay-as-you-go base price (1 credit = CNY 1)"}',
  '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'
FROM billing_price_books
WHERE name = '火山引擎官方公开价目（2026-08-10）' AND status = 'published';
