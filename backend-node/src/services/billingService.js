const { v4: uuid } = require('uuid');

function now() { return new Date().toISOString(); }
function json(v) { return JSON.stringify(v == null ? {} : v); }
function parse(v, fallback = {}) { try { return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } }
// 100 points = CNY 1. Store integer micro-points so small real usage is not
// rounded down to zero points.
const POINT_SCALE = 10000;
function microToCredits(v) { return Number(v || 0) / POINT_SCALE; }
function creditsToMicro(v) {
  const raw = String(v ?? '').trim();
  if (!/^-?\d+(?:\.\d{1,4})?$/.test(raw)) throw new Error('积分最多支持四位小数');
  const negative = raw.startsWith('-');
  const [wholeText, fractionText = ''] = (negative ? raw.slice(1) : raw).split('.');
  const whole = BigInt(wholeText) * BigInt(POINT_SCALE);
  const fraction = BigInt((fractionText + '0000').slice(0, 4));
  const result = negative ? -(whole + fraction) : whole + fraction;
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('积分超出安全范围');
  return Number(result);
}

function account(db, userId) {
  const at = now();
  db.prepare('INSERT OR IGNORE INTO billing_accounts (user_id, updated_at) VALUES (?, ?)').run(userId, at);
  return db.prepare('SELECT * FROM billing_accounts WHERE user_id = ?').get(userId);
}

function publicAccount(row) {
  return {
    user_id: row.user_id,
    balance_micro: row.balance_micro,
    frozen_micro: row.frozen_micro,
    available_micro: row.balance_micro - row.frozen_micro,
    balance: microToCredits(row.balance_micro), frozen: microToCredits(row.frozen_micro), available: microToCredits(row.balance_micro - row.frozen_micro),
    total_recharged: microToCredits(row.total_recharged_micro), total_consumed: microToCredits(row.total_consumed_micro), updated_at: row.updated_at,
  };
}

function audit(db, actorId, action, targetType, targetId, detail) {
  db.prepare('INSERT INTO billing_audit_logs (id, actor_user_id, action, target_type, target_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uuid(), actorId, action, targetType, targetId == null ? null : String(targetId), json(detail), now());
}

function activePriceItems(db, userId, serviceType, model) {
  const at = now();
  const tenantBook = require('./tenantService').priceBookForUser(db, userId);
  if (tenantBook) {
    return db.prepare(`SELECT pbi.*, pb.id AS price_book_id, pb.name AS price_book_name, pb.owner_user_id
      FROM billing_price_book_items pbi JOIN billing_price_books pb ON pb.id = pbi.price_book_id
      WHERE pb.id = ? AND pb.status = 'published' AND (pb.effective_from IS NULL OR pb.effective_from <= ?)
        AND (pb.effective_to IS NULL OR pb.effective_to > ?) AND pbi.service_type = ? AND pbi.model = ?
      ORDER BY pbi.id DESC`).all(tenantBook.id, at, at, serviceType, model);
  }
  return db.prepare(`SELECT pbi.*, pb.id AS price_book_id, pb.name AS price_book_name, pb.owner_user_id
    FROM billing_price_book_items pbi JOIN billing_price_books pb ON pb.id = pbi.price_book_id
    WHERE pb.status = 'published' AND (pb.effective_from IS NULL OR pb.effective_from <= ?)
      AND (pb.effective_to IS NULL OR pb.effective_to > ?) AND (pb.owner_user_id IS NULL OR pb.owner_user_id = ?)
      AND pbi.service_type = ? AND pbi.model = ?
    ORDER BY CASE WHEN pb.owner_user_id = ? THEN 0 ELSE 1 END, pb.updated_at DESC, pbi.id DESC`).all(at, at, userId, serviceType, model, userId);
}

function activeMeters(db, user, serviceType, model) {
  return [...new Set(activePriceItems(db, user.id, serviceType, model).map((item) => item.meter))];
}

function normalizeUsage(usage) {
  const allowed = ['request', 'image', 'second', 'millisecond', 'character', 'input_token', 'output_token'];
  const clean = {};
  for (const meter of allowed) {
    const v = Number(usage?.[meter] || 0);
    if (!Number.isSafeInteger(v) || v < 0) throw new Error(`非法用量：${meter} 必须为非负整数`);
    if (v) clean[meter] = v;
  }
  if (!Object.keys(clean).length) clean.request = 1;
  return clean;
}

function parseConditions(value) { return parse(value, {}); }

// usage_tiers is internal price-book metadata. It only reads canonical meters
// already returned by providers (input_token / output_token); it never adds a
// field to a provider request or fabricates provider usage.
function tierFor(conditions, usage) {
  const tiers = Array.isArray(conditions.usage_tiers) ? conditions.usage_tiers : [];
  if (!tiers.length) return null;
  for (const tier of tiers) {
    const meter = String(tier.selector_meter || '').trim();
    const quantity = usage?.[meter];
    if (!['input_token', 'output_token'].includes(meter) || !Number.isSafeInteger(quantity) || quantity < 0) continue;
    const min = tier.min_inclusive == null ? 0 : Number(tier.min_inclusive);
    const max = tier.max_inclusive == null ? Number.MAX_SAFE_INTEGER : Number(tier.max_inclusive);
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < min) continue;
    if (quantity >= min && quantity <= max) return tier;
  }
  const selectors = [...new Set(tiers.map((tier) => String(tier.selector_meter || '').trim()).filter(Boolean))];
  throw new Error(`价目未覆盖实际 ${selectors.join('/') || 'token'} 用量，已拒绝调用`);
}

function rateFor(row, context = {}, usage = {}) {
  const conditions = parseConditions(row.conditions_json);
  const rates = Array.isArray(conditions.rates) ? conditions.rates : [];
  // Prefer the most specific matching condition instead of trusting the
  // administrator's JSON-array order. Price-book validation rejects equally
  // specific overlapping rules, so this remains deterministic.
  const selected = rates.filter((rate) => Object.entries(rate.when || {}).every(([k, v]) => context[k] === v))
    .sort((left, right) => Object.keys(right.when || {}).length - Object.keys(left.when || {}).length)[0]
    || rates.find((rate) => rate.id === conditions.default_rate_id)
    || null;
  const tier = tierFor(conditions, usage);
  const unitPrice = tier
    ? creditsToMicro(tier.unit_price_points)
    : selected ? creditsToMicro(selected.unit_price_points) : Number(row.unit_price_micro);
  const unitSize = Number(tier?.unit_size ?? selected?.unit_size ?? conditions.unit_size ?? 1);
  if (!Number.isSafeInteger(unitPrice) || unitPrice < 0 || !Number.isSafeInteger(unitSize) || unitSize <= 0) {
    throw new Error(`模型 ${row.model} 的价格配置无效`);
  }
  return { unit_price_micro: unitPrice, unit_size: unitSize, rate_id: tier?.id || selected?.id || null, conditions };
}
function proratedPoints(quantity, unitPrice, unitSize) {
  const q = BigInt(quantity), price = BigInt(unitPrice), size = BigInt(unitSize);
  // Round half up to the nearest whole point, entirely in integer arithmetic.
  const result = (q * price + size / 2n) / size;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('计费金额超出安全范围');
  return Number(result);
}

