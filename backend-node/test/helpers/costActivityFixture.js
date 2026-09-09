const { seedHistoricalCosts } = require('./historicalCostFixture');

// Synthetic original price snapshots, matched to the sanitized sample's units.
// No supplier account, cost price, import batch, or external request is needed.
function seedCostActivity(db, userId, dramaId = 73) {
  seedHistoricalCosts(db, userId, dramaId);
  for (const row of db.prepare('SELECT * FROM billing_usage_logs WHERE drama_id=?').all(dramaId)) {
    const video = row.service_type === 'video';
    const conditions = { provider: 'volcengine', currency: 'CNY', source: video ? 'https://www.volcengine.com/product/yunque' : 'https://www.volcengine.com/docs/fixture', verified_on: '2026-09-01',
      unit_size: video ? 1000000 : 60000 };
    const snapshot = { ...JSON.parse(row.snapshot_json), service_type: row.service_type, model: row.model, provider_model: row.model,
      usage: video ? { output_token: 9999999 } : { millisecond: 999999 },
      rates: [{ meter: video ? 'output_token' : 'millisecond', unit_price_micro: video ? 37000000 : 10000000,
        unit_size: conditions.unit_size, conditions, price_book_id: 1, price_book_name: '隔离验收原价快照',
        rate_id: video ? 'no_video_input' : '1080p_60', is_free: false }] };
    db.prepare('UPDATE billing_usage_logs SET snapshot_json=? WHERE id=?').run(JSON.stringify(snapshot), row.id);
    db.prepare('UPDATE billing_transactions SET snapshot_json=? WHERE id=?').run(JSON.stringify(snapshot), row.authorization_id);
    db.prepare('UPDATE billing_transactions SET snapshot_json=? WHERE id=?').run(JSON.stringify({ ...snapshot, actual_usage: JSON.parse(row.usage_json) }), row.transaction_id);
  }
}
module.exports = { seedCostActivity };
