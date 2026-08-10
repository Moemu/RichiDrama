const { v4: uuid } = require('uuid');

function now() { return new Date().toISOString(); }
function json(v) { return JSON.stringify(v == null ? {} : v); }
function parse(v, fallback = {}) { try { return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } }
// Stored amounts are whole points: 100 points = CNY 1.  Never store fractional
// points; all prorating is performed with integer arithmetic below.
function microToCredits(v) { return Number(v || 0); }
function creditsToMicro(v) {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error('积分必须是安全整数');
  return n;
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
  const allowed = ['request', 'image', 'second', 'character', 'input_token', 'output_token'];
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
function rateFor(row, context = {}) {
  const conditions = parseConditions(row.conditions_json);
  const rates = Array.isArray(conditions.rates) ? conditions.rates : [];
  const selected = rates.find((rate) => Object.entries(rate.when || {}).every(([k, v]) => context[k] === v))
    || rates.find((rate) => rate.id === conditions.default_rate_id)
    || null;
  const unitPrice = Number(selected?.unit_price_points ?? row.unit_price_micro);
  const unitSize = Number(selected?.unit_size ?? conditions.unit_size ?? 1);
  if (!Number.isSafeInteger(unitPrice) || unitPrice < 0 || !Number.isSafeInteger(unitSize) || unitSize <= 0) {
    throw new Error(`模型 ${row.model} 的价格配置无效`);
  }
  return { unit_price_micro: unitPrice, unit_size: unitSize, rate_id: selected?.id || null, conditions };
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
    const rate = rateFor(price, input.pricing_context || {});
    const subtotal = price.is_free ? 0 : proratedPoints(qty, rate.unit_price_micro, rate.unit_size);
    amountMicro += subtotal;
    if (!Number.isSafeInteger(amountMicro)) throw new Error('计费金额超出安全范围');
    rates.push({ meter, quantity: qty, unit_price_micro: rate.unit_price_micro, unit_size: rate.unit_size, rate_id: rate.rate_id, is_free: !!price.is_free, subtotal_micro: subtotal, price_book_id: price.price_book_id, price_book_name: price.price_book_name });
  }
  return { user_id: user.id, service_type: serviceType, model, usage, pricing_context: input.pricing_context || {}, amount_micro: amountMicro, amount: microToCredits(amountMicro), rates, quoted_at: now() };
}

