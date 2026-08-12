-- Official ModelArk SKU supplied for Seedance 2.5. Video is settled from
-- provider output_token usage: CNY 42/M with video input, CNY 70/M otherwise.
UPDATE ai_service_configs
SET model = json_insert(CASE WHEN json_valid(model) THEN model ELSE '[]' END, '$[#]', 'doubao-seedance-2-5-260628'),
    updated_at = '2026-08-12T00:00:00.000Z'
WHERE service_type = 'video'
  AND deleted_at IS NULL
  AND lower(provider) IN ('volces', 'volcengine', 'volc')
  AND NOT EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(model) THEN model ELSE '[]' END) WHERE value = 'doubao-seedance-2-5-260628');

INSERT INTO billing_price_book_items (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
SELECT id, 'video', 'doubao-seedance-2-5-260628', 'output_token', 70000000, 0,
  '{"currency":"CNY","unit_size":1000000,"source":"Volcengine ModelArk console","verified_on":"2026-08-12","provider":"volcengine","default_rate_id":"no_video_input","rates":[{"id":"with_video_input","when":{"has_video_input":true},"unit_price_points":4200,"unit_size":1000000},{"id":"no_video_input","when":{"has_video_input":false},"unit_price_points":7000,"unit_size":1000000}],"pricing_note":"Official public pay-as-you-go rates for Doubao-Seedance-2.5"}',
  '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z'
FROM billing_price_books b
WHERE b.status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM billing_price_book_items i
    WHERE i.price_book_id = b.id AND i.service_type = 'video'
      AND i.model = 'doubao-seedance-2-5-260628' AND i.meter = 'output_token'
  );
