-- Price books gain an owning price source so a relay draft can never clone the
-- Volcengine system book, and vice versa. Existing system-managed books all
-- belong to Volcengine, so the backfill keeps current behaviour exactly. Books
-- created by tenants or admins stay NULL and match only the legacy path.
ALTER TABLE billing_price_books ADD COLUMN provider TEXT;
UPDATE billing_price_books SET provider = 'volcengine' WHERE system_managed = 1 AND provider IS NULL;
CREATE INDEX IF NOT EXISTS idx_price_books_provider ON billing_price_books(provider, status, system_managed, version);