function quote(db, user, input) {
  const serviceType = String(input.service_type || '').trim(); const model = String(input.model || '').trim();
  if (!serviceType || !model) throw new Error('service_type 和 model 必填');
  const usage = normalizeUsage(input.usage);
  const rows = activePriceItems(db, user.id, serviceType, model);
  const byMeter = new Map(); for (const row of rows) if (!byMeter.has(row.meter)) byMeter.set(row.meter, row);
  const rates = []; let amountMicro = 0;
  for (const [meter, qty] of Object.entries(usage)) {
    const price = byMeter.get(meter);
    if (!price) throw new Error(`模型 ${model} 的 ${meter} 未定价，已拒绝调用`);
    const rate = rateFor(price, input.pricing_context || {}, usage);
    const subtotal = price.is_free ? 0 : proratedPoints(qty, rate.unit_price_micro, rate.unit_size);
    amountMicro += subtotal;
    if (!Number.isSafeInteger(amountMicro)) throw new Error('计费金额超出安全范围');
    rates.push({ meter, quantity: qty, unit_price_micro: rate.unit_price_micro, unit_size: rate.unit_size, rate_id: rate.rate_id, conditions: rate.conditions, is_free: !!price.is_free, subtotal_micro: subtotal, price_book_id: price.price_book_id, price_book_name: price.price_book_name });
  }
  return { user_id: user.id, service_type: serviceType, model, usage, pricing_context: input.pricing_context || {}, amount_micro: amountMicro, amount: microToCredits(amountMicro), rates, quoted_at: now() };
}

