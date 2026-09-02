'use strict';

const richbest = require('./richbestAssetV3Service');

const running = new Set();

function cutoff(value) {
  const raw = String(value || '').trim();
  if (!raw || Number.isNaN(Date.parse(raw))) throw new Error('必须提供有效的修复时间');
  return new Date(raw).toISOString();
}

function candidateRows(db, cutoffAt) {
  return db.prepare(`SELECT b.id AS binding_id,b.resource_type,b.resource_id,b.local_asset_id,
      b.remote_asset_id,b.status,b.active_at,b.created_at,b.owner_user_id,b.tenant_id,
      CASE WHEN b.resource_type='asset' THEN a.name ELSE c.name END AS name,
      CASE WHEN b.resource_type='asset' THEN a.local_path ELSE c.local_path END AS local_path,
      CASE WHEN b.resource_type='asset' THEN a.deleted_at ELSE c.deleted_at END AS deleted_at
    FROM external_asset_bindings b
    LEFT JOIN assets a ON b.resource_type='asset' AND a.id=b.resource_id
    LEFT JOIN characters c ON b.resource_type='character' AND c.id=b.resource_id
    WHERE b.provider='richbest_asset_v3'
      AND (b.status='active' OR (b.status='stale' AND b.error_code='admin_rebind_requested'))
      AND COALESCE(b.active_at,b.created_at) <= ?
      AND NOT EXISTS (
        SELECT 1 FROM external_asset_bindings newer
        WHERE newer.provider=b.provider
          AND newer.resource_type=b.resource_type AND newer.resource_id=b.resource_id
          AND newer.source_fingerprint=b.source_fingerprint AND newer.id>b.id
          AND newer.status IN ('queued','uploading','registering','processing','reconciling','active')
      )
    ORDER BY COALESCE(b.active_at,b.created_at),b.id`).all(cutoffAt);
}

function listCandidates(db, query = {}) {
  const cutoffAt = cutoff(query.before || query.cutoff_at);
  const items = candidateRows(db, cutoffAt).map((row) => ({
    ...row,
    eligible: !row.deleted_at && !!String(row.local_path || '').trim(),
    blocked_reason: row.deleted_at ? '本地素材已删除' : (!String(row.local_path || '').trim() ? '缺少本地持久化文件' : null),
  }));
  return {
    cutoff_at: cutoffAt,
    total: items.length,
    eligible: items.filter((item) => item.eligible).length,
    blocked: items.filter((item) => !item.eligible).length,
    items,
  };
}

function view(db, id) {
  const run = db.prepare('SELECT * FROM richbest_asset_rebind_runs WHERE id=?').get(String(id));
  if (!run) return null;
  return {
    ...run,
    items: db.prepare('SELECT * FROM richbest_asset_rebind_items WHERE run_id=? ORDER BY id').all(run.id),
  };
}

