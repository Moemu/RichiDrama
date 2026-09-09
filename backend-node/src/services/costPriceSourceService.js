'use strict';
const { randomUUID } = require('node:crypto');
const provider = require('./providerPriceService');

function candidate(item) {
  const charges = Array.isArray(item.ChargeItems) ? item.ChargeItems : [];
  const rules = charges.map(charge => {
    const meter = provider.chargeMeter(charge.Type, charge.UnitCode);
    const size = meter && provider.sourceUnitSize(charge.UnitCode, meter);
    if (!meter || !size || charge.Price == null) return null;
    // Price already includes the API's applicable discount. Keep OriginalPrice
    // for review; multiplying a discount here would apply it twice.
    return { meter, price: String(charge.Price), original_price: charge.OriginalPrice == null ? undefined : String(charge.OriginalPrice), unit_size: String(size) };
  });
  const complex = !!item.MultiChargeItems?.length || rules.some(rule => !rule) || !rules.length;
  return { model: item.FoundationModelName || item.Name, display_name: item.DisplayName,
    rules: complex ? [] : rules, requires_mapping: complex,
    evidence: { ChargeItems: charges, MultiChargeItems: item.MultiChargeItems || [] } };
}
async function fetchCandidates(db, actor, input) {
  const config = db.prepare(`SELECT c.id,c.settings FROM ai_service_configs c JOIN cost_account_bindings b ON b.config_id=c.id
    WHERE c.id=? AND b.account_id=? AND c.deleted_at IS NULL AND c.is_active=1 AND c.service_type='model_ark_asset'`).get(Number(input.config_id), Number(input.account_id));
  if (!config) throw new Error('请选择明确绑定该供应商账号的有效 ModelArk IAM 配置');
  const settings = JSON.parse(config.settings || '{}');
  if (!settings.access_key_id || !settings.secret_access_key) throw new Error('所选配置缺少 IAM AK/SK');
  const result = await provider.fetchAllActivations({ configId: config.id, accessKeyId: settings.access_key_id, secretAccessKey: settings.secret_access_key, region: settings.sign_region || 'cn-beijing' });
  const evidence = { request_ids: result.requestIds, candidates: result.items.map(candidate) };
  const id = randomUUID();
  db.prepare('INSERT INTO cost_price_sources VALUES(?,?,?,?,?,?)').run(id, Number(input.account_id), config.id, new Date().toISOString(), actor, JSON.stringify(evidence));
  return get(db, id);
}
function get(db, id) {
  const row = db.prepare('SELECT * FROM cost_price_sources WHERE id=?').get(id);
  return row ? { ...row, evidence: JSON.parse(row.evidence_json) } : null;
}
module.exports = { candidate, fetchCandidates, get };
