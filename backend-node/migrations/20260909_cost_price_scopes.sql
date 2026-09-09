CREATE TABLE IF NOT EXISTS cost_price_scopes (
 price_id INTEGER PRIMARY KEY REFERENCES cost_prices(id),
 scope TEXT NOT NULL CHECK(scope IN ('platform','project')),
 drama_id INTEGER,
 CHECK((scope='platform' AND drama_id IS NULL) OR (scope='project' AND drama_id>0))
);
