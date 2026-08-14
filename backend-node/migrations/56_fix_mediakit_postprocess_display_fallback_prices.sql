-- Migration 52/53 ran before the micro-point conversion marker was written.
-- Their conditional rates were correct, but the fallback/display price was
-- inserted as 1 legacy point and then shown as 0.0001 / 1 credit. Correct
-- only the official global MediaKit entries. Historical authorizations,
-- settlements and user-managed price books are deliberately untouched.
UPDATE billing_price_book_items
SET unit_price_micro = 1200000,
    updated_at = '2026-08-14T03:10:00.000Z'
WHERE service_type = 'video_postprocess'
  AND model = 'volcengine-video-frame-interpolation'
  AND meter = 'millisecond'
  AND price_book_id IN (SELECT id FROM billing_price_books WHERE owner_user_id IS NULL)
  AND json_extract(conditions_json, '$.provider') = 'volcengine';

UPDATE billing_price_book_items
SET unit_price_micro = 10000000,
    updated_at = '2026-08-14T03:10:00.000Z'
WHERE service_type = 'video_postprocess'
  AND model = 'volcengine-video-generative-enhancement'
  AND meter = 'millisecond'
  AND price_book_id IN (SELECT id FROM billing_price_books WHERE owner_user_id IS NULL)
  AND json_extract(conditions_json, '$.provider') = 'volcengine';
