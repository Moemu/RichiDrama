-- A billing key decouples a provider/model transport from the price-book SKU.
ALTER TABLE ai_service_configs ADD COLUMN billing_key TEXT;
CREATE INDEX IF NOT EXISTS idx_ai_service_configs_billing_key ON ai_service_configs(service_type, billing_key);
