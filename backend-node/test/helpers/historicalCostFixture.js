const sample = require('../fixtures/historicalCostUsage.json');
function seedHistoricalCosts(db, userId, dramaId = 73) {
  const at = '2026-09-08T03:00:00.000Z';
  db.prepare('INSERT INTO dramas(id,title,owner_user_id,created_at,updated_at) VALUES(?,?,?,?,?)').run(dramaId, '历史用量脱敏样本', userId, at, at);
  const transaction = db.prepare(`INSERT INTO billing_transactions(id,user_id,type,amount_micro,balance_after_micro,frozen_after_micro,authorization_id,snapshot_json,created_at) VALUES(?,?,?,?,0,0,?,?,?)`);
  const log = db.prepare(`INSERT INTO billing_usage_logs(id,user_id,transaction_id,authorization_id,drama_id,project_title_snapshot,service_type,model,usage_json,charged_micro,provider_request_id,snapshot_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const [i, row] of sample.rows.entries()) {
    const id = `legacy-${i}`, authorization = `legacy-auth-${i}`, settlement = `legacy-settlement-${i}`;
    const snapshot = { account_scope: 'personal', pricing_context: row.pricing_context };
    transaction.run(authorization, userId, 'authorization', 0, null, JSON.stringify(snapshot), at);
    transaction.run(settlement, userId, 'settlement', -row.charged_micro, authorization, JSON.stringify({ ...snapshot, actual_usage: row.usage }), at);
    log.run(id, userId, settlement, authorization, dramaId, '历史项目名称', row.service_type, row.model, JSON.stringify(row.usage), row.charged_micro, `legacy-request-${i}`, JSON.stringify(snapshot), at);
  }
}
module.exports = { seedHistoricalCosts };
