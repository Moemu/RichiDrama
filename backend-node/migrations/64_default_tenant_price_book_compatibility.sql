-- Restore dynamic global price-book resolution only for the compatibility
-- default group. Custom tenant bindings are never touched.
DELETE FROM tenant_price_book_bindings
WHERE tenant_id IN (SELECT id FROM tenants WHERE name = '默认项目组');
