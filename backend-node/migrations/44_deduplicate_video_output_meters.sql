-- Keep a single current output-token rate for every official video SKU.
DELETE FROM billing_price_book_items
WHERE service_type = 'video'
  AND model IN ('doubao-seedance-1-5-pro-251215', 'doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128')
  AND meter = 'input_token';

DELETE FROM billing_price_book_items
WHERE id IN (
  SELECT duplicate.id
  FROM billing_price_book_items duplicate
  JOIN (
    SELECT price_book_id, model, meter, MIN(id) AS keep_id
    FROM billing_price_book_items
    WHERE service_type = 'video' AND meter = 'output_token'
    GROUP BY price_book_id, model, meter
  ) kept ON kept.price_book_id = duplicate.price_book_id AND kept.model = duplicate.model AND kept.meter = duplicate.meter
  WHERE duplicate.service_type = 'video' AND duplicate.meter = 'output_token' AND duplicate.id <> kept.keep_id
);
