DELETE FROM billing_price_book_items AS legacy
WHERE legacy.service_type = 'video' AND legacy.meter = 'input_token'
  AND EXISTS (
    SELECT 1 FROM billing_price_book_items AS current
    WHERE current.price_book_id = legacy.price_book_id
      AND current.service_type = legacy.service_type
      AND current.model = legacy.model
      AND current.meter = 'output_token'
  );

UPDATE billing_price_book_items
SET meter = 'output_token', updated_at = '2026-08-10T00:00:00.000Z'
WHERE service_type = 'video' AND meter = 'input_token';

ALTER TABLE video_generations ADD COLUMN provider_response_snapshot_json TEXT;
