'use strict';
const { randomUUID } = require('node:crypto');
const provider = require('./providerPriceService');
const dayOf = at => new Date(Date.parse(at) + 28800000).toISOString().slice(0, 10);

function snapshots(db) {
  const rows = db.prepare(`WITH sources AS (SELECT id,substr(datetime(fetched_at,'+8 hours'),1,10) day,source_config_id,fetched_at,raw_json FROM supplier_cost_snapshots WHERE status='completed'
    UNION ALL SELECT 'provider-sync:'||id,substr(datetime(fetched_at,'+8 hours'),1,10),source_config_id,fetched_at,raw_response_json
    FROM provider_price_syncs WHERE status IN ('completed','unchanged') AND fetched_at IS NOT NULL AND json_valid(raw_response_json) AND json_array_length(raw_response_json)>0),
    daily AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY day ORDER BY fetched_at,id) ordinal FROM sources)
    SELECT id,day,source_config_id,fetched_at,raw_json FROM daily WHERE ordinal=1 ORDER BY day DESC`).all();
  const days = new Map();
  for (const row of rows) {
    if (days.has(row.day)) continue;
    let items; try { items = JSON.parse(row.raw_json); } catch (_) { continue; }
    if (!Array.isArray(items) || !items.length) continue;
    days.set(row.day, { id: row.id, day: row.day, source_config_id: row.source_config_id, fetched_at: row.fetched_at, items });
  }
  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day));
}

function status(db) {
  const currentDay = dayOf(new Date().toISOString());
  const latest = snapshots(db)[0];
  const current = db.prepare('SELECT id,status,created_at,error_summary FROM supplier_cost_snapshots WHERE snapshot_day=?').get(currentDay);
  return { day: currentDay, status: latest?.day === currentDay ? 'completed' : current?.status || 'missing', job_id: current?.id || null,
    latest: latest ? { id: latest.id, day: latest.day, fetched_at: latest.fetched_at, models: latest.items.length } : null,
    error: current?.error_summary || null };
}

async function run(db, id, credential, log) {
  try {
    const result = await provider.fetchAllActivations(credential);
    if (!result.items.length) throw new Error('供应商返回空价格列表，保留最近成功的价格');
    db.prepare(`UPDATE supplier_cost_snapshots SET status='completed',fetched_at=?,raw_json=?,request_ids_json=?,error_summary=NULL WHERE id=? AND status='processing'`)
      .run(new Date().toISOString(), JSON.stringify(result.items), JSON.stringify(result.requestIds), id);
  } catch (error) {
    db.prepare("UPDATE supplier_cost_snapshots SET status='failed',error_summary=? WHERE id=? AND status='processing'")
      .run(String(error.message || error).slice(0, 500), id);
    log.warn('supplier cost price snapshot failed', { id, error: error.message });
  }
}

function queue(db, actor, log = console) {
  const at = new Date().toISOString(), day = dayOf(at);
  // A stopped worker cannot hold today's refresh forever after a restart.
  db.prepare("UPDATE supplier_cost_snapshots SET status='failed',error_summary='价格获取中断，可重试' WHERE status='processing' AND created_at<?")
    .run(new Date(Date.now() - 30 * 60000).toISOString());
  const existing = status(db);
  if (['processing', 'completed'].includes(existing.status)) return existing;
  const credential = provider.credentials(db);
  const id = randomUUID();
  const inserted = db.prepare(`INSERT INTO supplier_cost_snapshots(id,snapshot_day,source_config_id,created_by,created_at)
    VALUES(?,?,?,?,?) ON CONFLICT(snapshot_day) DO UPDATE SET id=excluded.id,status='processing',source_config_id=excluded.source_config_id,
    created_by=excluded.created_by,created_at=excluded.created_at,error_summary=NULL WHERE supplier_cost_snapshots.status='failed'`)
    .run(id, day, credential.configId, actor || null, at);
  if (inserted.changes) setImmediate(() => run(db, id, credential, log));
  return status(db);
}

function startDailySync(db, log = console) {
  const tick = () => {
    try {
      const latestAttempt = db.prepare('SELECT created_at,status FROM supplier_cost_snapshots WHERE snapshot_day=?').get(dayOf(new Date().toISOString()));
      if (latestAttempt && Date.now() - Date.parse(latestAttempt.created_at) < (latestAttempt.status === 'processing' ? 30 * 60000 : 3600000)) return;
      queue(db, null, log);
    } catch (error) { log.warn('supplier cost daily prices unavailable', { error: error.message }); }
  };
  tick();
  const timer = setInterval(tick, 15 * 60000); timer.unref?.(); return timer;
}
module.exports = { snapshots, status, queue, startDailySync };
