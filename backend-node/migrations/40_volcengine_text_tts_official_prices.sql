-- Published public on-demand rates supplied with the billing design. Amounts
-- are whole points, 100 points equal CNY 1.  TTS is billed by input characters.
INSERT OR IGNORE INTO billing_price_book_items (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
SELECT id, 'text', 'doubao-seed-2-1-pro-250528', 'input_token', 600, 0,
  '{"currency":"CNY","unit_size":1000000,"provider":"volcengine","pricing_note":"Public on-demand input token price, 100 points = CNY 1"}',
  '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'
FROM billing_price_books pb WHERE name = '火山引擎官方公开价目（2026-08-10）' AND status = 'published'
  AND NOT EXISTS (SELECT 1 FROM billing_price_book_items i WHERE i.price_book_id=pb.id AND i.service_type='text' AND i.model='doubao-seed-2-1-pro-250528' AND i.meter='input_token');
INSERT OR IGNORE INTO billing_price_book_items (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
SELECT id, 'text', 'doubao-seed-2-1-pro-250528', 'output_token', 3000, 0,
  '{"currency":"CNY","unit_size":1000000,"provider":"volcengine","pricing_note":"Public on-demand output token price, 100 points = CNY 1"}',
  '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'
FROM billing_price_books pb WHERE name = '火山引擎官方公开价目（2026-08-10）' AND status = 'published'
  AND NOT EXISTS (SELECT 1 FROM billing_price_book_items i WHERE i.price_book_id=pb.id AND i.service_type='text' AND i.model='doubao-seed-2-1-pro-250528' AND i.meter='output_token');
INSERT OR IGNORE INTO billing_price_book_items (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
SELECT id, 'text', 'doubao-seed-2-1-turbo-250528', 'input_token', 300, 0,
  '{"currency":"CNY","unit_size":1000000,"provider":"volcengine","pricing_note":"Public on-demand input token price, 100 points = CNY 1"}',
  '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'
FROM billing_price_books pb WHERE name = '火山引擎官方公开价目（2026-08-10）' AND status = 'published'
  AND NOT EXISTS (SELECT 1 FROM billing_price_book_items i WHERE i.price_book_id=pb.id AND i.service_type='text' AND i.model='doubao-seed-2-1-turbo-250528' AND i.meter='input_token');
INSERT OR IGNORE INTO billing_price_book_items (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
SELECT id, 'text', 'doubao-seed-2-1-turbo-250528', 'output_token', 1500, 0,
  '{"currency":"CNY","unit_size":1000000,"provider":"volcengine","pricing_note":"Public on-demand output token price, 100 points = CNY 1"}',
  '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'
FROM billing_price_books pb WHERE name = '火山引擎官方公开价目（2026-08-10）' AND status = 'published'
  AND NOT EXISTS (SELECT 1 FROM billing_price_book_items i WHERE i.price_book_id=pb.id AND i.service_type='text' AND i.model='doubao-seed-2-1-turbo-250528' AND i.meter='output_token');
INSERT OR IGNORE INTO billing_price_book_items (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
SELECT id, 'tts', 'doubao-tts-2-0', 'character', 500, 0,
  '{"currency":"CNY","unit_size":10000,"provider":"volcengine","pricing_note":"Public on-demand price: CNY 5 per 10,000 synthesized characters"}',
  '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'
FROM billing_price_books pb WHERE name = '火山引擎官方公开价目（2026-08-10）' AND status = 'published'
  AND NOT EXISTS (SELECT 1 FROM billing_price_book_items i WHERE i.price_book_id=pb.id AND i.service_type='tts' AND i.model='doubao-tts-2-0' AND i.meter='character');
