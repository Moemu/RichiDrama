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

function safeMicroAdd(...values) {
  let result = 0n;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) throw new Error('积分超出安全范围');
    result += BigInt(value);
  }
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('积分超出安全范围');
  return Number(result);
}

function account(db, userId) {
  const at = now();
  db.prepare('INSERT OR IGNORE INTO billing_accounts (user_id, updated_at) VALUES (?, ?)').run(userId, at);
  return db.prepare('SELECT * FROM billing_accounts WHERE user_id = ?').get(userId);
}

function payerAccount(db, userId) {
  const organizations = require('./customerOrganizationService');
  const membership = organizations.membershipForUser(db, userId);
  if (!membership) return { ...account(db, userId), account_scope: 'personal', organization_id: null, account_name: null };
  if (membership.status !== 'active') throw new Error('客户共享账户已停用，请联系运营管理员');
  return {
    ...organizations.account(db, membership.id),
    user_id: Number(userId),
    account_scope: 'organization',
    organization_id: membership.id,
    account_name: membership.name,
    organization_role: membership.membership_role,
  };
}

function payerAccountForAuthorization(db, authorization) {
  if (Number(authorization?.organization_id) > 0) {
    const organizations = require('./customerOrganizationService');
    const organization = organizations.organizationDetail(db, authorization.organization_id);
    if (!organization) throw new Error('预授权关联的客户账户不存在');
    return {
      ...organizations.account(db, organization.id),
      user_id: authorization.user_id,
      account_scope: 'organization',
      organization_id: organization.id,
      account_name: organization.name,
    };
  }
  return { ...account(db, authorization.user_id), account_scope: 'personal', organization_id: null, account_name: null };
}

function updatePayerAccount(db, payer, fields) {
  const entries = Object.entries(fields);
  if (!entries.length) return;
  const table = payer.account_scope === 'organization' ? 'organization_billing_accounts' : 'billing_accounts';
  const key = payer.account_scope === 'organization' ? 'organization_id' : 'user_id';
  db.prepare(`UPDATE ${table} SET ${entries.map(([name]) => `${name}=?`).join(',')},updated_at=? WHERE ${key}=?`)
    .run(...entries.map(([, value]) => value), now(), payer.account_scope === 'organization' ? payer.organization_id : payer.user_id);
}