function createAuthorization(db, user, input) {
  const idempotencyKey = String(input.idempotency_key || '').trim(); if (!idempotencyKey) throw new Error('idempotency_key 必填');
  const existing = db.prepare("SELECT * FROM billing_transactions WHERE user_id = ? AND idempotency_key = ? AND type = 'authorization'").get(user.id, idempotencyKey);
  if (existing) return { authorization_id: existing.id, amount_micro: existing.amount_micro, amount: microToCredits(existing.amount_micro), reused: true, snapshot: parse(existing.snapshot_json) };
  assertReconciliationLimit(db, user.id, input.service_type, input.model);
  const priced = quote(db, user, input); const at = now(); const id = uuid();
  const execute = db.transaction(() => {
    const acct = account(db, user.id); const available = acct.balance_micro - acct.frozen_micro;
    if (available < priced.amount_micro) throw new Error('余额不足');
    const frozenAfter = acct.frozen_micro + priced.amount_micro;
    db.prepare('UPDATE billing_accounts SET frozen_micro = ?, updated_at = ? WHERE user_id = ?').run(frozenAfter, at, user.id);
    const snapshot = { ...priced, reference_type: input.reference_type || null, reference_id: input.reference_id || null };
    db.prepare(`INSERT INTO billing_transactions (id, user_id, type, amount_micro, balance_after_micro, frozen_after_micro, authorization_id, idempotency_key, reference_type, reference_id, reason, snapshot_json, created_at)
      VALUES (?, ?, 'authorization', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, user.id, priced.amount_micro, acct.balance_micro, frozenAfter, id, idempotencyKey, input.reference_type || null, input.reference_id || null, input.reason || null, json(snapshot), at);
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
    amount += rate.is_free ? 0 : proratedPoints(qty, rate.unit_price_micro, rate.unit_size || 1);
  }
  return { usage, amount_micro: amount };
}

function settleAuthorization(db, user, authorizationId, input = {}) {
  const auth = db.prepare("SELECT * FROM billing_transactions WHERE id = ? AND type = 'authorization'").get(authorizationId);
  if (!auth || (auth.user_id !== user.id && user.role !== 'admin')) throw new Error('预授权不存在');
  const completed = db.prepare('SELECT * FROM billing_usage_logs WHERE authorization_id = ?').get(authorizationId);
  if (completed) return { transaction_id: completed.transaction_id, charged_micro: completed.charged_micro, charged: microToCredits(completed.charged_micro), reused: true };
  const snapshot = parse(auth.snapshot_json); const actual = calculateFromSnapshot(snapshot, input.usage); const at = now(); const id = uuid();
  // A provider may report more usage than the estimate. Never consume an amount
  // that was not frozen; the capped amount is recorded in the settlement snapshot.
  const chargedMicro = Math.min(actual.amount_micro, auth.amount_micro);
  const execute = db.transaction(() => {
    const acct = account(db, auth.user_id);
    if (acct.frozen_micro < auth.amount_micro) throw new Error('预授权冻结状态异常');
    const balanceAfter = acct.balance_micro - chargedMicro; const frozenAfter = acct.frozen_micro - auth.amount_micro;
    db.prepare(`UPDATE billing_accounts SET balance_micro = ?, frozen_micro = ?, total_consumed_micro = total_consumed_micro + ?, updated_at = ? WHERE user_id = ?`)
      .run(balanceAfter, frozenAfter, chargedMicro, at, auth.user_id);
    db.prepare(`INSERT INTO billing_transactions (id, user_id, type, amount_micro, balance_after_micro, frozen_after_micro, authorization_id, reference_type, reference_id, reason, snapshot_json, created_at)
      VALUES (?, ?, 'settlement', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, auth.user_id, -chargedMicro, balanceAfter, frozenAfter, authorizationId, auth.reference_type, auth.reference_id, input.reason || null, json({ ...snapshot, actual_usage: actual.usage, charged_micro: chargedMicro, overage_micro: Math.max(0, actual.amount_micro - chargedMicro) }), at);
    db.prepare(`INSERT INTO billing_usage_logs (id, user_id, transaction_id, authorization_id, service_type, model, usage_json, charged_micro, provider_request_id, reference_type, reference_id, snapshot_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uuid(), auth.user_id, id, authorizationId, snapshot.service_type, snapshot.model, json(actual.usage), chargedMicro, input.provider_request_id || null, auth.reference_type, auth.reference_id, json(snapshot), at);
  });
  execute(); return { transaction_id: id, charged_micro: chargedMicro, charged: microToCredits(chargedMicro), overage_micro: Math.max(0, actual.amount_micro - chargedMicro), reused: false };
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
    db.prepare(`INSERT INTO billing_transactions (id, user_id, type, amount_micro, balance_after_micro, frozen_after_micro, authorization_id, reference_type, reference_id, reason, snapshot_json, created_at)
      VALUES (?, ?, 'void', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, auth.user_id, 0, acct.balance_micro, frozenAfter, authorizationId, auth.reference_type, auth.reference_id, reason || '调用未完成，释放预授权', auth.snapshot_json, at);
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

function adjustBalance(db, actorId, userId, credits, reason) {
  const amount = creditsToMicro(credits); if (!amount) throw new Error('调整金额不能为 0');
  const at = now(); const id = uuid();
  db.transaction(() => {
    const acct = account(db, userId); const after = acct.balance_micro + amount;
    if (after < acct.frozen_micro || after < 0) throw new Error('调整后余额不能小于已冻结金额');
    db.prepare(`UPDATE billing_accounts SET balance_micro = ?, total_recharged_micro = total_recharged_micro + ?, updated_at = ? WHERE user_id = ?`)
      .run(after, amount > 0 ? amount : 0, at, userId);
    db.prepare(`INSERT INTO billing_transactions (id, user_id, type, amount_micro, balance_after_micro, frozen_after_micro, reason, created_by, snapshot_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, userId, amount > 0 ? 'recharge' : 'adjustment', amount, after, acct.frozen_micro, String(reason || '').trim() || '管理员余额调整', actorId, json({}), at);
  })();
  audit(db, actorId, 'billing.balance.adjust', 'user', userId, { amount_micro: amount, reason });
  return account(db, userId);
}

// A balance "set" is deliberately distinct from a recharge: it records the
// delta for auditability but makes the supplied value the final balance.
function setBalance(db, actorId, userId, targetCredits, reason) {
  const target = creditsToMicro(targetCredits);
  if (target < 0) throw new Error('目标余额不能小于 0');
  const at = now(); const id = uuid(); let before = 0;
  db.transaction(() => {
    const acct = account(db, userId); before = acct.balance_micro;
    if (target < acct.frozen_micro) throw new Error('目标余额不能小于已冻结金额');
    if (target === before) return;
    db.prepare('UPDATE billing_accounts SET balance_micro = ?, updated_at = ? WHERE user_id = ?').run(target, at, userId);
    db.prepare(`INSERT INTO billing_transactions (id, user_id, type, amount_micro, balance_after_micro, frozen_after_micro, reason, created_by, snapshot_json, created_at)
      VALUES (?, ?, 'adjustment', ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, userId, target - before, target, acct.frozen_micro, String(reason || '').trim() || '管理员设置余额', actorId, json({ operation: 'set_balance', balance_before_micro: before, balance_target_micro: target }), at);
  })();
  audit(db, actorId, 'billing.balance.set', 'user', userId, { balance_before_micro: before, balance_target_micro: target, reason });
  return account(db, userId);
}

function listUsers(db) {
  return db.prepare(`SELECT u.id, u.username, u.display_name, u.role, u.is_active, u.created_at, u.last_login_at,
    COALESCE(a.balance_micro, 0) balance_micro, COALESCE(a.frozen_micro, 0) frozen_micro
    FROM users u LEFT JOIN billing_accounts a ON a.user_id = u.id ORDER BY u.id`).all().map((r) => ({ ...r, is_active: !!r.is_active, balance: microToCredits(r.balance_micro), frozen: microToCredits(r.frozen_micro) }));
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
  const supportedMeters = new Set(['request','image','second','character','input_token','output_token']);
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
    const unitPrice = Number(item.unit_price ?? microToCredits(item.unit_price_micro || 0));
    if (!Number.isSafeInteger(unitPrice) || unitPrice < 0) throw new Error('单价必须是非负整数积分');
    if (status === 'published' && !item.is_free && unitPrice <= 0) throw new Error(`${serviceType}/${model}/${meter} 的免费价目必须显式勾选免费`);
    const conditions = item.conditions_json || {};
    const rates = Array.isArray(conditions.rates) ? conditions.rates : [];
    for (const rate of rates) {
      if (!Number.isSafeInteger(Number(rate.unit_price_points)) || Number(rate.unit_price_points) < 0 || !Number.isSafeInteger(Number(rate.unit_size || conditions.unit_size || 1)) || Number(rate.unit_size || conditions.unit_size || 1) <= 0) throw new Error('条件价格必须使用正整数积分和整数计量单位');
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
      const meter = String(item.meter || '').trim(); if (!['request','image','second','character','input_token','output_token'].includes(meter)) throw new Error('不支持的计量器');
      const serviceType = String(item.service_type || '').trim(); const model = String(item.model || '').trim(); if (!serviceType || !model) throw new Error('价目项需要 service_type 和 model');
      stmt.run(bookId, serviceType, model, meter, creditsToMicro(item.unit_price ?? microToCredits(item.unit_price_micro || 0)), item.is_free ? 1 : 0, item.conditions_json ? json(item.conditions_json) : null, at, at);
    }
  });
  write(); audit(db, actorId, id ? 'price_book.update' : 'price_book.create', 'price_book', bookId, { name: input.name, status: input.status, item_count: items.length });
  return listPriceBooks(db).find((b) => b.id === bookId);
}

function listTransactions(db, filters = {}) {
  let where = 'WHERE 1=1', p = [];
  if (filters.user_id) { where += ' AND t.user_id = ?'; p.push(Number(filters.user_id)); }
  const rows = db.prepare(`SELECT t.*, u.username FROM billing_transactions t JOIN users u ON u.id = t.user_id ${where} ORDER BY t.created_at DESC, t.rowid DESC LIMIT 300`).all(...p);
  return rows.map((r) => ({ ...r, amount: microToCredits(r.amount_micro), balance_after: microToCredits(r.balance_after_micro), frozen_after: microToCredits(r.frozen_after_micro), snapshot: parse(r.snapshot_json) }));
}

function listUsage(db, filters = {}) {
  let where = 'WHERE 1=1', p = []; if (filters.user_id) { where += ' AND l.user_id = ?'; p.push(Number(filters.user_id)); }
  return db.prepare(`SELECT l.*, u.username FROM billing_usage_logs l JOIN users u ON u.id = l.user_id ${where} ORDER BY l.created_at DESC LIMIT 300`).all(...p)
    .map((r) => ({ ...r, charged: microToCredits(r.charged_micro), usage: parse(r.usage_json), snapshot: parse(r.snapshot_json) }));
}

module.exports = { account, publicAccount, audit, quote, activeMeters, createAuthorization, getAuthorization, settleAuthorization, voidAuthorization, markPendingReconciliation, recoverCompletedVideoReconciliations, recoverInterruptedTextReconciliations, listReconciliationCases, settleReconciliationCase, waiveReconciliationCase, expireReconciliationCases, adjustBalance, setBalance, listUsers, listPriceBooks, savePriceBook, listTransactions, listUsage };
