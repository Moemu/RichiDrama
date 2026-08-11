-- The published Lite rate is only verified for input context up to 32K tokens.
-- Store that bound as internal price metadata. It is evaluated from canonical
-- provider input_token usage and never sent to the provider API.
UPDATE billing_price_book_items
SET conditions_json = '{"currency":"CNY","unit_size":1000000,"source":"https://www.volcengine.com/product/doubao/","verified_on":"2026-08-10","provider":"volcengine","usage_tiers":[{"id":"input_context_up_to_32k","selector_meter":"input_token","min_inclusive":0,"max_inclusive":32000,"unit_price_points":60,"unit_size":1000000}],"pricing_note":"Official public online inference price: CNY 0.6 per million input tokens for input context up to 32K"}'
WHERE service_type = 'text' AND model = 'doubao-seed-2-0-lite-260428' AND meter = 'input_token'
  AND NOT EXISTS (SELECT 1 FROM billing_settings WHERE key = 'seed_2_lite_context_tier_v1');

UPDATE billing_price_book_items
SET conditions_json = '{"currency":"CNY","unit_size":1000000,"source":"https://www.volcengine.com/product/doubao/","verified_on":"2026-08-10","provider":"volcengine","usage_tiers":[{"id":"input_context_up_to_32k","selector_meter":"input_token","min_inclusive":0,"max_inclusive":32000,"unit_price_points":360,"unit_size":1000000}],"pricing_note":"Official public online inference price: CNY 3.6 per million output tokens for input context up to 32K"}'
WHERE service_type = 'text' AND model = 'doubao-seed-2-0-lite-260428' AND meter = 'output_token'
  AND NOT EXISTS (SELECT 1 FROM billing_settings WHERE key = 'seed_2_lite_context_tier_v1');

INSERT OR IGNORE INTO billing_settings (key, value, updated_at)
VALUES ('seed_2_lite_context_tier_v1', '1', '2026-08-11T00:00:00.000Z');