function publicAccount(row) {
  return {
    user_id: row.user_id,
    account_scope: row.account_scope || 'personal',
    organization_id: row.organization_id || null,
    account_name: row.account_name || null,
    organization_role: row.organization_role || null,
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

function projectSnapshot(db, userId, input = {}) {
  const dramaId = Number(input.drama_id);
  if (!Number.isInteger(dramaId) || dramaId <= 0) return { drama_id: null, project_title_snapshot: null };
  const row = db.prepare('SELECT id, title FROM dramas WHERE id=? AND owner_user_id=? AND deleted_at IS NULL').get(dramaId, Number(userId));
  if (!row) throw new Error('项目不存在或无权计费到该项目');
  return { drama_id: row.id, project_title_snapshot: String(row.title || '').trim() || `项目 #${row.id}` };
}

function createAuthorization(db, user, input) {
  const idempotencyKey = String(input.idempotency_key || '').trim(); if (!idempotencyKey) throw new Error('idempotency_key 必填');
  const existing = db.prepare("SELECT * FROM billing_transactions WHERE user_id = ? AND idempotency_key = ? AND type = 'authorization'").get(user.id, idempotencyKey);
  if (existing) return { authorization_id: existing.id, amount_micro: existing.amount_micro, amount: microToCredits(existing.amount_micro), reused: true, snapshot: parse(existing.snapshot_json) };
  assertReconciliationLimit(db, user.id, input.service_type, input.model);
  const priced = quote(db, user, input); const at = now(); const id = uuid();
  const tenantId = require('./tenantService').tenantForUser(db, user.id)?.id || null;
  const project = projectSnapshot(db, user.id, input);
  const execute = db.transaction(() => {
    const acct = payerAccount(db, user.id); const available = safeMicroAdd(acct.balance_micro, -acct.frozen_micro);
    if (available < priced.amount_micro) throw new Error('余额不足');
    const frozenAfter = safeMicroAdd(acct.frozen_micro, priced.amount_micro);
    updatePayerAccount(db, acct, { frozen_micro: frozenAfter });
    const sourceKind = input.source_kind || input.reference_type || null;
    const sourceId = input.source_id ?? input.reference_id ?? null;
    const snapshot = { ...priced, tenant_id: tenantId, ...project, source_kind: sourceKind, source_id: sourceId, reference_type: input.reference_type || null, reference_id: input.reference_id || null };
    snapshot.organization_id = acct.organization_id || null;
    snapshot.account_scope = acct.account_scope;
    db.prepare(`INSERT INTO billing_transactions (id, user_id, tenant_id, organization_id, drama_id, project_title_snapshot, source_kind, source_id, type, amount_micro, balance_after_micro, frozen_after_micro, authorization_id, idempotency_key, reference_type, reference_id, reason, snapshot_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'authorization', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, user.id, tenantId, acct.organization_id || null, project.drama_id, project.project_title_snapshot, sourceKind, sourceId == null ? null : String(sourceId), priced.amount_micro, acct.balance_micro, frozenAfter, id, idempotencyKey, input.reference_type || null, input.reference_id || null, input.reason || null, json(snapshot), at);
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
    const acct = payerAccountForAuthorization(db, auth);
    if (acct.frozen_micro < auth.amount_micro) throw new Error('预授权冻结状态异常');
    const availableAfterRelease = safeMicroAdd(acct.balance_micro, -acct.frozen_micro, auth.amount_micro);
    if (availableAfterRelease < chargedMicro) {
      const error = new Error('实际用量超出预授权且可用余额不足，等待管理员对账');
      error.code = 'BILLING_ACTUAL_USAGE_EXCEEDS_AVAILABLE_BALANCE';
      error.actual_micro = chargedMicro;
      error.authorized_micro = auth.amount_micro;
      error.supplemental_micro = supplementalMicro;
      throw error;
    }
    const balanceAfter = safeMicroAdd(acct.balance_micro, -chargedMicro); const frozenAfter = safeMicroAdd(acct.frozen_micro, -auth.amount_micro);
    updatePayerAccount(db, acct, { balance_micro: balanceAfter, frozen_micro: frozenAfter, total_consumed_micro: safeMicroAdd(acct.total_consumed_micro, chargedMicro) });
    db.prepare(`INSERT INTO billing_transactions (id, user_id, tenant_id, organization_id, drama_id, project_title_snapshot, source_kind, source_id, type, amount_micro, balance_after_micro, frozen_after_micro, authorization_id, reference_type, reference_id, reason, snapshot_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'settlement', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, auth.user_id, auth.tenant_id || null, auth.organization_id || null, auth.drama_id || null, auth.project_title_snapshot || null, auth.source_kind || auth.reference_type || null, auth.source_id || auth.reference_id || null, -chargedMicro, balanceAfter, frozenAfter, authorizationId, auth.reference_type, auth.reference_id, input.reason || null, json({ ...snapshot, actual_usage: actual.usage, authorized_micro: auth.amount_micro, charged_micro: chargedMicro, supplemental_charged_micro: supplementalMicro, overage_micro: supplementalMicro }), at);
    db.prepare(`INSERT INTO billing_usage_logs (id, user_id, tenant_id, organization_id, drama_id, project_title_snapshot, source_kind, source_id, transaction_id, authorization_id, service_type, model, usage_json, charged_micro, provider_request_id, reference_type, reference_id, snapshot_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uuid(), auth.user_id, auth.tenant_id || null, auth.organization_id || null, auth.drama_id || null, auth.project_title_snapshot || null, auth.source_kind || auth.reference_type || null, auth.source_id || auth.reference_id || null, id, authorizationId, snapshot.service_type, snapshot.model, json(actual.usage), chargedMicro, input.provider_request_id || null, auth.reference_type, auth.reference_id, json(snapshot), at);
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
    const acct = payerAccountForAuthorization(db, auth);
    if (safeMicroAdd(acct.balance_micro, -acct.frozen_micro) < supplementalMicro) {
      const error = new Error('历史实际用量差额补扣时可用余额不足，等待管理员对账');
      error.code = 'BILLING_ACTUAL_USAGE_EXCEEDS_AVAILABLE_BALANCE';
      error.actual_micro = actual.amount_micro;
      error.supplemental_micro = supplementalMicro;
      throw error;
    }
    const balanceAfter = safeMicroAdd(acct.balance_micro, -supplementalMicro);
    updatePayerAccount(db, acct, { balance_micro: balanceAfter, total_consumed_micro: safeMicroAdd(acct.total_consumed_micro, supplementalMicro) });
    db.prepare(`INSERT INTO billing_transactions (id, user_id, tenant_id, organization_id, type, amount_micro, balance_after_micro, frozen_after_micro, authorization_id, idempotency_key, reference_type, reference_id, reason, created_by, snapshot_json, created_at)
      VALUES (?, ?, ?, ?, 'adjustment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, auth.user_id, auth.tenant_id || null, auth.organization_id || null, -supplementalMicro, balanceAfter, acct.frozen_micro, authorizationId, idempotencyKey, auth.reference_type, auth.reference_id,
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
    const acct = payerAccountForAuthorization(db, auth); if (acct.frozen_micro < auth.amount_micro) throw new Error('预授权冻结状态异常');
    const frozenAfter = safeMicroAdd(acct.frozen_micro, -auth.amount_micro);
    updatePayerAccount(db, acct, { frozen_micro: frozenAfter });
    db.prepare(`INSERT INTO billing_transactions (id, user_id, tenant_id, organization_id, type, amount_micro, balance_after_micro, frozen_after_micro, authorization_id, reference_type, reference_id, reason, snapshot_json, created_at)
      VALUES (?, ?, ?, ?, 'void', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, auth.user_id, auth.tenant_id || null, auth.organization_id || null, 0, acct.balance_micro, frozenAfter, authorizationId, auth.reference_type, auth.reference_id, reason || '调用未完成，释放预授权', auth.snapshot_json, at);
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
    organization_id: auth.organization_id || null,
    service_type: snapshot.service_type, model: snapshot.model,
    provider_request_id: input.provider_request_id || null,
    reason: input.reason || '供应商成功响应但未返回可核验用量',
    observed_usage_json: input.observed_usage ? json(input.observed_usage) : null,
    due_at: input.due_at || reconciliationDueAt(), created_at: now(),
  };
  db.prepare(`INSERT INTO billing_reconciliation_cases
    (id, authorization_id, user_id, organization_id, service_type, model, provider_request_id, status, reason, observed_usage_json, due_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`)
    .run(record.id, record.authorization_id, record.user_id, record.organization_id, record.service_type, record.model, record.provider_request_id, record.reason, record.observed_usage_json, record.due_at, record.created_at);
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
    const acct = account(db, userId); const after = safeMicroAdd(acct.balance_micro, amount);
    if (after < acct.frozen_micro || after < 0) throw new Error('调整后余额不能小于已冻结金额');
    const granted = operation === 'grant' && amount > 0 ? amount : 0;
    db.prepare(`UPDATE billing_accounts SET balance_micro = ?, total_recharged_micro = ?, updated_at = ? WHERE user_id = ?`)
      .run(after, safeMicroAdd(acct.total_recharged_micro, granted), at, userId);
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

function adjustOrganizationBalance(db, actorId, organizationId, credits, reason, options = {}) {
  const organizations = require('./customerOrganizationService');
  const organization = organizations.organizationDetail(db, organizationId);
  if (!organization) throw new Error('客户账户不存在');
  const amount = creditsToMicro(credits); if (!amount) throw new Error('调整金额不能为 0');
  const operation = ['grant', 'debit', 'refund'].includes(options.operation) ? options.operation : (amount > 0 ? 'grant' : 'debit');
  if ((operation === 'grant' || operation === 'refund') && amount < 0) throw new Error('发放或退款金额必须为正数');
  if (operation === 'debit' && amount > 0) throw new Error('扣减金额必须为负数');
  const requestedIdempotencyKey = String(options.idempotency_key || '').trim();
  if (!requestedIdempotencyKey) throw new Error('idempotency_key 必填');
  const idempotencyKey = `organization:${organization.id}:${requestedIdempotencyKey}`;
  const existing = db.prepare('SELECT id FROM billing_transactions WHERE organization_id=? AND idempotency_key=?').get(organization.id, idempotencyKey);
  if (existing) return organizations.account(db, organization.id);
  const at = now(); const id = uuid();
  db.transaction(() => {
    const acct = organizations.account(db, organization.id); const after = safeMicroAdd(acct.balance_micro, amount);
    if (after < acct.frozen_micro || after < 0) throw new Error('调整后余额不能小于已冻结金额');
    const granted = operation === 'grant' && amount > 0 ? amount : 0;
    updatePayerAccount(db, { ...acct, account_scope: 'organization', organization_id: organization.id }, {
      balance_micro: after,
      total_recharged_micro: safeMicroAdd(acct.total_recharged_micro, granted),
    });
    db.prepare(`INSERT INTO billing_transactions (id,user_id,tenant_id,organization_id,type,amount_micro,balance_after_micro,frozen_after_micro,idempotency_key,reason,created_by,snapshot_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, actorId, organization.config_tenant_id, organization.id, operation === 'grant' ? 'recharge' : 'adjustment', amount, after, acct.frozen_micro, idempotencyKey, String(reason || '').trim() || '管理员调整客户共享额度', actorId, json({ operation, account_scope: 'organization', organization_id: organization.id }), at);
  })();
  audit(db, actorId, 'billing.organization_balance.adjust', 'customer_organization', organization.id, { amount_micro: amount, operation, idempotency_key: requestedIdempotencyKey, reason });
  return organizations.account(db, organization.id);
}

function listUsers(db) {
  return db.prepare(`SELECT u.id, u.username, u.display_name, u.role, u.console_access, u.account_kind, u.is_active, u.created_at, u.last_login_at,
    tm.tenant_id, tm.role AS tenant_role, tenant.name AS tenant_name,
    om.organization_id, om.role AS organization_role, org.name AS organization_name,
    COALESCE(a.balance_micro, 0) balance_micro, COALESCE(a.frozen_micro, 0) frozen_micro,
    COALESCE(a.total_recharged_micro, 0) total_recharged_micro, COALESCE(a.total_consumed_micro, 0) total_consumed_micro,
    COALESCE((SELECT SUM(t.amount_micro) FROM billing_transactions t WHERE t.user_id=u.id AND t.amount_micro>0 AND t.snapshot_json LIKE '%\"operation\":\"refund\"%'), 0) total_refunded_micro
    FROM users u LEFT JOIN billing_accounts a ON a.user_id = u.id
    LEFT JOIN tenant_memberships tm ON tm.user_id = u.id
    LEFT JOIN tenants tenant ON tenant.id = tm.tenant_id
    LEFT JOIN customer_organization_memberships om ON om.user_id=u.id
    LEFT JOIN customer_organizations org ON org.id=om.organization_id
    ORDER BY u.id`).all().map((r) => ({
      ...r, is_active: !!r.is_active, console_access: !!r.console_access, account_kind: r.account_kind || (r.role === 'admin' ? 'platform_admin' : 'creator'), balance: microToCredits(r.balance_micro), frozen: microToCredits(r.frozen_micro),
      available: microToCredits(r.balance_micro - r.frozen_micro), total_granted: microToCredits(r.total_recharged_micro),
      total_consumed: microToCredits(r.total_consumed_micro), total_refunded: microToCredits(r.total_refunded_micro),
    }));
}

function listPriceBooks(db) {
  const books = db.prepare('SELECT * FROM billing_price_books ORDER BY updated_at DESC, id DESC').all();
  const itemStmt = db.prepare('SELECT * FROM billing_price_book_items WHERE price_book_id = ? ORDER BY service_type, model, meter');
  return books.map((b) => ({
    ...b,
    system_managed: !!b.system_managed,
    version: Number(b.version || 1),
    items: itemStmt.all(b.id).map((i) => ({ ...i, is_free: !!i.is_free, unit_price: microToCredits(i.unit_price_micro), conditions_json: parse(i.conditions_json, null) })),
  }));
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
      if (keys.some((key) => !['has_video_input', 'has_image_input', 'resolution', 'has_audio'].includes(key))) throw new Error('条件价格只能使用请求明确传入的 has_video_input、has_image_input、resolution、has_audio 字段');
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
  let status = ['draft','published','archived'].includes(input.status) ? input.status : 'draft';
  if (bookId) {
    const current = db.prepare('SELECT status FROM billing_price_books WHERE id=?').get(bookId);
    if (!current) throw new Error('价目表不存在');
    if (current.status !== 'draft') throw new Error('已发布或已归档价目不可原地修改，请创建新版本');
    if (status !== 'draft') throw new Error('草稿必须通过发布接口生效');
    status = 'draft';
  }
  const effectiveFrom = input.effective_from || null;
  const effectiveTo = input.effective_to || null;
  validatePriceBookWindow(db, bookId, status, effectiveFrom, effectiveTo, items);
  const write = db.transaction(() => {
    if (bookId) {
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
  if (filters.organization_id !== undefined && filters.organization_id !== null && String(filters.organization_id) !== '') {
    const organizationId = Number(filters.organization_id);
    if (organizationId === 0) where += ` AND ${tableAlias}.organization_id IS NULL`;
    else if (Number.isInteger(organizationId) && organizationId > 0) { where += ` AND ${tableAlias}.organization_id = ?`; params.push(organizationId); }
  }
  const from = shanghaiDayBoundary(filters.date_from);
  const to = shanghaiDayBoundary(filters.date_to, true);
  if (from) { where += ` AND ${tableAlias}.created_at >= ?`; params.push(from); }
  if (to) { where += ` AND ${tableAlias}.created_at <= ?`; params.push(to); }
  if (filters.drama_id !== undefined && filters.drama_id !== null && String(filters.drama_id) !== '') {
    const dramaId = Number(filters.drama_id);
    if (dramaId === 0) where += ` AND ${tableAlias}.drama_id IS NULL`;
    else if (Number.isInteger(dramaId) && dramaId > 0) { where += ` AND ${tableAlias}.drama_id = ?`; params.push(dramaId); }
  }
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
  const rows = db.prepare(`SELECT t.*, u.username, u.role, tn.name AS tenant_name, org.name AS organization_name FROM billing_transactions t JOIN users u ON u.id = t.user_id LEFT JOIN tenants tn ON tn.id = t.tenant_id LEFT JOIN customer_organizations org ON org.id=t.organization_id ${where} ORDER BY t.created_at DESC, t.rowid DESC LIMIT 300`).all(...p);
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
  const rows = db.prepare(`SELECT t.*, u.username, u.role, tn.name AS tenant_name, org.name AS organization_name FROM billing_transactions t JOIN users u ON u.id = t.user_id LEFT JOIN tenants tn ON tn.id = t.tenant_id LEFT JOIN customer_organizations org ON org.id=t.organization_id ${where} ORDER BY t.created_at DESC, t.rowid DESC LIMIT ? OFFSET ?`).all(...params, meta.page_size, meta.offset);
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
  return db.prepare(`SELECT l.*, u.username, u.display_name, u.role, org.name AS organization_name FROM billing_usage_logs l JOIN users u ON u.id = l.user_id LEFT JOIN customer_organizations org ON org.id=l.organization_id ${where} ORDER BY l.created_at DESC LIMIT 300`).all(...p)
    .map((r) => ({ ...r, charged: microToCredits(r.charged_micro), usage: parse(r.usage_json), snapshot: parse(r.snapshot_json) }));
}

function pagedUsage(db, filters = {}) {
  let where = 'WHERE 1=1', params = [];
  if (filters.user_id) { where += ' AND l.user_id = ?'; params.push(Number(filters.user_id)); }
  where = appendLedgerFilters(where, params, 'l', 'u', filters);
  if (filters.service_type) { where += ' AND l.service_type=?'; params.push(String(filters.service_type)); }
  if (filters.model) { where += ' AND l.model=?'; params.push(String(filters.model)); }
  const meta = pagination(filters);
  const total = Number(db.prepare(`SELECT COUNT(*) total FROM billing_usage_logs l JOIN users u ON u.id = l.user_id ${where}`).get(...params)?.total || 0);
  const rows = db.prepare(`SELECT l.*, u.username, u.display_name, u.role, tn.name AS tenant_name, org.name AS organization_name FROM billing_usage_logs l JOIN users u ON u.id = l.user_id LEFT JOIN tenants tn ON tn.id = l.tenant_id LEFT JOIN customer_organizations org ON org.id=l.organization_id ${where} ORDER BY l.created_at DESC, l.rowid DESC LIMIT ? OFFSET ?`).all(...params, meta.page_size, meta.offset);
  return {
    items: rows.map((r) => ({ ...r, charged: microToCredits(r.charged_micro), usage: parse(r.usage_json), snapshot: parse(r.snapshot_json) })),
    total,
    page: meta.page,
    page_size: meta.page_size,
  };
}

// Only fill a historical project snapshot when its authorization ID resolves
// to one still-owned project generation. Ambiguous and free/global history is
// intentionally left untouched rather than guessed.
function backfillProjectSnapshots(db, actorId, idempotencyKey = null) {
  if (idempotencyKey) {
    const previous = db.prepare("SELECT detail_json FROM billing_audit_logs WHERE actor_user_id=? AND action='billing.project_snapshot.backfill' ORDER BY created_at DESC").all(actorId)
      .map((row) => parse(row.detail_json, null)).find((detail) => detail?.idempotency_key === idempotencyKey);
    if (previous) return { ...previous, reused: true };
  }
  const candidates = db.prepare(`
    SELECT l.id AS usage_log_id, l.authorization_id, l.user_id, v.drama_id, d.title AS project_title, 'video_generation' AS source_kind
      FROM billing_usage_logs l JOIN video_generations v
        ON l.authorization_id IN (v.billing_authorization_id, v.upscale_billing_authorization_id, v.interpolation_billing_authorization_id)
      JOIN dramas d ON d.id=v.drama_id AND d.deleted_at IS NULL AND d.owner_user_id=v.owner_user_id
     WHERE l.drama_id IS NULL AND v.drama_id>0 AND l.user_id=v.owner_user_id
    UNION ALL
    SELECT l.id AS usage_log_id, l.authorization_id, l.user_id, i.drama_id, d.title AS project_title, 'image_generation' AS source_kind
      FROM billing_usage_logs l JOIN image_generations i ON i.billing_authorization_id=l.authorization_id
      JOIN dramas d ON d.id=i.drama_id AND d.deleted_at IS NULL AND d.owner_user_id=i.owner_user_id
     WHERE l.drama_id IS NULL AND i.drama_id>0 AND l.user_id=i.owner_user_id
  `).all();
  const choices = new Map();
  for (const row of candidates) {
    const rows = choices.get(row.usage_log_id) || new Map();
    rows.set(`${row.drama_id}:${row.project_title}`, row);
    choices.set(row.usage_log_id, rows);
  }
  const safe = [...choices.values()].flatMap((rows) => rows.size === 1 ? [...rows.values()] : []);
  const summary = db.transaction(() => {
    const usage = db.prepare('UPDATE billing_usage_logs SET drama_id=?, project_title_snapshot=?, source_kind=COALESCE(source_kind, ?), source_id=COALESCE(source_id, ?) WHERE id=? AND drama_id IS NULL');
    const transactions = db.prepare('UPDATE billing_transactions SET drama_id=?, project_title_snapshot=?, source_kind=COALESCE(source_kind, ?), source_id=COALESCE(source_id, ?) WHERE user_id=? AND drama_id IS NULL AND (id=? OR authorization_id=?)');
    let usageLogs = 0, ledgerRows = 0;
    for (const row of safe) {
      usageLogs += usage.run(row.drama_id, row.project_title, row.source_kind, String(row.usage_log_id), row.usage_log_id).changes;
      ledgerRows += transactions.run(row.drama_id, row.project_title, row.source_kind, String(row.usage_log_id), row.user_id, row.authorization_id, row.authorization_id).changes;
    }
    return { usage_logs: usageLogs, transactions: ledgerRows, candidates: candidates.length, safe_records: safe.length, ambiguous_or_duplicate: candidates.length - safe.length, projects: new Set(safe.map((row) => row.drama_id)).size };
  })();
  audit(db, actorId, 'billing.project_snapshot.backfill', 'billing', 'historical-project-snapshots', { ...summary, idempotency_key: idempotencyKey });
  return summary;
}

function usageSummary(db, filters = {}) {
  let where = 'WHERE 1=1', params = [];
  if (filters.user_id) { where += ' AND l.user_id=?'; params.push(Number(filters.user_id)); }
  where = appendLedgerFilters(where, params, 'l', 'u', filters);
  if (filters.service_type) { where += ' AND l.service_type=?'; params.push(String(filters.service_type)); }
  if (filters.model) { where += ' AND l.model=?'; params.push(String(filters.model)); }
  const totals = db.prepare(`SELECT COALESCE(SUM(l.charged_micro),0) charged_micro, COUNT(*) calls, COUNT(DISTINCT l.user_id) users, COUNT(DISTINCT l.drama_id) projects FROM billing_usage_logs l JOIN users u ON u.id=l.user_id ${where}`).get(...params);
  const timeSeries = db.prepare(`SELECT substr(datetime(l.created_at, '+8 hours'), 1, 10) day, COALESCE(SUM(l.charged_micro),0) charged_micro, COUNT(*) calls FROM billing_usage_logs l JOIN users u ON u.id=l.user_id ${where} GROUP BY day ORDER BY day`).all(...params);
  const breakdown = db.prepare(`SELECT l.user_id, u.username, u.display_name, l.drama_id, COALESCE(l.project_title_snapshot, CASE WHEN l.drama_id IS NULL THEN '未关联项目（历史/全局）' ELSE '项目名称快照缺失' END) project_title, COALESCE(SUM(l.charged_micro),0) charged_micro, COUNT(*) calls FROM billing_usage_logs l JOIN users u ON u.id=l.user_id ${where} GROUP BY l.user_id, u.username, u.display_name, l.drama_id, project_title ORDER BY charged_micro DESC, l.user_id`).all(...params);
  const unassigned = db.prepare(`SELECT COALESCE(SUM(l.charged_micro),0) charged_micro, COUNT(*) calls FROM billing_usage_logs l JOIN users u ON u.id=l.user_id ${where} AND l.drama_id IS NULL`).get(...params);
  return {
    summary: { ...totals, charged: microToCredits(totals.charged_micro) },
    time_series: timeSeries.map((row) => ({ ...row, charged: microToCredits(row.charged_micro) })),
    user_project_breakdown: breakdown.map((row) => ({ ...row, charged: microToCredits(row.charged_micro) })),
    unassigned: { ...unassigned, charged: microToCredits(unassigned.charged_micro) },
  };
}

// Project usage is deliberately derived from settled usage logs plus still-open
// authorization rows. It never infers a project from the user's recent work.
function projectUsageWhere(filters = {}) {
  let where = 'WHERE l.drama_id IS NOT NULL', params = [];
  if (filters.owner_user_id) { where += ' AND d.owner_user_id=?'; params.push(Number(filters.owner_user_id)); }
  if (filters.tenant_id !== undefined && filters.tenant_id !== null && String(filters.tenant_id) !== '') { where += ' AND l.tenant_id=?'; params.push(Number(filters.tenant_id)); }
  if (filters.service_type) { where += ' AND l.service_type=?'; params.push(String(filters.service_type)); }
  if (filters.model) { where += ' AND l.model=?'; params.push(String(filters.model)); }
  if (filters.source_kind) { where += ' AND COALESCE(l.source_kind, "other")=?'; params.push(String(filters.source_kind)); }
  const keyword = String(filters.keyword || '').trim();
  if (keyword) { where += ' AND (d.title LIKE ? OR u.username LIKE ? OR u.display_name LIKE ?)'; const term = `%${keyword}%`; params.push(term, term, term); }
  const from = shanghaiDayBoundary(filters.date_from), to = shanghaiDayBoundary(filters.date_to, true);
  if (from) { where += ' AND l.created_at>=?'; params.push(from); }
  if (to) { where += ' AND l.created_at<=?'; params.push(to); }
  return { where, params };
}

function unassignedProjectUsageWhere(filters = {}) {
  let where = 'WHERE l.drama_id IS NULL', params = [];
  if (filters.tenant_id !== undefined && filters.tenant_id !== null && String(filters.tenant_id) !== '') { where += ' AND l.tenant_id=?'; params.push(Number(filters.tenant_id)); }
  if (filters.service_type) { where += ' AND l.service_type=?'; params.push(String(filters.service_type)); }
  if (filters.model) { where += ' AND l.model=?'; params.push(String(filters.model)); }
  const keyword = String(filters.keyword || '').trim();
  if (keyword) { const term = `%${keyword}%`; where += ' AND (u.username LIKE ? OR u.display_name LIKE ?)'; params.push(term, term); }
  const from = shanghaiDayBoundary(filters.date_from), to = shanghaiDayBoundary(filters.date_to, true);
  if (from) { where += ' AND l.created_at>=?'; params.push(from); }
  if (to) { where += ' AND l.created_at<=?'; params.push(to); }
  return { where, params };
}

function unassignedProjectUsageSummary(db, filters = {}) {
  const { where, params } = unassignedProjectUsageWhere(filters);
  const summary = db.prepare(`SELECT COUNT(*) records, COUNT(DISTINCT l.user_id) users, COALESCE(SUM(l.charged_micro),0) charged_micro, MAX(l.created_at) last_activity_at FROM billing_usage_logs l JOIN users u ON u.id=l.user_id ${where}`).get(...params);
  const byUser = db.prepare(`SELECT l.user_id,u.username,u.display_name,COALESCE(SUM(l.charged_micro),0) charged_micro,MAX(l.created_at) last_activity_at FROM billing_usage_logs l JOIN users u ON u.id=l.user_id ${where} GROUP BY l.user_id,u.username,u.display_name ORDER BY charged_micro DESC,l.user_id LIMIT 8`).all(...params);
  const bySource = db.prepare(`SELECT COALESCE(l.source_kind,'other') source_kind,l.service_type,COALESCE(SUM(l.charged_micro),0) charged_micro FROM billing_usage_logs l JOIN users u ON u.id=l.user_id ${where} GROUP BY source_kind,l.service_type ORDER BY charged_micro DESC,source_kind LIMIT 8`).all(...params);
  return {
    summary: { ...summary, charged: microToCredits(summary.charged_micro) },
    by_user: byUser.map((row) => ({ ...row, charged: microToCredits(row.charged_micro) })),
    by_source: bySource.map((row) => ({ ...row, charged: microToCredits(row.charged_micro) })),
  };
}

function parseProjectMetadata(value) {
  if (!value || typeof value === 'object') return value || {};
  try { return JSON.parse(value) || {}; } catch (_) { return {}; }
}

// Project facts deliberately come from project/workflow tables, never from the
// billing ledger.  This keeps the progress display useful without turning it
// into a billing inference or changing historical settlement semantics.
function projectProfile(row) {
  const metadata = parseProjectMetadata(row.metadata);
  const resources = Number(row.character_count || 0) + Number(row.scene_count || 0) + Number(row.prop_count || 0);
  const storyboardCount = Number(row.storyboard_count || 0);
  const progress = storyboardCount > 0 ? Math.round(Number(row.shot_delivery_points || 0) / storyboardCount) : 0;
  return {
    ...row,
    metadata: undefined,
    aspect_ratio: metadata.aspect_ratio || row.storyboard_aspect_ratio || '—',
    workflow_step: metadata.current_step || null,
    progress_percent: progress,
    progress_source: 'shot_delivery',
    resource_count: resources,
  };
}

function shotDeliveryStageSql() {
  const prompt = `(TRIM(COALESCE(sb.video_prompt,'')) <> '' OR TRIM(COALESCE(sb.universal_segment_text,'')) <> '' OR TRIM(COALESCE(sb.omni_prompt_document_json,'')) NOT IN ('','{}','null'))`;
  const visual = `(TRIM(COALESCE(sb.image_url,'')) <> '' OR TRIM(COALESCE(sb.composed_image,'')) <> '' OR EXISTS (SELECT 1 FROM image_generations ig WHERE ig.storyboard_id=sb.id AND ig.status='completed' AND ig.deleted_at IS NULL))`;
  const completed = `((sb.status='completed' AND (TRIM(COALESCE(sb.video_url,'')) <> '' OR TRIM(COALESCE(sb.local_path,'')) <> '')) OR EXISTS (SELECT 1 FROM video_generations vg WHERE vg.storyboard_id=sb.id AND vg.status='completed' AND TRIM(COALESCE(vg.local_path,'')) <> '' AND vg.deleted_at IS NULL))`;
  const processing = `(sb.status IN ('processing','sd2_waiting','upscale_pending','upscaling','interpolation_pending','interpolating','persisting') OR EXISTS (SELECT 1 FROM video_generations vg WHERE vg.storyboard_id=sb.id AND vg.status IN ('processing','sd2_waiting','upscale_pending','upscaling','interpolation_pending','interpolating','persisting') AND vg.deleted_at IS NULL))`;
  return `CASE WHEN ${completed} THEN 'video_completed' WHEN ${processing} THEN 'video_processing' WHEN ${visual} THEN 'visual_ready' WHEN ${prompt} THEN 'prompt_ready' WHEN sb.status IN ('failed','invalid','cancelled') THEN 'failed' ELSE 'not_started' END`;
}

function shotDeliveryCountSql(stage) {
  return `(SELECT COUNT(*) FROM (SELECT ${shotDeliveryStageSql()} delivery_stage FROM storyboards sb JOIN episodes se ON se.id=sb.episode_id WHERE se.drama_id=d.id AND se.deleted_at IS NULL AND sb.deleted_at IS NULL) shot_stats WHERE delivery_stage='${stage}')`;
}

function projectProfileSql() {
  return `d.description, d.style, d.status project_status, d.metadata, d.updated_at project_updated_at,
    (SELECT COUNT(*) FROM episodes e WHERE e.drama_id=d.id AND e.deleted_at IS NULL) episode_count,
    (SELECT COUNT(*) FROM episodes e WHERE e.drama_id=d.id AND e.deleted_at IS NULL AND TRIM(COALESCE(e.script_content,'')) <> '') script_ready_episode_count,
    (SELECT COUNT(*) FROM characters c WHERE c.drama_id=d.id AND c.deleted_at IS NULL) character_count,
    (SELECT COUNT(*) FROM scenes s WHERE s.drama_id=d.id AND s.deleted_at IS NULL) scene_count,
    (SELECT COUNT(*) FROM props p WHERE p.drama_id=d.id AND p.deleted_at IS NULL) prop_count,
    ${shotDeliveryCountSql('not_started')} shot_not_started_count,
    ${shotDeliveryCountSql('prompt_ready')} shot_prompt_ready_count,
    ${shotDeliveryCountSql('visual_ready')} shot_visual_ready_count,
    ${shotDeliveryCountSql('video_processing')} shot_video_processing_count,
    ${shotDeliveryCountSql('video_completed')} video_completed_count,
    ${shotDeliveryCountSql('failed')} shot_failed_count,
    (SELECT COALESCE(SUM(CASE ${shotDeliveryStageSql()} WHEN 'prompt_ready' THEN 25 WHEN 'visual_ready' THEN 45 WHEN 'video_processing' THEN 70 WHEN 'video_completed' THEN 100 ELSE 0 END),0) FROM storyboards sb JOIN episodes se ON se.id=sb.episode_id WHERE se.drama_id=d.id AND se.deleted_at IS NULL AND sb.deleted_at IS NULL) shot_delivery_points,
    (SELECT COUNT(*) FROM storyboards sb JOIN episodes se ON se.id=sb.episode_id WHERE se.drama_id=d.id AND se.deleted_at IS NULL AND sb.deleted_at IS NULL) storyboard_count,
    (SELECT MAX(NULLIF(sb.video_aspect_ratio,'')) FROM storyboards sb JOIN episodes se ON se.id=sb.episode_id WHERE se.drama_id=d.id AND se.deleted_at IS NULL AND sb.deleted_at IS NULL) storyboard_aspect_ratio`;
}

function projectUsage(db, filters = {}) {
  const { where, params } = projectUsageWhere(filters); const meta = pagination(filters);
  const total = Number(db.prepare(`SELECT COUNT(DISTINCT l.drama_id) total FROM billing_usage_logs l JOIN dramas d ON d.id=l.drama_id JOIN users u ON u.id=d.owner_user_id ${where}`).get(...params)?.total || 0);
  const items = db.prepare(`SELECT l.drama_id, COALESCE(d.title, l.project_title_snapshot, '项目 #' || l.drama_id) title,
    d.owner_user_id, owner.username owner_username, owner.display_name owner_display_name,
    MAX(l.created_at) last_activity_at, MIN(d.created_at) created_at, ${projectProfileSql()}, COUNT(*) calls,
    COALESCE(SUM(l.charged_micro),0) charged_micro,
    COUNT(DISTINCT l.model) model_count,
    SUM(CASE WHEN COALESCE(l.source_kind,'other')='omni_video' THEN l.charged_micro ELSE 0 END) omni_micro,
    SUM(CASE WHEN COALESCE(l.source_kind,'other') IN ('video_generation','image_generation') THEN l.charged_micro ELSE 0 END) workflow_micro,
    SUM(CASE WHEN COALESCE(l.source_kind,'other')='tool_run' THEN l.charged_micro ELSE 0 END) tool_micro,
    COALESCE((SELECT SUM(a.amount_micro) FROM billing_transactions a WHERE a.drama_id=l.drama_id AND a.type='authorization' AND NOT EXISTS (SELECT 1 FROM billing_transactions done WHERE done.authorization_id=a.id AND done.type IN ('void','charge','settlement'))),0) frozen_micro
    FROM billing_usage_logs l JOIN dramas d ON d.id=l.drama_id LEFT JOIN users u ON u.id=l.user_id LEFT JOIN users owner ON owner.id=d.owner_user_id ${where}
    GROUP BY l.drama_id, title, d.owner_user_id, owner.username, owner.display_name, d.description, d.style, d.status, d.metadata, d.updated_at
    ORDER BY charged_micro DESC, last_activity_at DESC LIMIT ? OFFSET ?`).all(...params, meta.page_size, meta.offset)
    .map((row) => ({ ...projectProfile(row), charged: microToCredits(row.charged_micro), frozen: microToCredits(row.frozen_micro), average: microToCredits(Math.round(Number(row.charged_micro || 0) / Math.max(1, Number(row.calls || 0)))), source_breakdown: { workflow: microToCredits(row.workflow_micro), omni: microToCredits(row.omni_micro), tools: microToCredits(row.tool_micro) } }));
  const summary = db.prepare(`SELECT COUNT(DISTINCT l.drama_id) projects, COUNT(*) calls, COALESCE(SUM(l.charged_micro),0) charged_micro FROM billing_usage_logs l JOIN dramas d ON d.id=l.drama_id JOIN users u ON u.id=l.user_id ${where}`).get(...params);
  const unassigned = unassignedProjectUsageSummary(db, filters).summary;
  return { items, total, page: meta.page, page_size: meta.page_size, summary: { ...summary, charged: microToCredits(summary.charged_micro) }, historical_unassigned: unassigned };
}

function projectUsageDetail(db, dramaId, filters = {}) {
  const id = Number(dramaId); const rawProject = db.prepare(`SELECT d.id, d.title, d.created_at, d.updated_at, d.owner_user_id, u.username owner_username, u.display_name owner_display_name, ${projectProfileSql()} FROM dramas d LEFT JOIN users u ON u.id=d.owner_user_id WHERE d.id=? AND d.deleted_at IS NULL`).get(id);
  const project = rawProject ? projectProfile(rawProject) : null;
  if (!project) return null;
  const scoped = projectUsageWhere({ ...filters }); let where = scoped.where + ' AND l.drama_id=?', params = [...scoped.params, id];
  const summary = db.prepare(`SELECT COUNT(*) calls, COALESCE(SUM(l.charged_micro),0) charged_micro, COUNT(DISTINCT l.model) model_count, MAX(l.created_at) last_activity_at FROM billing_usage_logs l JOIN dramas d ON d.id=l.drama_id JOIN users u ON u.id=l.user_id ${where}`).get(...params);
  const breakdown = db.prepare(`SELECT COALESCE(l.source_kind,'other') source_kind, l.service_type, l.model, COUNT(*) calls, COALESCE(SUM(l.charged_micro),0) charged_micro, MAX(l.created_at) last_activity_at FROM billing_usage_logs l JOIN dramas d ON d.id=l.drama_id JOIN users u ON u.id=l.user_id ${where} GROUP BY source_kind,l.service_type,l.model ORDER BY charged_micro DESC`).all(...params).map((r) => ({ ...r, charged: microToCredits(r.charged_micro) }));
  const members = db.prepare(`SELECT l.user_id, u.username, u.display_name, u.role, COUNT(*) calls, COALESCE(SUM(l.charged_micro),0) charged_micro, MAX(l.created_at) last_activity_at FROM billing_usage_logs l JOIN dramas d ON d.id=l.drama_id JOIN users u ON u.id=l.user_id ${where} GROUP BY l.user_id,u.username,u.display_name,u.role ORDER BY charged_micro DESC LIMIT 5`).all(...params).map((r) => ({ ...r, charged: microToCredits(r.charged_micro) }));
  const recent = db.prepare(`SELECT l.id,l.created_at,l.service_type,l.model,l.source_kind,l.source_id,l.charged_micro,u.username,u.display_name FROM billing_usage_logs l JOIN dramas d ON d.id=l.drama_id JOIN users u ON u.id=l.user_id ${where} ORDER BY l.created_at DESC LIMIT 5`).all(...params).map((r) => ({ ...r, charged: microToCredits(r.charged_micro) }));
  return { project, summary: { ...summary, charged: microToCredits(summary.charged_micro) }, breakdown, members, recent };
}

function unassignedProjectUsage(db, filters = {}) {
  const { where, params } = unassignedProjectUsageWhere(filters);
  const overview = unassignedProjectUsageSummary(db, filters);
  const rows = db.prepare(`SELECT l.id,l.created_at,l.service_type,l.model,l.source_kind,l.source_id,l.charged_micro,u.username,u.display_name FROM billing_usage_logs l JOIN users u ON u.id=l.user_id ${where} ORDER BY l.created_at DESC LIMIT 100`).all(...params).map((r) => ({ ...r, charged: microToCredits(r.charged_micro), category: r.source_kind ? '历史待治理' : '全局/历史操作' }));
  return { ...overview, items: rows, total: overview.summary.records };
}

function projectUsageSection(db, dramaId, filters, section) {
  const detail = projectUsageDetail(db, dramaId, filters); if (!detail) return null;
  if (section === 'breakdown') return { items: detail.breakdown };
  if (section === 'members') return { items: detail.members };
  if (section === 'workflows') return { items: detail.recent };
  const scoped = projectUsageWhere(filters); const where = scoped.where + ' AND l.drama_id=?';
  const items = db.prepare(`SELECT substr(datetime(l.created_at, '+8 hours'),1,10) day, COUNT(*) calls, COALESCE(SUM(l.charged_micro),0) charged_micro FROM billing_usage_logs l JOIN dramas d ON d.id=l.drama_id JOIN users u ON u.id=l.user_id ${where} GROUP BY day ORDER BY day`).all(...scoped.params, Number(dramaId)).map((row) => ({ ...row, charged: microToCredits(row.charged_micro) }));
  return { items };
}

function pagedAuditLogs(db, filters = {}) {
  const meta = pagination(filters);
  const total = Number(db.prepare('SELECT COUNT(*) total FROM billing_audit_logs').get()?.total || 0);
  const items = db.prepare(`SELECT a.*, u.username AS actor_username
    FROM billing_audit_logs a JOIN users u ON u.id = a.actor_user_id
    ORDER BY a.created_at DESC, a.rowid DESC LIMIT ? OFFSET ?`).all(meta.page_size, meta.offset);
  return { items, total, page: meta.page, page_size: meta.page_size };
}

module.exports = { account, payerAccount, publicAccount, audit, backfillTenantSnapshots, backfillProjectSnapshots, quote, activeMeters, createAuthorization, getAuthorization, settleAuthorization, historicalSettlementSupplementCandidates, collectSettlementSupplement, collectHistoricalSettlementSupplements, voidAuthorization, markPendingReconciliation, recoverCompletedVideoReconciliations, recoverInterruptedTextReconciliations, recoverStuckStageAuthorizations, listReconciliationCases, pagedReconciliationCases, settleReconciliationCase, waiveReconciliationCase, expireReconciliationCases, adjustBalance, setBalance, adjustOrganizationBalance, listUsers, listPriceBooks, savePriceBook, listTransactions, listUsage, pagedTransactions, pagedUsage, usageSummary, projectUsage, projectUsageDetail, projectUsageSection, unassignedProjectUsage, pagedAuditLogs };
