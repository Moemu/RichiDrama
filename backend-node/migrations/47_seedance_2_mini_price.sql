-- Official Ark public on-demand price for Seedance 2.0 mini.  The provider
-- settles completion_tokens, therefore video uses the output_token meter.
-- 14 CNY / million tokens with video input and 23 CNY / million without it.
-- Existing official video configurations also receive the SKU as a selectable
-- model. The default remains untouched.
UPDATE ai_service_configs
SET model = json_insert(CASE WHEN json_valid(model) THEN model ELSE '[]' END, '$[#]', 'doubao-seedance-2-0-mini-260615'),
    updated_at = '2026-08-12T00:00:00.000Z'
WHERE service_type = 'video'
  AND deleted_at IS NULL
  AND lower(provider) IN ('volces', 'volcengine', 'volc')
  AND NOT EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(model) THEN model ELSE '[]' END) WHERE value = 'doubao-seedance-2-0-mini-260615');

INSERT INTO billing_price_book_items (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
SELECT id, 'video', 'doubao-seedance-2-0-mini-260615', 'output_token', 23000000, 0,
  '{"currency":"CNY","unit_size":1000000,"source":"https://www.volcengine.com/product/ark","verified_on":"2026-08-12","provider":"volcengine","default_rate_id":"no_video_input","rates":[{"id":"with_video_input","when":{"has_video_input":true},"unit_price_points":1400,"unit_size":1000000},{"id":"no_video_input","when":{"has_video_input":false},"unit_price_points":2300,"unit_size":1000000}],"pricing_note":"Official public pay-as-you-go rates for Doubao-Seedance-2.0-mini"}',
  '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z'
FROM billing_price_books b
WHERE b.status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM billing_price_book_items i
    WHERE i.price_book_id = b.id AND i.service_type = 'video'
      AND i.model = 'doubao-seedance-2-0-mini-260615' AND i.meter = 'output_token'
  );