function createAuthorization(db, user, input) {
  const idempotencyKey = String(input.idempotency_key || '').trim(); if (!idempotencyKey) throw new Error('idempotency_key 必填');
  const existing = db.prepare("SELECT * FROM billing_transactions WHERE user_id = ? AND idempotency_key = ? AND type = 'authorization'").get(user.id, idempotencyKey);
  if (existing) return { authorization_id: existing.id, amount_micro: existing.amount_micro, amount: microToCredits(existing.amount_micro), reused: true, snapshot: parse(existing.snapshot_json) };
  assertReconciliationLimit(db, user.id, input.service_type, input.model);
  const priced = quote(db, user, input); const at = now(); const id = uuid();
  const tenantId = require('./tenantService').tenantForUser(db, user.id)?.id || null;
  const execute = db.transaction(() => {
    const acct = account(db, user.id); const available = acct.balance_micro - acct.frozen_micro;
    if (available < priced.amount_micro) throw new Error('余额不足');
    const frozenAfter = acct.frozen_micro + priced.amount_micro;
    db.prepare('UPDATE billing_accounts SET frozen_micro = ?, updated_at = ? WHERE user_id = ?').run(frozenAfter, at, user.id);
    const snapshot = { ...priced, tenant_id: tenantId, reference_type: input.reference_type || null, reference_id: input.reference_id || null };
    db.prepare(`INSERT INTO billing_transactions (id, user_id, tenant_id, type, amount_micro, balance_after_micro, frozen_after_micro, authorization_id, idempotency_key, reference_type, reference_id, reason, snapshot_json, created_at)
      VALUES (?, ?, ?, 'authorization', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, user.id, tenantId, priced.amount_micro, acct.balance_micro, frozenAfter, id, idempotencyKey, input.reference_type || null, input.reference_id || null, input.reason || null, json(snapshot), at);
  });
  execute();
  return { authorization_id: id, amount_micro: priced.amount_micro, amount: microToCredits(priced.amount_micro), snapshot: priced };
}

function getAuthorization(db, authorizationId) {
  const row = db.prepare("SELECT * FROM billing_transactions WHERE id = ? AND type = 'authorization'").get(authorizationId);
  return row ? { ...row, snapshot: parse(row.snapshot_json) } : null;
}

function calculateFromSnapshot(snapshot, actualUsage) {
  const usage = normalizeUsage(actualUsage || snapshot.usage); let amount = 0;
  for (const [meter, qty] of Object.entries(usage)) {
    const rate = (snapshot.rates || []).find((r) => r.meter === meter);
    if (!rate) throw new Error(`预授权快照中没有 ${meter} 价格`);
    const tier = tierFor(rate.conditions || {}, usage);
    const unitPrice = tier ? creditsToMicro(tier.unit_price_points) : rate.unit_price_micro;
    const unitSize = Number(tier?.unit_size ?? rate.unit_size ?? 1);
    amount += rate.is_free ? 0 : proratedPoints(qty, unitPrice, unitSize);
  }
  return { usage, amount_micro: amount };
}

function settleAuthorization(db, user, authorizationId, input = {}) {
  const auth = db.prepare("SELECT * FROM billing_transactions WHERE id = ? AND type = 'authorization'").get(authorizationId);
  if (!auth || (auth.user_id !== user.id && user.role !== 'admin')) throw new Error('预授权不存在');
  const completed = db.prepare('SELECT * FROM billing_usage_logs WHERE authorization_id = ?').get(authorizationId);
  if (completed) return { transaction_id: completed.transaction_id, charged_micro: completed.charged_micro, charged: microToCredits(completed.charged_micro), reused: true };
  const snapshot = parse(auth.snapshot_json); const actual = calculateFromSnapshot(snapshot, input.usage); const at = now(); const id = uuid();
  // The authorization is an estimate, not a settlement cap. Once a provider
  // returns verifiable usage we must charge that real usage, including the
  // supplemental amount above the reservation. Do this atomically only when
  // the account can cover it after this authorization is released; otherwise
  // leave the authorization frozen so the caller can create a reconciliation
  // case instead of silently undercharging or overdrawing the account.
  const chargedMicro = actual.amount_micro;
  const supplementalMicro = Math.max(0, chargedMicro - auth.amount_micro);
  const execute = db.transaction(() => {
    const acct = account(db, auth.user_id);
    if (acct.frozen_micro < auth.amount_micro) throw new Error('预授权冻结状态异常');
    const availableAfterRelease = acct.balance_micro - (acct.frozen_micro - auth.amount_micro);
    if (availableAfterRelease < chargedMicro) {
      const error = new Error('实际用量超出预授权且可用余额不足，等待管理员对账');
      error.code = 'BILLING_ACTUAL_USAGE_EXCEEDS_AVAILABLE_BALANCE';
      error.actual_micro = chargedMicro;
      error.authorized_micro = auth.amount_micro;
      error.supplemental_micro = supplementalMicro;
      throw error;
    }
    const balanceAfter = acct.balance_micro - chargedMicro; const frozenAfter = acct.frozen_micro - auth.amount_micro;
    db.prepare(`UPDATE billing_accounts SET balance_micro = ?, frozen_micro = ?, total_consumed_micro = total_consumed_micro + ?, updated_at = ? WHERE user_id = ?`)
      .run(balanceAfter, frozenAfter, chargedMicro, at, auth.user_id);
    db.prepare(`INSERT INTO billing_transactions (id, user_id, tenant_id, type, amount_micro, balance_after_micro, frozen_after_micro, authorization_id, reference_type, reference_id, reason, snapshot_json, created_at)
      VALUES (?, ?, ?, 'settlement', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, auth.user_id, auth.tenant_id || null, -chargedMicro, balanceAfter, frozenAfter, authorizationId, auth.reference_type, auth.reference_id, input.reason || null, json({ ...snapshot, actual_usage: actual.usage, authorized_micro: auth.amount_micro, charged_micro: chargedMicro, supplemental_charged_micro: supplementalMicro, overage_micro: supplementalMicro }), at);
    db.prepare(`INSERT INTO billing_usage_logs (id, user_id, tenant_id, transaction_id, authorization_id, service_type, model, usage_json, charged_micro, provider_request_id, reference_type, reference_id, snapshot_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uuid(), auth.user_id, auth.tenant_id || null, id, authorizationId, snapshot.service_type, snapshot.model, json(actual.usage), chargedMicro, input.provider_request_id || null, auth.reference_type, auth.reference_id, json(snapshot), at);
  });
  execute(); return { transaction_id: id, charged_micro: chargedMicro, charged: microToCredits(chargedMicro), supplemental_charged_micro: supplementalMicro, overage_micro: supplementalMicro, reused: false };
}

// Historical capped settlements must be repaired through a linked, idempotent
// ledger entry instead of an opaque balance adjustment. This is deliberately
// admin-only: it uses the already persisted provider usage and authorization
// price snapshot, and never re-prices an old task from today's price book.
function collectSettlementSupplement(db, actor, authorizationId, reason) {
  if (actor.role !== 'admin') throw new Error('仅管理员可以补扣已结算的实际用量差额');
  const auth = getAuthorization(db, authorizationId);
  if (!auth) throw new Error('预授权不存在');
  const settlement = db.prepare("SELECT * FROM billing_transactions WHERE authorization_id=? AND type='settlement' ORDER BY created_at LIMIT 1").get(authorizationId);
  const usageLog = db.prepare('SELECT * FROM billing_usage_logs WHERE authorization_id=? ORDER BY created_at LIMIT 1').get(authorizationId);
  if (!settlement || !usageLog) throw new Error('该预授权尚无可补扣的已结算真实用量');
  const actual = calculateFromSnapshot(auth.snapshot, parse(usageLog.usage_json));
  const alreadySupplemented = Number(db.prepare("SELECT COALESCE(SUM(-amount_micro), 0) AS amount FROM billing_transactions WHERE authorization_id=? AND type='adjustment' AND idempotency_key LIKE ?").get(authorizationId, `settlement-supplement:${authorizationId}:%`).amount || 0);
  const originallyCharged = Math.abs(Number(settlement.amount_micro || 0));
  const supplementalMicro = Math.max(0, actual.amount_micro - originallyCharged - alreadySupplemented);
  if (!supplementalMicro) return { authorization_id: authorizationId, supplemental_micro: 0, supplemental: 0, reused: true };
  const idempotencyKey = `settlement-supplement:${authorizationId}:${actual.amount_micro}`;
  const existing = db.prepare('SELECT * FROM billing_transactions WHERE user_id=? AND idempotency_key=?').get(auth.user_id, idempotencyKey);
  if (existing) return { authorization_id: authorizationId, transaction_id: existing.id, supplemental_micro: Math.abs(Number(existing.amount_micro || 0)), supplemental: microToCredits(Math.abs(Number(existing.amount_micro || 0))), reused: true };
  const at = now(); const id = uuid();
  db.transaction(() => {
    const acct = account(db, auth.user_id);
    if (acct.balance_micro - acct.frozen_micro < supplementalMicro) {
      const error = new Error('历史实际用量差额补扣时可用余额不足，等待管理员对账');
      error.code = 'BILLING_ACTUAL_USAGE_EXCEEDS_AVAILABLE_BALANCE';
      error.actual_micro = actual.amount_micro;
      error.supplemental_micro = supplementalMicro;
      throw error;
    }
    const balanceAfter = acct.balance_micro - supplementalMicro;
    db.prepare('UPDATE billing_accounts SET balance_micro=?, total_consumed_micro=total_consumed_micro+?, updated_at=? WHERE user_id=?')
      .run(balanceAfter, supplementalMicro, at, auth.user_id);
    db.prepare(`INSERT INTO billing_transactions (id, user_id, tenant_id, type, amount_micro, balance_after_micro, frozen_after_micro, authorization_id, idempotency_key, reference_type, reference_id, reason, created_by, snapshot_json, created_at)
      VALUES (?, ?, ?, 'adjustment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, auth.user_id, auth.tenant_id || null, -supplementalMicro, balanceAfter, acct.frozen_micro, authorizationId, idempotencyKey, auth.reference_type, auth.reference_id,
        String(reason || '').trim() || '按供应商真实用量补扣历史结算差额', actor.id,
        json({ authorization_id: authorizationId, settlement_transaction_id: settlement.id, actual_usage: actual.usage, actual_micro: actual.amount_micro, originally_charged_micro: originallyCharged, already_supplemented_micro: alreadySupplemented, supplemental_micro: supplementalMicro }), at);
    db.prepare('UPDATE billing_usage_logs SET charged_micro=charged_micro+? WHERE id=?').run(supplementalMicro, usageLog.id);
  })();
  audit(db, actor.id, 'billing.settlement.supplement', 'authorization', authorizationId, { settlement_transaction_id: settlement.id, supplemental_micro: supplementalMicro, reason: reason || null });
  return { authorization_id: authorizationId, transaction_id: id, supplemental_micro: supplementalMicro, supplemental: microToCredits(supplementalMicro), reused: false };
}

function historicalSettlementSupplementCandidates(db, actor) {
  if (actor.role !== 'admin') throw new Error('仅管理员可以查看历史结算补扣范围');
  const rows = db.prepare(`SELECT a.id AS authorization_id, a.user_id, a.amount_micro AS authorized_micro,
      s.id AS settlement_transaction_id, s.amount_micro AS settlement_amount_micro,
      u.id AS usage_log_id, u.charged_micro AS usage_charged_micro, u.usage_json, a.snapshot_json
    FROM billing_transactions a
    JOIN billing_transactions s ON s.authorization_id = a.id AND s.type = 'settlement'
    JOIN billing_usage_logs u ON u.authorization_id = a.id
    WHERE a.type = 'authorization'
    ORDER BY a.created_at, a.id`).all();
  const supplementalStmt = db.prepare("SELECT COALESCE(SUM(-amount_micro), 0) AS amount FROM billing_transactions WHERE authorization_id=? AND type='adjustment' AND idempotency_key LIKE ?");
  return rows.map((row) => {
    try {
      const actual = calculateFromSnapshot(parse(row.snapshot_json), parse(row.usage_json));
      const alreadySupplemented = Number(supplementalStmt.get(row.authorization_id, `settlement-supplement:${row.authorization_id}:%`).amount || 0);
      const originallyCharged = Math.abs(Number(row.settlement_amount_micro || 0));
      const supplementalMicro = Math.max(0, actual.amount_micro - originallyCharged - alreadySupplemented);
      return {
        authorization_id: row.authorization_id,
        user_id: row.user_id,
        settlement_transaction_id: row.settlement_transaction_id,
        authorized_micro: Number(row.authorized_micro || 0),
        originally_charged_micro: originallyCharged,
        actual_micro: actual.amount_micro,
        already_supplemented_micro: alreadySupplemented,
        supplemental_micro: supplementalMicro,
        usage: actual.usage,
      };
    } catch (error) {
      return { authorization_id: row.authorization_id, user_id: row.user_id, error: error.message, supplemental_micro: 0 };
    }
  }).filter((row) => row.supplemental_micro > 0 || row.error);
}

// This is intentionally explicit and admin-only. It repairs every legacy
// capped settlement from the immutable authorization snapshot and the
// persisted provider usage, never from today's price book. Each item delegates
// to the same idempotent per-authorization collector, so rerunning a batch is
// safe. Accounts without enough available balance are reported, not overdraft.
function collectHistoricalSettlementSupplements(db, actor, input = {}) {
  if (actor.role !== 'admin') throw new Error('仅管理员可以批量补扣历史结算差额');
  if (input.confirm !== true) throw new Error('请显式确认后再执行历史结算补扣');
  const candidates = historicalSettlementSupplementCandidates(db, actor).filter((row) => row.supplemental_micro > 0);
  const results = []; let collectedMicro = 0; let insufficientCount = 0; let errorCount = 0;
  for (const candidate of candidates) {
    try {
      const result = collectSettlementSupplement(db, actor, candidate.authorization_id, input.reason || '按供应商真实用量批量补扣历史结算差额');
      collectedMicro += Number(result.supplemental_micro || 0);
      results.push({ ...result, status: result.reused ? 'reused' : 'collected' });
    } catch (error) {
      if (error.code === 'BILLING_ACTUAL_USAGE_EXCEEDS_AVAILABLE_BALANCE') {
        insufficientCount += 1;
        results.push({ authorization_id: candidate.authorization_id, user_id: candidate.user_id, supplemental_micro: candidate.supplemental_micro, status: 'insufficient_balance', error: error.message });
      } else {
        errorCount += 1;
        results.push({ authorization_id: candidate.authorization_id, user_id: candidate.user_id, supplemental_micro: candidate.supplemental_micro, status: 'error', error: error.message });
      }
    }
  }
  const summary = { candidate_count: candidates.length, collected_count: results.filter((row) => row.status === 'collected').length, collected_micro: collectedMicro, insufficient_balance_count: insufficientCount, error_count: errorCount };
  audit(db, actor.id, 'billing.settlement.supplement.batch', 'billing', 'historical-capped-settlements', summary);
  return { ...summary, collected: microToCredits(collectedMicro), results };
}

function voidAuthorization(db, user, authorizationId, reason) {
  const auth = db.prepare("SELECT * FROM billing_transactions WHERE id = ? AND type = 'authorization'").get(authorizationId);
  if (!auth || (auth.user_id !== user.id && user.role !== 'admin')) throw new Error('预授权不存在');
  const existing = db.prepare("SELECT * FROM billing_transactions WHERE authorization_id = ? AND type IN ('void', 'settlement')").get(authorizationId);
  if (existing) return { authorization_id: authorizationId, released_micro: auth.amount_micro, reused: true };
  const at = now(); const id = uuid();
  db.transaction(() => {
    const acct = account(db, auth.user_id); if (acct.frozen_micro < auth.amount_micro) throw new Error('预授权冻结状态异常');
    const frozenAfter = acct.frozen_micro - auth.amount_micro;
    db.prepare('UPDATE billing_accounts SET frozen_micro = ?, updated_at = ? WHERE user_id = ?').run(frozenAfter, at, auth.user_id);
    db.prepare(`INSERT INTO billing_transactions (id, user_id, tenant_id, type, amount_micro, balance_after_micro, frozen_after_micro, authorization_id, reference_type, reference_id, reason, snapshot_json, created_at)
      VALUES (?, ?, ?, 'void', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, auth.user_id, auth.tenant_id || null, 0, acct.balance_micro, frozenAfter, authorizationId, auth.reference_type, auth.reference_id, reason || '调用未完成，释放预授权', auth.snapshot_json, at);
  })();
  return { authorization_id: authorizationId, released_micro: auth.amount_micro, released: microToCredits(auth.amount_micro) };
}

const RECONCILIATION_LIMIT_PER_MODEL = 3;
function assertReconciliationLimit(db, userId, serviceType, model) {
  const pending = db.prepare(`SELECT COUNT(*) AS count FROM billing_reconciliation_cases
    WHERE user_id = ? AND service_type = ? AND model = ? AND status = 'pending'`)
    .get(userId, String(serviceType || ''), String(model || '')).count;
  if (pending >= RECONCILIATION_LIMIT_PER_MODEL) {
    throw new Error(`该模型有 ${pending} 笔待对账调用，暂不能继续调用；请等待供应商用量返回或联系管理员处理`);
  }
}

function reconciliationDueAt() {
  const configured = Number(process.env.BILLING_RECONCILIATION_TIMEOUT_HOURS || 24);
  const hours = Number.isFinite(configured) && configured > 0 ? configured : 24;
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function markPendingReconciliation(db, user, authorizationId, input = {}) {
  const auth = getAuthorization(db, authorizationId);
  if (!auth || (auth.user_id !== user.id && user.role !== 'admin')) throw new Error('预授权不存在');
  const completed = db.prepare("SELECT 1 FROM billing_transactions WHERE authorization_id = ? AND type IN ('void', 'settlement')").get(authorizationId);
  if (completed) return { authorization_id: authorizationId, skipped: true };
  const existing = db.prepare('SELECT * FROM billing_reconciliation_cases WHERE authorization_id = ?').get(authorizationId);
  if (existing) return publicReconciliationCase(existing);
  const snapshot = auth.snapshot || {};
  const record = {
    id: uuid(), authorization_id: authorizationId, user_id: auth.user_id,
    service_type: snapshot.service_type, model: snapshot.model,
    provider_request_id: input.provider_request_id || null,
    reason: input.reason || '供应商成功响应但未返回可核验用量',
    observed_usage_json: input.observed_usage ? json(input.observed_usage) : null,
    due_at: input.due_at || reconciliationDueAt(), created_at: now(),
  };
  db.prepare(`INSERT INTO billing_reconciliation_cases
    (id, authorization_id, user_id, service_type, model, provider_request_id, status, reason, observed_usage_json, due_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`)
    .run(record.id, record.authorization_id, record.user_id, record.service_type, record.model, record.provider_request_id, record.reason, record.observed_usage_json, record.due_at, record.created_at);
  audit(db, user.id, 'billing.reconciliation.pending', 'authorization', authorizationId, {
    service_type: record.service_type, model: record.model, provider_request_id: record.provider_request_id, due_at: record.due_at, reason: record.reason,
  });
  return publicReconciliationCase({ ...record, status: 'pending' });
}

// Video completion is asynchronous.  If the worker is interrupted after the
// provider succeeds but before it writes the reconciliation case, keep the
// reservation visible and recover it on the next application start.  We do
// not estimate a charge here: only a later provider usage record can settle it.
function recoverCompletedVideoReconciliations(db) {
  const rows = db.prepare(`SELECT v.id, v.owner_user_id, v.billing_authorization_id, v.provider_task_id
    FROM video_generations v
    JOIN billing_transactions a ON a.id = v.billing_authorization_id AND a.type = 'authorization'
    LEFT JOIN billing_transactions completed ON completed.authorization_id = a.id AND completed.type IN ('void', 'settlement')
    LEFT JOIN billing_reconciliation_cases c ON c.authorization_id = a.id
    WHERE v.status = 'completed'
      AND v.owner_user_id IS NOT NULL
      AND v.billing_authorization_id IS NOT NULL
      AND completed.id IS NULL
      AND c.id IS NULL`).all();
  let recovered = 0;
  for (const row of rows) {
    const auth = getAuthorization(db, row.billing_authorization_id);
    if (!require('./billingUsageService').hasTokenMeter(auth?.snapshot)) continue;
    markPendingReconciliation(db, { id: row.owner_user_id, role: 'admin' }, row.billing_authorization_id, {
      provider_request_id: row.provider_task_id || `video-generation:${row.id}`,
      reason: '视频已完成，但未取得供应商可核验 token 用量；已恢复为待对账',
    });
    recovered += 1;
  }
  return { recovered };
}

// A synchronous text response can be interrupted by a development hot reload
// after the upstream accepted it but before settlement is persisted.  On the
// next boot make that reservation auditable instead of leaving an invisible
// frozen balance.  It is deliberately not settled from the reservation.
function recoverInterruptedTextReconciliations(db) {
  const rows = db.prepare(`SELECT a.id, a.user_id
    FROM billing_transactions a
    LEFT JOIN billing_transactions completed ON completed.authorization_id = a.id AND completed.type IN ('void', 'settlement')
    LEFT JOIN billing_reconciliation_cases c ON c.authorization_id = a.id
    WHERE a.type = 'authorization'
      AND a.reference_type = 'text_generation'
      AND completed.id IS NULL
      AND c.id IS NULL`).all();
  let recovered = 0;
  for (const row of rows) {
    const auth = getAuthorization(db, row.id);
    if (!require('./billingUsageService').hasTokenMeter(auth?.snapshot)) continue;
    markPendingReconciliation(db, { id: row.user_id, role: 'admin' }, row.id, {
      reason: '文本调用在结算前中断，未取得供应商可核验 token 用量；已恢复为待对账',
    });
    recovered += 1;
  }
  return { recovered };
}

function publicReconciliationCase(row) {
  return { ...row, observed_usage: parse(row.observed_usage_json, null), resolution: parse(row.resolution_json, null) };
}

// 后处理阶段（插帧/超分）授权兜底：视频已 failed/deleted 但阶段任务的预授权未结算时，
// 会形成用户永久冻结且对账队列不可见。按供应商是否已调用分类处置：
// - 未调用（无 provider 任务 ID）：直接 void 归还用户，无需人工核验
// - 已调用：生成待对账案件，由运营核验真实用量后结算或豁免
function recoverStuckStageAuthorizations(db) {
  const stageTables = [
    ['video_interpolation_jobs', '插帧', 'video_interpolation'],
    ['video_upscale_jobs', '超分', 'video_upscale'],
  ];
  let voided = 0; let reconciled = 0;
  for (const [table, label, refType] of stageTables) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (!exists) continue;
    const rows = db.prepare(`
      SELECT j.billing_authorization_id, j.provider_task_id, j.owner_user_id, j.video_generation_id, j.id AS job_id
      FROM ${table} j
      JOIN video_generations v ON v.id = j.video_generation_id
      WHERE j.billing_authorization_id IS NOT NULL
        AND (v.status = 'failed' OR v.deleted_at IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM billing_transactions t
                        WHERE t.authorization_id = j.billing_authorization_id AND t.type IN ('void', 'settlement'))`).all();
    for (const row of rows) {
      const providerTaskId = (row.provider_task_id || '').toString().trim();
      if (providerTaskId) {
        try {
          markPendingReconciliation(db, { id: row.owner_user_id, role: 'admin' }, row.billing_authorization_id, {
            provider_request_id: providerTaskId,
            reason: `视频已失败/删除但${label}预授权未结算且供应商已被调用，转待对账核验`,
          });
          reconciled += 1;
        } catch (_) {}
      } else {
        try {
          voidAuthorization(db, { id: row.owner_user_id, role: 'admin' }, row.billing_authorization_id, `视频已失败/删除，${label}未调用供应商，自动释放预授权`);
          db.prepare(`UPDATE ${table} SET status='cancelled', error_msg=COALESCE(error_msg, '') || '; ' || ?, updated_at=? WHERE id=? AND status NOT IN ('completed','cancelled')`)
            .run(`视频失败，${label}预授权已由启动扫描释放`, new Date().toISOString(), row.job_id);
          voided += 1;
        } catch (_) {}
      }
    }
  }
  return { voided, reconciled };
}

function listReconciliationCases(db, filters = {}) {
  let where = 'WHERE 1=1'; const args = [];
  if (filters.status) { where += ' AND c.status = ?'; args.push(String(filters.status)); }
  if (filters.user_id) { where += ' AND c.user_id = ?'; args.push(Number(filters.user_id)); }
  return db.prepare(`SELECT c.*, u.username, a.amount_micro AS frozen_amount_micro
    FROM billing_reconciliation_cases c JOIN users u ON u.id = c.user_id
    JOIN billing_transactions a ON a.id = c.authorization_id ${where}
    ORDER BY CASE WHEN c.status = 'pending' THEN 0 ELSE 1 END, c.due_at ASC LIMIT 300`).all(...args)
    .map((row) => ({ ...publicReconciliationCase(row), frozen_amount: microToCredits(row.frozen_amount_micro) }));
}

function pagedReconciliationCases(db, filters = {}) {
  let where = 'WHERE 1=1'; const args = [];
  if (filters.status) { where += ' AND c.status = ?'; args.push(String(filters.status)); }
  if (filters.user_id) { where += ' AND c.user_id = ?'; args.push(Number(filters.user_id)); }
  if (filters.model) { where += ' AND c.model = ?'; args.push(String(filters.model)); }
  if (filters.from) { where += ' AND c.created_at >= ?'; args.push(String(filters.from)); }
  if (filters.to) { where += ' AND c.created_at <= ?'; args.push(String(filters.to)); }
  const meta = pagination(filters);
  const total = Number(db.prepare(`SELECT COUNT(*) total FROM billing_reconciliation_cases c ${where}`).get(...args)?.total || 0);
  const rows = db.prepare(`SELECT c.*, u.username, a.amount_micro AS frozen_amount_micro
    FROM billing_reconciliation_cases c JOIN users u ON u.id = c.user_id
    JOIN billing_transactions a ON a.id = c.authorization_id ${where}
    ORDER BY CASE WHEN c.status = 'pending' THEN 0 ELSE 1 END, c.due_at ASC LIMIT ? OFFSET ?`).all(...args, meta.page_size, meta.offset);
  return { items: rows.map((row) => ({ ...publicReconciliationCase(row), frozen_amount: microToCredits(row.frozen_amount_micro) })), total, page: meta.page, page_size: meta.page_size };
}

function settleReconciliationCase(db, actor, caseId, input = {}) {
  if (actor.role !== 'admin') throw new Error('仅管理员可以处理待对账记录');
  const row = db.prepare('SELECT * FROM billing_reconciliation_cases WHERE id = ?').get(caseId);
  if (!row) throw new Error('待对账记录不存在');
  if (row.status !== 'pending') return publicReconciliationCase(row);
  const settled = settleAuthorization(db, actor, row.authorization_id, {
    usage: input.usage, provider_request_id: input.provider_request_id || row.provider_request_id,
    reason: input.reason || '管理员补录供应商可核验用量',
  });
  const at = now();
  db.prepare(`UPDATE billing_reconciliation_cases SET status='resolved', resolution_json=?, resolved_at=?, resolved_by=? WHERE id=? AND status='pending'`)
    .run(json({ usage: input.usage, transaction_id: settled.transaction_id, charged_micro: settled.charged_micro, reason: input.reason || null }), at, actor.id, caseId);
  audit(db, actor.id, 'billing.reconciliation.settled', 'reconciliation_case', caseId, { authorization_id: row.authorization_id, charged_micro: settled.charged_micro });
  return publicReconciliationCase(db.prepare('SELECT * FROM billing_reconciliation_cases WHERE id = ?').get(caseId));
}

function waiveReconciliationCase(db, actor, caseId, reason) {
  if (actor.role !== 'admin') throw new Error('仅管理员可以处理待对账记录');
  const row = db.prepare('SELECT * FROM billing_reconciliation_cases WHERE id = ?').get(caseId);
  if (!row) throw new Error('待对账记录不存在');
  if (row.status !== 'pending') return publicReconciliationCase(row);
  const released = voidAuthorization(db, actor, row.authorization_id, reason || '管理员豁免待对账预授权');
  const at = now();
  db.prepare(`UPDATE billing_reconciliation_cases SET status='waived', resolution_json=?, resolved_at=?, resolved_by=? WHERE id=? AND status='pending'`)
    .run(json({ released_micro: released.released_micro, reason: reason || null }), at, actor.id, caseId);
  audit(db, actor.id, 'billing.reconciliation.waived', 'reconciliation_case', caseId, { authorization_id: row.authorization_id, reason: reason || null });
  return publicReconciliationCase(db.prepare('SELECT * FROM billing_reconciliation_cases WHERE id = ?').get(caseId));
}

function expireReconciliationCases(db, actorId = 1, at = now()) {
  const rows = db.prepare("SELECT * FROM billing_reconciliation_cases WHERE status = 'pending' AND due_at <= ? ORDER BY due_at LIMIT 100").all(at);
  let expired = 0;
  for (const row of rows) {
    try {
      const released = voidAuthorization(db, { id: row.user_id, role: 'admin' }, row.authorization_id, '待对账超时，已释放预授权并记录异常损失');
      const changed = db.prepare(`UPDATE billing_reconciliation_cases SET status='expired', resolution_json=?, resolved_at=?, resolved_by=? WHERE id=? AND status='pending'`)
        .run(json({ released_micro: released.released_micro, reason: 'timeout_release' }), at, actorId, row.id);
      if (changed.changes) {
        audit(db, actorId, 'billing.reconciliation.expired', 'reconciliation_case', row.id, { authorization_id: row.authorization_id, released_micro: released.released_micro });
        expired += 1;
      }
    } catch (_) {}
  }
  return { expired };
}

function adjustBalance(db, actorId, userId, credits, reason, options = {}) {
  const amount = creditsToMicro(credits); if (!amount) throw new Error('调整金额不能为 0');
  const operation = ['grant', 'debit', 'refund'].includes(options.operation) ? options.operation : (amount > 0 ? 'grant' : 'debit');
  if ((operation === 'grant' || operation === 'refund') && amount < 0) throw new Error('发放或退款金额必须为正数');
  if (operation === 'debit' && amount > 0) throw new Error('扣减金额必须为负数');
  const idempotencyKey = String(options.idempotency_key || '').trim() || null;
  if (idempotencyKey) {
    const existing = db.prepare('SELECT id FROM billing_transactions WHERE user_id=? AND idempotency_key=?').get(userId, idempotencyKey);
    if (existing) return account(db, userId);
  }
  const at = now(); const id = uuid();
  db.transaction(() => {
    const acct = account(db, userId); const after = acct.balance_micro + amount;
    if (after < acct.frozen_micro || after < 0) throw new Error('调整后余额不能小于已冻结金额');
    const granted = operation === 'grant' && amount > 0 ? amount : 0;
    db.prepare(`UPDATE billing_accounts SET balance_micro = ?, total_recharged_micro = total_recharged_micro + ?, updated_at = ? WHERE user_id = ?`)
      .run(after, granted, at, userId);
    db.prepare(`INSERT INTO billing_transactions (id, user_id, tenant_id, type, amount_micro, balance_after_micro, frozen_after_micro, idempotency_key, reason, created_by, snapshot_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, userId, require('./tenantService').tenantForUser(db, userId)?.id || null, operation === 'grant' ? 'recharge' : 'adjustment', amount, after, acct.frozen_micro, idempotencyKey, String(reason || '').trim() || '管理员余额调整', actorId, json({ operation }), at);
  })();
  audit(db, actorId, 'billing.balance.adjust', 'user', userId, { amount_micro: amount, operation, idempotency_key: idempotencyKey, reason });
  return account(db, userId);
}

// A balance "set" is deliberately distinct from a recharge: it records the
// delta for auditability but makes the supplied value the final balance.
function setBalance(db, actorId, userId, targetCredits, reason, options = {}) {
  const target = creditsToMicro(targetCredits);
  if (target < 0) throw new Error('目标余额不能小于 0');
  const idempotencyKey = String(options.idempotency_key || '').trim() || null;
  if (idempotencyKey) {
    const existing = db.prepare('SELECT id FROM billing_transactions WHERE user_id=? AND idempotency_key=?').get(userId, idempotencyKey);
    if (existing) return account(db, userId);
  }
  const at = now(); const id = uuid(); let before = 0;
  db.transaction(() => {
    const acct = account(db, userId); before = acct.balance_micro;
    if (target < acct.frozen_micro) throw new Error('目标余额不能小于已冻结金额');
    if (target !== before) db.prepare('UPDATE billing_accounts SET balance_micro = ?, updated_at = ? WHERE user_id = ?').run(target, at, userId);
    db.prepare(`INSERT INTO billing_transactions (id, user_id, tenant_id, type, amount_micro, balance_after_micro, frozen_after_micro, idempotency_key, reason, created_by, snapshot_json, created_at)
      VALUES (?, ?, ?, 'adjustment', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, userId, require('./tenantService').tenantForUser(db, userId)?.id || null, target - before, target, acct.frozen_micro, idempotencyKey, String(reason || '').trim() || '管理员设置余额', actorId, json({ operation: 'set_balance', balance_before_micro: before, balance_target_micro: target }), at);
  })();
  audit(db, actorId, 'billing.balance.set', 'user', userId, { balance_before_micro: before, balance_target_micro: target, idempotency_key: idempotencyKey, reason });
  return account(db, userId);
}

function listUsers(db) {
  return db.prepare(`SELECT u.id, u.username, u.display_name, u.role, u.console_access, u.account_kind, u.is_active, u.created_at, u.last_login_at,
    tm.tenant_id, tm.role AS tenant_role, tenant.name AS tenant_name,
    COALESCE(a.balance_micro, 0) balance_micro, COALESCE(a.frozen_micro, 0) frozen_micro,
    COALESCE(a.total_recharged_micro, 0) total_recharged_micro, COALESCE(a.total_consumed_micro, 0) total_consumed_micro,
    COALESCE((SELECT SUM(t.amount_micro) FROM billing_transactions t WHERE t.user_id=u.id AND t.amount_micro>0 AND t.snapshot_json LIKE '%\"operation\":\"refund\"%'), 0) total_refunded_micro
    FROM users u LEFT JOIN billing_accounts a ON a.user_id = u.id
    LEFT JOIN tenant_memberships tm ON tm.user_id = u.id
    LEFT JOIN tenants tenant ON tenant.id = tm.tenant_id
    ORDER BY u.id`).all().map((r) => ({
      ...r, is_active: !!r.is_active, console_access: !!r.console_access, account_kind: r.account_kind || (r.role === 'admin' ? 'platform_admin' : 'creator'), balance: microToCredits(r.balance_micro), frozen: microToCredits(r.frozen_micro),
      available: microToCredits(r.balance_micro - r.frozen_micro), total_granted: microToCredits(r.total_recharged_micro),
      total_consumed: microToCredits(r.total_consumed_micro), total_refunded: microToCredits(r.total_refunded_micro),
    }));
}

function listPriceBooks(db) {
  const books = db.prepare('SELECT * FROM billing_price_books ORDER BY updated_at DESC, id DESC').all();
  const itemStmt = db.prepare('SELECT * FROM billing_price_book_items WHERE price_book_id = ? ORDER BY service_type, model, meter');
  return books.map((b) => ({ ...b, items: itemStmt.all(b.id).map((i) => ({ ...i, is_free: !!i.is_free, unit_price: microToCredits(i.unit_price_micro), conditions_json: parse(i.conditions_json, null) })) }));
}

function validatePriceBookWindow(db, bookId, status, effectiveFrom, effectiveTo, items) {
  if (effectiveFrom && effectiveTo && new Date(effectiveFrom) >= new Date(effectiveTo)) {
    throw new Error('生效结束时间必须晚于生效开始时间');
  }
  const supportedMeters = new Set(['request','image','second','millisecond','character','input_token','output_token']);
  if (status === 'published' && !items.length) throw new Error('发布价目表至少需要一个价目');
  const seen = new Set();
  for (const item of items) {
    const serviceType = String(item.service_type || '').trim();
    const model = String(item.model || '').trim();
    const meter = String(item.meter || '').trim();
    if (!serviceType || !model) throw new Error('价目项需要 service_type 和 model');
    if (!supportedMeters.has(meter)) throw new Error('不支持的计量器');
    const key = `${serviceType}\u0000${model}\u0000${meter}`;
    if (seen.has(key)) throw new Error(`同一价目表内不能重复配置 ${serviceType}/${model}/${meter}`);
    seen.add(key);
    let unitPrice;
    try { unitPrice = creditsToMicro(item.unit_price ?? microToCredits(item.unit_price_micro || 0)); } catch (_) { throw new Error('单价必须是非负积分，且最多四位小数'); }
    if (unitPrice < 0) throw new Error('单价必须是非负积分，且最多四位小数');
    if (status === 'published' && !item.is_free && unitPrice <= 0) throw new Error(`${serviceType}/${model}/${meter} 的免费价目必须显式勾选免费`);
    const conditions = item.conditions_json || {};
    const rates = Array.isArray(conditions.rates) ? conditions.rates : [];
    const rateWhen = [];
    for (const rate of rates) {
      let ratePrice;
      try { ratePrice = creditsToMicro(rate.unit_price_points); } catch (_) { throw new Error('条件价格必须使用非负积分（最多四位小数）和整数计量单位'); }
      if (ratePrice < 0 || !Number.isSafeInteger(Number(rate.unit_size || conditions.unit_size || 1)) || Number(rate.unit_size || conditions.unit_size || 1) <= 0) throw new Error('条件价格必须使用非负积分（最多四位小数）和整数计量单位');
      const keys = Object.keys(rate.when || {});
      if (keys.some((key) => !['has_video_input', 'resolution', 'has_audio'].includes(key))) throw new Error('条件价格只能使用已由视频请求明确传入的 has_video_input、resolution、has_audio 字段');
      rateWhen.push(rate.when || {});
    }
    for (let left = 0; left < rateWhen.length; left += 1) {
      for (let right = left + 1; right < rateWhen.length; right += 1) {
        const a = rateWhen[left]; const b = rateWhen[right];
        const overlaps = Object.keys(a).every((key) => !(key in b) || a[key] === b[key])
          && Object.keys(b).every((key) => !(key in a) || a[key] === b[key]);
        if (overlaps && Object.keys(a).length === Object.keys(b).length) {
          throw new Error('条件价格存在相同优先级且可同时命中的规则，请合并或增加明确条件');
        }
      }
    }
    const tiers = Array.isArray(conditions.usage_tiers) ? conditions.usage_tiers : [];
    const seenTiers = new Set();
    for (const tier of tiers) {
      const selector = String(tier.selector_meter || '').trim();
      const min = tier.min_inclusive == null ? 0 : Number(tier.min_inclusive);
      const max = tier.max_inclusive == null ? Number.MAX_SAFE_INTEGER : Number(tier.max_inclusive);
      const key = `${selector}\u0000${min}\u0000${max}`;
      let tierPrice;
      try { tierPrice = creditsToMicro(tier.unit_price_points); } catch (_) { tierPrice = -1; }
      if (!['input_token', 'output_token'].includes(selector) || !Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < min || tierPrice < 0 || !Number.isSafeInteger(Number(tier.unit_size || conditions.unit_size || 1)) || Number(tier.unit_size || conditions.unit_size || 1) <= 0 || seenTiers.has(key)) {
        throw new Error('token 分档必须使用已知计量器、有效的整数边界和正整数计量单位');
      }
      seenTiers.add(key);
    }
    for (const selector of ['input_token', 'output_token']) {
      const ordered = tiers.filter((tier) => tier.selector_meter === selector)
        .slice().sort((a, b) => Number(a.min_inclusive || 0) - Number(b.min_inclusive || 0));
      for (let index = 1; index < ordered.length; index += 1) {
        const previous = ordered[index - 1]; const current = ordered[index];
        if (Number(current.min_inclusive || 0) <= Number(previous.max_inclusive ?? Number.MAX_SAFE_INTEGER) || creditsToMicro(current.unit_price_points) < creditsToMicro(previous.unit_price_points)) {
          throw new Error('token 分档不能重叠，且更高用量档位不能低于前一档价格');
        }
      }
    }
    if (status !== 'published') continue;
    const conflict = db.prepare(`SELECT pb.name FROM billing_price_book_items pbi
      JOIN billing_price_books pb ON pb.id = pbi.price_book_id
      WHERE pb.status = 'published' AND pb.owner_user_id IS NULL
        AND pbi.service_type = ? AND pbi.model = ? AND pbi.meter = ?
        AND (? IS NULL OR pb.effective_from < ?)
        AND (? IS NULL OR pb.effective_to > ?)
        AND (? IS NULL OR pb.id != ?) LIMIT 1`)
      .get(serviceType, model, meter, effectiveTo || null, effectiveTo || null, effectiveFrom || null, effectiveFrom || null, bookId, bookId);
    if (conflict) throw new Error(`与已发布价目表“${conflict.name}”的 ${serviceType}/${model}/${meter} 生效区间重叠`);
  }
}

function savePriceBook(db, actorId, input, id) {
  const at = now(); let bookId = id ? Number(id) : null;
  const items = Array.isArray(input.items) ? input.items : [];
  if (!String(input.name || '').trim() && !bookId) throw new Error('价目表名称必填');
  const status = ['draft','published','archived'].includes(input.status) ? input.status : 'draft';
  const effectiveFrom = input.effective_from || null;
  const effectiveTo = input.effective_to || null;
  validatePriceBookWindow(db, bookId, status, effectiveFrom, effectiveTo, items);
  const write = db.transaction(() => {
    if (bookId) {
      const exists = db.prepare('SELECT id FROM billing_price_books WHERE id = ?').get(bookId); if (!exists) throw new Error('价目表不存在');
      db.prepare(`UPDATE billing_price_books SET name = ?, status = ?, effective_from = ?, effective_to = ?, updated_at = ? WHERE id = ?`)
        .run(String(input.name || '').trim(), status, effectiveFrom, effectiveTo, at, bookId);
      db.prepare('DELETE FROM billing_price_book_items WHERE price_book_id = ?').run(bookId);
    } else {
      bookId = Number(db.prepare(`INSERT INTO billing_price_books (name, owner_user_id, status, effective_from, effective_to, created_by, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`).run(String(input.name).trim(), status, effectiveFrom, effectiveTo, actorId, at, at).lastInsertRowid);
    }
    const stmt = db.prepare(`INSERT INTO billing_price_book_items (price_book_id, service_type, model, meter, unit_price_micro, is_free, conditions_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of items) {
      const meter = String(item.meter || '').trim(); if (!['request','image','second','millisecond','character','input_token','output_token'].includes(meter)) throw new Error('不支持的计量器');
      const serviceType = String(item.service_type || '').trim(); const model = String(item.model || '').trim(); if (!serviceType || !model) throw new Error('价目项需要 service_type 和 model');
      stmt.run(bookId, serviceType, model, meter, creditsToMicro(item.unit_price ?? microToCredits(item.unit_price_micro || 0)), item.is_free ? 1 : 0, item.conditions_json ? json(item.conditions_json) : null, at, at);
    }
  });
  write(); audit(db, actorId, id ? 'price_book.update' : 'price_book.create', 'price_book', bookId, { name: input.name, status: input.status, item_count: items.length });
  return listPriceBooks(db).find((b) => b.id === bookId);
}

function shanghaiDayBoundary(value, endOfDay = false) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})$/);
  return match ? new Date(`${match[1]}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+08:00`).toISOString() : null;
}

function appendLedgerFilters(where, params, tableAlias, userAlias, filters = {}) {
  const role = String(filters.role || '').trim();
  if (role === 'admin' || role === 'user') { where += ` AND ${userAlias}.role = ?`; params.push(role); }
  // 分组筛选：tenant_id>0 精确匹配；tenant_id=0 表示"未分组"（NULL 快照）。
  if (filters.tenant_id !== undefined && filters.tenant_id !== null && String(filters.tenant_id) !== '') {
    const tenantId = Number(filters.tenant_id);
    if (tenantId === 0) where += ` AND ${tableAlias}.tenant_id IS NULL`;
    else if (Number.isInteger(tenantId) && tenantId > 0) { where += ` AND ${tableAlias}.tenant_id = ?`; params.push(tenantId); }
  }
  const from = shanghaiDayBoundary(filters.date_from);
  const to = shanghaiDayBoundary(filters.date_to, true);
  if (from) { where += ` AND ${tableAlias}.created_at >= ?`; params.push(from); }
  if (to) { where += ` AND ${tableAlias}.created_at <= ?`; params.push(to); }
  return where;
}

/**
 * 幂等回填历史计费流水的分组快照：仅填充 tenant_id IS NULL 的行，按用户当前
 * 成员关系推断（历史用户若曾换组，以现分组为最佳近似；新流水在写入时已精确快照，
 * 不受影响）。无 tenants 表的环境（未启用分组）直接跳过。
 */
function backfillTenantSnapshots(db) {
  try {
    const hasTenants = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tenants'").get();
    const hasMemberships = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tenant_memberships'").get();
    if (!hasTenants || !hasMemberships) return { skipped: true };
    const tx = db.prepare(`UPDATE billing_transactions
      SET tenant_id = (SELECT tm.tenant_id FROM tenant_memberships tm WHERE tm.user_id = billing_transactions.user_id ORDER BY tm.tenant_id LIMIT 1)
      WHERE tenant_id IS NULL`);
    const ux = db.prepare(`UPDATE billing_usage_logs
      SET tenant_id = (SELECT tm.tenant_id FROM tenant_memberships tm WHERE tm.user_id = billing_usage_logs.user_id ORDER BY tm.tenant_id LIMIT 1)
      WHERE tenant_id IS NULL`);
    return { transactions: tx.run().changes, usage_logs: ux.run().changes };
  } catch (_) { return { skipped: true }; }
}

function listTransactions(db, filters = {}) {
  let where = 'WHERE 1=1', p = [];
  if (filters.user_id) { where += ' AND t.user_id = ?'; p.push(Number(filters.user_id)); }
  where = appendLedgerFilters(where, p, 't', 'u', filters);
  const rows = db.prepare(`SELECT t.*, u.username, u.role, tn.name AS tenant_name FROM billing_transactions t JOIN users u ON u.id = t.user_id LEFT JOIN tenants tn ON tn.id = t.tenant_id ${where} ORDER BY t.created_at DESC, t.rowid DESC LIMIT 300`).all(...p);
  return rows.map((r) => ({ ...r, amount: microToCredits(r.amount_micro), balance_after: microToCredits(r.balance_after_micro), frozen_after: microToCredits(r.frozen_after_micro), snapshot: parse(r.snapshot_json) }));
}

function pagination(input = {}) {
  const page = Math.max(1, Math.trunc(Number(input.page) || 1));
  const pageSize = Math.max(10, Math.min(100, Math.trunc(Number(input.page_size) || 20)));
  return { page, page_size: pageSize, offset: (page - 1) * pageSize };
}

function pagedTransactions(db, filters = {}) {
  let where = 'WHERE 1=1', params = [];
  if (filters.user_id) { where += ' AND t.user_id = ?'; params.push(Number(filters.user_id)); }
  where = appendLedgerFilters(where, params, 't', 'u', filters);
  const meta = pagination(filters);
  const total = Number(db.prepare(`SELECT COUNT(*) total FROM billing_transactions t JOIN users u ON u.id = t.user_id ${where}`).get(...params)?.total || 0);
  const rows = db.prepare(`SELECT t.*, u.username, u.role, tn.name AS tenant_name FROM billing_transactions t JOIN users u ON u.id = t.user_id LEFT JOIN tenants tn ON tn.id = t.tenant_id ${where} ORDER BY t.created_at DESC, t.rowid DESC LIMIT ? OFFSET ?`).all(...params, meta.page_size, meta.offset);
  return {
    items: rows.map((r) => ({ ...r, amount: microToCredits(r.amount_micro), balance_after: microToCredits(r.balance_after_micro), frozen_after: microToCredits(r.frozen_after_micro), snapshot: parse(r.snapshot_json) })),
    total,
    page: meta.page,
    page_size: meta.page_size,
  };
}

function listUsage(db, filters = {}) {
  let where = 'WHERE 1=1', p = []; if (filters.user_id) { where += ' AND l.user_id = ?'; p.push(Number(filters.user_id)); }
  where = appendLedgerFilters(where, p, 'l', 'u', filters);
  return db.prepare(`SELECT l.*, u.username, u.role FROM billing_usage_logs l JOIN users u ON u.id = l.user_id ${where} ORDER BY l.created_at DESC LIMIT 300`).all(...p)
    .map((r) => ({ ...r, charged: microToCredits(r.charged_micro), usage: parse(r.usage_json), snapshot: parse(r.snapshot_json) }));
}

function pagedUsage(db, filters = {}) {
  let where = 'WHERE 1=1', params = [];
  if (filters.user_id) { where += ' AND l.user_id = ?'; params.push(Number(filters.user_id)); }
  where = appendLedgerFilters(where, params, 'l', 'u', filters);
  const meta = pagination(filters);
  const total = Number(db.prepare(`SELECT COUNT(*) total FROM billing_usage_logs l JOIN users u ON u.id = l.user_id ${where}`).get(...params)?.total || 0);
  const rows = db.prepare(`SELECT l.*, u.username, u.role, tn.name AS tenant_name FROM billing_usage_logs l JOIN users u ON u.id = l.user_id LEFT JOIN tenants tn ON tn.id = l.tenant_id ${where} ORDER BY l.created_at DESC, l.rowid DESC LIMIT ? OFFSET ?`).all(...params, meta.page_size, meta.offset);
  return {
    items: rows.map((r) => ({ ...r, charged: microToCredits(r.charged_micro), usage: parse(r.usage_json), snapshot: parse(r.snapshot_json) })),
    total,
    page: meta.page,
    page_size: meta.page_size,
  };
}

function pagedAuditLogs(db, filters = {}) {
  const meta = pagination(filters);
  const total = Number(db.prepare('SELECT COUNT(*) total FROM billing_audit_logs').get()?.total || 0);
  const items = db.prepare(`SELECT a.*, u.username AS actor_username
    FROM billing_audit_logs a JOIN users u ON u.id = a.actor_user_id
    ORDER BY a.created_at DESC, a.rowid DESC LIMIT ? OFFSET ?`).all(meta.page_size, meta.offset);
  return { items, total, page: meta.page, page_size: meta.page_size };
}

module.exports = { account, publicAccount, audit, backfillTenantSnapshots, quote, activeMeters, createAuthorization, getAuthorization, settleAuthorization, historicalSettlementSupplementCandidates, collectSettlementSupplement, collectHistoricalSettlementSupplements, voidAuthorization, markPendingReconciliation, recoverCompletedVideoReconciliations, recoverInterruptedTextReconciliations, recoverStuckStageAuthorizations, listReconciliationCases, pagedReconciliationCases, settleReconciliationCase, waiveReconciliationCase, expireReconciliationCases, adjustBalance, setBalance, listUsers, listPriceBooks, savePriceBook, listTransactions, listUsage, pagedTransactions, pagedUsage, pagedAuditLogs };