function create(db, actorUserId, body = {}) {
  const id = String(body.idempotency_key || '').trim();
  if (!id) throw new Error('缺少幂等键');
  const existing = view(db, id);
  if (existing) return { ...existing, reused: true };
  const cutoffAt = cutoff(body.cutoff_at);
  const reason = String(body.reason || '').trim();
  if (!reason) throw new Error('必须填写重绑原因');
  const requested = [...new Set((body.binding_ids || []).map(Number)
    .filter((value) => Number.isSafeInteger(value) && value > 0))];
  if (!requested.length) throw new Error('请选择需要重绑的素材');
  const candidates = new Map(candidateRows(db, cutoffAt).map((row) => [Number(row.binding_id), row]));
  const selected = requested.map((bindingId) => candidates.get(bindingId)).filter(Boolean)
    .filter((row) => !row.deleted_at && String(row.local_path || '').trim());
  if (selected.length !== requested.length) {
    throw new Error('所选绑定包含已处理、已删除、超出修复时间或缺少本地文件的素材，请刷新候选列表');
  }
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`INSERT INTO richbest_asset_rebind_runs
      (id,actor_user_id,cutoff_at,reason,status,total,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(id, Number(actorUserId), cutoffAt, reason, 'queued', selected.length, now, now);
    const insert = db.prepare(`INSERT INTO richbest_asset_rebind_items
      (run_id,binding_id,resource_type,resource_id,old_remote_asset_id,status,created_at,updated_at)
      VALUES (?,?,?,?,?,'queued',?,?)`);
    selected.forEach((row) => insert.run(id, row.binding_id, row.resource_type, row.resource_id, row.remote_asset_id, now, now));
  })();
  return view(db, id);
}

function latestBinding(db, old) {
  return db.prepare(`SELECT * FROM external_asset_bindings
    WHERE provider=? AND resource_type=? AND resource_id=? AND source_fingerprint=?
    ORDER BY id DESC LIMIT 1`).get(
    old.provider, old.resource_type, old.resource_id, old.source_fingerprint
  );
}

async function processItem(db, log, cfg, run, item, options) {
  const old = db.prepare('SELECT * FROM external_asset_bindings WHERE id=?').get(item.binding_id);
  if (!old) throw new Error('原绑定记录不存在');
  let latest = latestBinding(db, old);
  if (latest && latest.id !== old.id && latest.status === 'active') return latest;
  richbest.prepareRebind(db, log, old.id, run.reason);
  const invoke = old.resource_type === 'asset'
    ? (options.registerAsset || richbest.registerAsset)
    : (options.registerCharacter || richbest.registerCharacter);
  const result = await invoke(db, log, cfg, old.resource_id, old.owner_user_id);
  if (!result?.ok) throw new Error(result?.error || 'Richbest 重绑失败');
  latest = latestBinding(db, old);
  if (!latest || latest.id === old.id) throw new Error('重绑未创建新的绑定记录');
  return latest;
}

function summarize(db, runId) {
  const counts = db.prepare(`SELECT COUNT(*) AS total,
      SUM(status='succeeded') AS succeeded,SUM(status='failed') AS failed,
      SUM(status IN ('queued','processing')) AS pending
    FROM richbest_asset_rebind_items WHERE run_id=?`).get(runId);
  const now = new Date().toISOString();
  const status = Number(counts.pending) > 0 ? 'processing'
    : (Number(counts.failed) > 0 ? 'partial_failed' : 'completed');
  db.prepare(`UPDATE richbest_asset_rebind_runs SET status=?,total=?,succeeded=?,failed=?,updated_at=?,completed_at=? WHERE id=?`)
    .run(status, counts.total, counts.succeeded || 0, counts.failed || 0, now, status === 'processing' ? null : now, runId);
}

async function process(db, log, cfg, runId, options = {}) {
  const id = String(runId);
  if (running.has(id)) return view(db, id);
  running.add(id);
  try {
    const run = db.prepare('SELECT * FROM richbest_asset_rebind_runs WHERE id=?').get(id);
    if (!run || ['completed','partial_failed'].includes(run.status)) return view(db, id);
    db.prepare("UPDATE richbest_asset_rebind_runs SET status='processing',updated_at=? WHERE id=?")
      .run(new Date().toISOString(), id);
    const queue = db.prepare("SELECT * FROM richbest_asset_rebind_items WHERE run_id=? AND status IN ('queued','processing') ORDER BY id")
      .all(id);
    const worker = async () => {
      while (queue.length) {
        const item = queue.shift();
        db.prepare("UPDATE richbest_asset_rebind_items SET status='processing',error_message=NULL,updated_at=? WHERE id=?")
          .run(new Date().toISOString(), item.id);
        try {
          const next = await processItem(db, log, cfg, run, item, options);
          const pending = ['queued','uploading','registering','processing','reconciling']
            .includes(String(next.status || '').toLowerCase());
          const now = new Date().toISOString();
          db.prepare(`UPDATE richbest_asset_rebind_items SET new_binding_id=?,new_remote_asset_id=?,status=?,updated_at=?,completed_at=? WHERE id=?`)
            .run(next.id, next.remote_asset_id || null, pending ? 'processing' : 'succeeded', now, pending ? null : now, item.id);
        } catch (error) {
          const now = new Date().toISOString();
          db.prepare("UPDATE richbest_asset_rebind_items SET status='failed',error_message=?,updated_at=?,completed_at=? WHERE id=?")
            .run(String(error.message || error).slice(0, 2000), now, now, item.id);
          log.warn('Richbest asset rebind item failed', { run_id: id, binding_id: item.binding_id, error: error.message });
        }
      }
    };
    await Promise.all([worker(), worker()]);
    summarize(db, id);
    return view(db, id);
  } finally { running.delete(id); }
}

function dispatch(db, log, cfg, runId, options = {}) {
  setImmediate(() => process(db, log, cfg, runId, options).catch((error) => {
    log.error('Richbest asset rebind run failed', { run_id: runId, error: error.message });
  }));
}

function startRecovery(db, log, cfg, options = {}) {
  const run = () => db.prepare("SELECT id FROM richbest_asset_rebind_runs WHERE status IN ('queued','processing') ORDER BY created_at")
    .all().forEach((row) => dispatch(db, log, cfg, row.id, options));
  if (options.immediate !== false) setImmediate(run);
  const timer = setInterval(run, Number(options.interval_ms || 30_000));
  if (typeof timer.unref === 'function') timer.unref();
  return { runNow: run, stop: () => clearInterval(timer) };
}

module.exports = { listCandidates, create, view, process, dispatch, startRecovery };
