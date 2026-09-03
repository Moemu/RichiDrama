-- ToC payment orders. This migration only adds new records and does not
-- change historical billing accounts or transactions.
CREATE TABLE IF NOT EXISTS payment_orders (
  id TEXT PRIMARY KEY,
  out_trade_no TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('alipay', 'wechat')),
  amount_fen INTEGER NOT NULL CHECK(amount_fen > 0),
  credits_micro INTEGER NOT NULL CHECK(credits_micro > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'closed', 'expired', 'review_required', 'failed')),
  client_request_id TEXT NOT NULL,
  provider_trade_no TEXT,
  code_url TEXT,
  last_query_at TEXT,
  expires_at TEXT NOT NULL,
  paid_at TEXT,
  closed_at TEXT,
  failure_code TEXT,
  failure_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, client_request_id)
);

CREATE TABLE IF NOT EXISTS payment_order_events (
  id TEXT PRIMARY KEY,
  payment_order_id TEXT,
  channel TEXT NOT NULL CHECK(channel IN ('alipay', 'wechat')),
  provider_event_id TEXT,
  event_type TEXT NOT NULL,
  signature_valid INTEGER NOT NULL DEFAULT 0,
  detail_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(channel, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_user_created ON payment_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status_expires ON payment_orders(status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_provider_trade ON payment_orders(channel, provider_trade_no) WHERE provider_trade_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_events_order_created ON payment_order_events(payment_order_id, created_at DESC);
