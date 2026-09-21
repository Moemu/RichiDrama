-- Option B: provider-scoped tenant price-book bindings. A project group may
-- bind one published book per provider, so a multi-provider group prices each
-- model by the provider actually serving the call. provider='' is the legacy
-- catch-all slot that is backfilled from the old 1:1 binding table, keeping
-- existing group pricing exactly unchanged.
CREATE TABLE IF NOT EXISTS tenant_provider_price_book_bindings (
  tenant_id INTEGER NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  price_book_id INTEGER NOT NULL,
  active_at TEXT NOT NULL,
  created_by INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, provider)
);

INSERT INTO tenant_provider_price_book_bindings (tenant_id, provider, price_book_id, active_at, created_by, updated_at)
  SELECT b.tenant_id, COALESCE(pb.provider, ''), b.price_book_id, b.active_at, b.created_by, b.updated_at
  FROM tenant_price_book_bindings b
  JOIN billing_price_books pb ON pb.id = b.price_book_id
  WHERE b.tenant_id NOT IN (SELECT tenant_id FROM tenant_provider_price_book_bindings WHERE provider = '');

CREATE INDEX IF NOT EXISTS idx_tenant_provider_price_books ON tenant_provider_price_book_bindings(tenant_id, provider);
