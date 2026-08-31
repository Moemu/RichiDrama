ALTER TABLE provider_price_candidates ADD COLUMN new_conditions_json TEXT;
ALTER TABLE provider_price_candidates ADD COLUMN conditions_changed INTEGER NOT NULL DEFAULT 0;
