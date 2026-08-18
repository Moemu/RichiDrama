-- Add the production third-party image model discovered in the deployed configuration.
-- Existing custom price books stay untouched, so their owner can opt in explicitly.
INSERT INTO billing_price_book_items (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
SELECT b.id, 'image', 'gpt-image-2', 'image',
  CASE WHEN EXISTS (SELECT 1 FROM billing_settings WHERE key = 'billing_precision_scale_v2') THEN 400000 ELSE 40 END,
  0, '{}', datetime('now'), datetime('now')
FROM billing_price_books b
WHERE b.owner_user_id IS NULL AND b.status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM billing_price_book_items i
    WHERE i.price_book_id = b.id AND i.service_type = 'image' AND i.model = 'gpt-image-2' AND i.meter = 'image'
  );

INSERT INTO billing_price_book_items (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
SELECT b.id, 'storyboard_image', 'gpt-image-2', 'image',
  CASE WHEN EXISTS (SELECT 1 FROM billing_settings WHERE key = 'billing_precision_scale_v2') THEN 400000 ELSE 40 END,
  0, '{}', datetime('now'), datetime('now')
FROM billing_price_books b
WHERE b.owner_user_id IS NULL AND b.status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM billing_price_book_items i
    WHERE i.price_book_id = b.id AND i.service_type = 'storyboard_image' AND i.model = 'gpt-image-2' AND i.meter = 'image'
  );
