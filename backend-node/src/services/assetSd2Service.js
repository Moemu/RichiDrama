'use strict';

const path = require('path');
const modelArk = require('./modelArkAssetConfigService');
const materialHub = require('./jimengMaterialHubService');
const { uploadLocalImageToProxy } = require('./uploadService');

function parse(raw) { if (!raw) return null; if (typeof raw === 'object') return raw; try { return JSON.parse(raw); } catch (_) { return null; } }
function isPublic(url) { return /^https?:\/\//i.test(String(url || '')) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(String(url)); }
function sourceFingerprint(asset) { return `${asset?.local_path || ''}|${asset?.url || asset?.image_url || ''}|${asset?.checksum || ''}`; }
function tableFor(kind) { return ({ asset: 'assets', scene: 'scenes', prop: 'props' })[String(kind || '').toLowerCase()] || null; }

async function publicImageUrl(asset, cfg, log) {
  const url = String(asset?.url || asset?.image_url || '').trim();
  if (isPublic(url)) return { ok: true, url, via: 'direct' };
  const localPath = String(asset?.local_path || '').trim();
  if (!localPath) return { ok: false, error: '素材没有可认证的图片 URL 或本地文件' };
  const root = path.isAbsolute(cfg?.storage?.local_path) ? cfg.storage.local_path : path.join(process.cwd(), cfg?.storage?.local_path || './data/storage');
  const proxied = await uploadLocalImageToProxy(root, localPath || url, log, `sd2_asset_${asset.id}`);
  if (proxied) return { ok: true, url: proxied, via: 'proxy' };
  const base = String(cfg?.storage?.base_url || '').replace(/\/$/, '');
  if (base && !/localhost|127\.0\.0\.1/i.test(base)) return { ok: true, url: `${base}/static/${localPath.replace(/^\/+/, '')}`, via: 'storage' };
  return { ok: false, error: 'SD2 认证需要可由云端访问的图片，请配置图床或公开 storage.base_url' };
}
function payload(asset, created, sourceUrl, provider) {
  return {
    hub_asset_id: created.id,
    asset_url: created.asset_url || modelArk.assetUrlForVideo(created),
    status: created.status || 'processing',
    sd2_provider: provider,
    source_image_url: sourceUrl,
    certified_image_url: asset?.image_url || asset?.url || null,
    certified_local_path: asset?.local_path || null,
    source_fingerprint: sourceFingerprint(asset),
    updated_at: new Date().toISOString(),
  };
}

function createdAssetFromResult(result, provider) {
  if (!result?.ok) return { ok: false, error: result?.error || 'SD2 认证服务请求失败' };
  const asset = result.data;
  if (!asset || !asset.id) {
    return { ok: false, error: `${provider === 'model_ark' ? 'ModelArk' : 'SD2 素材库'} 未返回有效资产 ID，请稍后重试或检查认证服务配置` };
  }
  return { ok: true, asset };
}
function chooseProvider(db, cfg, log, userId) {
  const ark = modelArk.buildModelArkContext(db, log, userId);
  if (ark.ready) return { provider: 'model_ark', ctx: ark };
  const hub = materialHub.buildHubContext(cfg, db, log, userId);
  if (hub.token) return { provider: 'hub', ctx: hub };
  return { provider: null, error: '未配置 SD2 资产库，请配置 ModelArk 资产库或即梦2认证网关' };
}

function mappedResource(asset) {
  if (asset?.source_type !== 'project_resource') return null;
  try {
    const meta = asset.metadata_json ? JSON.parse(asset.metadata_json) : {};
    const kind = String(meta.resource_type || '');
    const id = Number(meta.resource_id);
    return ['character', 'scene', 'prop'].includes(kind) && id > 0 ? { kind, id } : null;
  } catch (_) { return null; }
}

function mappedAssetAfterSync(db, log, linked) {
  const mapped = require('./assetMappingService').syncEntities(db, log, linked.kind, [linked.id])[0];
  return mapped?.seedance2_asset || null;
}

const activeCertificationPolls = new Set();
const activeBatchCertificationRuns = new Set();

function saveResourceCertification(db, table, id, value) {
  db.prepare(`UPDATE ${table} SET seedance2_asset = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(value), value.updated_at, id);
}

function markCertificationFailed(db, kind, id, error) {
  const table = tableFor(kind);
  if (!table) return;
  try {
    const row = db.prepare(`SELECT seedance2_asset FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(Number(id));
    if (!row) return;
    const previous = parse(row.seedance2_asset) || {};
    const updated_at = new Date().toISOString();
    saveResourceCertification(db, table, id, { ...previous, status: 'failed', error: String(error || 'SD2 认证提交失败'), updated_at });
  } catch (_) {
    // A missing legacy column must never turn a recoverable provider failure
    // into a process-level crash.
  }
}

function scheduleResourceSettlement(db, log, table, id, route, created, initial, pollOverride = null) {
  const key = `${table}:${id}`;
  if (activeCertificationPolls.has(key)) return;
  activeCertificationPolls.add(key);
  setImmediate(async () => {
    try {
      const settled = pollOverride
        ? await pollOverride()
        : route.provider === 'model_ark'
          ? await modelArk.pollAssetUntilSettled(route.ctx, created.id, { log })
          : await materialHub.pollAssetUntilSettled(route.ctx, created.id, { log });
      const at = new Date().toISOString();
      if (!settled.ok) {
        saveResourceCertification(db, table, id, { ...initial, status: 'failed', error: settled.error, updated_at: at });
        return;
      }
      const data = settled.asset || created;
      saveResourceCertification(db, table, id, {
        ...initial,
        asset_url: data?.asset_url || initial.asset_url || modelArk.assetUrlForVideo(data),
        status: data?.status || initial.status,
        poll_timed_out: !!settled.timedOut,
        updated_at: at,
      });
    } catch (error) {
      const at = new Date().toISOString();
      saveResourceCertification(db, table, id, { ...initial, status: 'failed', error: error.message, updated_at: at });
      log.error('SD2 background certification poll failed', { table, id, error: error.message });
    } finally {
      activeCertificationPolls.delete(key);
    }
  });
}

async function certifyResource(db, log, cfg, kind, id, userId) {
  const table = tableFor(kind);
  if (!table) return { ok: false, error: '不支持的 SD2 素材类型' };
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(Number(id));
  if (!row) return { ok: false, error: '素材不存在' };
  if (!String(row.image_url || row.url || '').trim() && !String(row.local_path || '').trim()) return { ok: false, error: '请先为素材上传图片后再认证' };
  const route = chooseProvider(db, cfg, log, userId); if (!route.provider) return { ok: false, error: route.error };
  const source = await publicImageUrl(row, cfg, log); if (!source.ok) return source;
  const name = row.name || row.location || `${kind}-${row.id}`;
  const create = route.provider === 'model_ark' ? await modelArk.createImageAsset(route.ctx, { name, url: source.url }, log) : await materialHub.createImageAsset(route.ctx, { name, url: source.url }, log);
  const createdResult = createdAssetFromResult(create, route.provider);
  if (!createdResult.ok) return createdResult;
  const created = createdResult.asset;
  let out = payload(row, created, source.url, route.provider);
  saveResourceCertification(db, table, row.id, out);
  // Do not hold the HTTP request open for provider polling (typically 5–30s).
  // The persisted processing state is observable through the refresh endpoint.
  scheduleResourceSettlement(db, log, table, row.id, route, created, out);
  return { ok: true, async: true, seedance2_asset: out };
}

async function refreshResource(db, log, cfg, kind, id, userId) {
  const table = tableFor(kind);
  if (!table) return { ok: false, error: '不支持的 SD2 素材类型' };
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(Number(id));
  if (!row) return { ok: false, error: '素材不存在' };
  const previous = parse(row.seedance2_asset);
  if (!previous?.hub_asset_id) return { ok: false, error: '请先完成 SD2 认证' };
  const route = previous.sd2_provider === 'model_ark' ? { provider: 'model_ark', ctx: modelArk.buildModelArkContext(db, log, userId) } : { provider: 'hub', ctx: materialHub.buildHubContext(cfg, db, log, userId) };
  if ((route.provider === 'model_ark' && !route.ctx.ready) || (route.provider === 'hub' && !route.ctx.token)) return { ok: false, error: '当前 SD2 认证配置不可用，无法刷新状态' };
  const result = route.provider === 'model_ark' ? await modelArk.getAsset(route.ctx, previous.hub_asset_id, log) : await materialHub.getAsset(route.ctx, previous.hub_asset_id, log);
  if (!result.ok) return { ok: false, error: result.error };
  const data = result.data;
  const out = { ...previous, asset_url: data.asset_url || previous.asset_url || modelArk.assetUrlForVideo(data), status: data.status || previous.status || 'processing', updated_at: new Date().toISOString() };
  db.prepare(`UPDATE ${table} SET seedance2_asset = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(out), out.updated_at, row.id);
  return { ok: true, seedance2_asset: out };
}

function markResourceStale(db, kind, previous, next) {
  const table = tableFor(kind); if (!table) return;
  const cert = parse(previous?.seedance2_asset); if (!cert) return;
  const oldFp = sourceFingerprint(previous); const newFp = sourceFingerprint({ ...previous, ...next, image_url: next?.image_url ?? previous?.image_url });
  if (oldFp === newFp) return;
  if (String(cert.status || '').toLowerCase() === 'stale' && cert.source_fingerprint && cert.source_fingerprint === newFp) {
    const at = new Date().toISOString();
    const restored = { ...cert, status: 'active', stale_reason: null, restored_from_stale_at: at, updated_at: at };
    db.prepare(`UPDATE ${table} SET seedance2_asset = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(restored), at, previous.id);
    return;
  }
  const out = { ...cert, status: 'stale', stale_reason: 'asset_source_changed', updated_at: new Date().toISOString() };
  db.prepare(`UPDATE ${table} SET seedance2_asset = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(out), out.updated_at, previous.id);
}

async function certify(db, log, cfg, id, userId) {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  if (!asset) return { ok: false, error: '素材不存在' };
  if (asset.type !== 'image') return { ok: false, error: '仅图片素材支持 SD2 认证' };
  const linked = mappedResource(asset);
  if (linked?.kind === 'character') {
    return require('./characterLibraryService').registerCharacterJimengMaterialAsset(db, log, cfg, linked.id, userId);
  }
  if (linked) {
    const out = await certifyResource(db, log, cfg, linked.kind, linked.id, userId);
    if (!out.ok) return out;
    return { ...out, seedance2_asset: mappedAssetAfterSync(db, log, linked) || out.seedance2_asset };
  }
  return certifyResource(db, log, cfg, 'asset', id, userId);
}
async function refresh(db, log, cfg, id, userId) {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  if (!asset) return { ok: false, error: '素材不存在' };
  const linked = mappedResource(asset);
  if (linked?.kind === 'character') return require('./characterLibraryService').refreshCharacterJimengMaterialAsset(db, log, cfg, linked.id, userId);
  if (linked) {
    const out = await refreshResource(db, log, cfg, linked.kind, linked.id, userId);
    if (!out.ok) return out;
    return { ...out, seedance2_asset: mappedAssetAfterSync(db, log, linked) || out.seedance2_asset };
  }
  return refreshResource(db, log, cfg, 'asset', id, userId);
}

function ownedImageAssetIds(db, ownerUserId, ids) {
  const normalized = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 100);
  if (!normalized.length) return [];
  return db.prepare(`SELECT id FROM assets WHERE deleted_at IS NULL AND type = 'image'
    AND id IN (${normalized.map(() => '?').join(', ')})
    AND (owner_user_id = ? OR drama_id IN (SELECT id FROM dramas WHERE owner_user_id = ? AND deleted_at IS NULL))`)
    .all(...normalized, Number(ownerUserId), Number(ownerUserId)).map((row) => Number(row.id));
}

async function runCertificationBatch(db, log, cfg, ids, concurrency = 2, userId) {
  const queue = [...ids]; const outcome = { started: 0, failed: 0 };
  const worker = async () => { while (queue.length) {
    const id = queue.shift();
    try {
      const result = await certify(db, log, cfg, id, userId);
      if (result.ok) outcome.started++;
      else { outcome.failed++; markCertificationFailed(db, 'asset', id, result.error); }
    } catch (error) {
      outcome.failed++; markCertificationFailed(db, 'asset', id, error.message);
      log.warn('SD2 batch certification submission failed', { asset_id: id, error: error.message });
    }
  } };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, Number(concurrency) || 2), ids.length) }, worker));
  return outcome;
}

function queueBatchCertification(db, log, cfg, ownerUserId, ids) {
  const assetIds = ownedImageAssetIds(db, ownerUserId, ids);
  const now = new Date().toISOString();
  const queued = JSON.stringify({ status: 'queued', queued_at: now, updated_at: now });
  const update = db.prepare(`UPDATE assets SET requires_sd2_identity = 1, seedance2_asset = ?, updated_at = ?
    WHERE id = ? AND (seedance2_asset IS NULL OR json_extract(seedance2_asset, '$.status') NOT IN ('active', 'processing'))`);
  db.transaction(() => assetIds.forEach((id) => update.run(queued, now, id)))();
  const key = assetIds.join(',');
  if (assetIds.length && !activeBatchCertificationRuns.has(key)) {
    activeBatchCertificationRuns.add(key);
    setImmediate(() => runCertificationBatch(db, log, cfg, assetIds, 2, ownerUserId)
      .then((outcome) => log.info('SD2 batch certification submitted', { ...outcome, count: assetIds.length }))
      .finally(() => activeBatchCertificationRuns.delete(key)));
  }
  return { queued: assetIds.length, skipped: Math.max(0, (Array.isArray(ids) ? ids.length : 0) - assetIds.length) };
}
function markStale(db, previous, next) { return markResourceStale(db, 'asset', previous, next); }

function resumePendingCertifications(db, log, cfg, options = {}) {
  const kinds = [['asset', 'assets'], ['scene', 'scenes'], ['prop', 'props']];
  const ownerFor = (kind, table, id) => {
    try {
      if (kind === 'asset') {
        return db.prepare(`SELECT COALESCE(a.owner_user_id, d.owner_user_id) AS owner_user_id FROM assets a LEFT JOIN dramas d ON d.id=a.drama_id WHERE a.id=?`).get(id)?.owner_user_id || null;
      }
      return db.prepare(`SELECT d.owner_user_id FROM ${table} r LEFT JOIN dramas d ON d.id=r.drama_id WHERE r.id=?`).get(id)?.owner_user_id || null;
    } catch (_) { return null; }
  };
  const refreshOne = async () => {
    for (const [kind, table] of kinds) {
      let rows = [];
      try { rows = db.prepare(`SELECT id, seedance2_asset FROM ${table} WHERE deleted_at IS NULL AND seedance2_asset IS NOT NULL`).all(); } catch (_) { continue; }
      for (const row of rows) {
        const ownerUserId = ownerFor(kind, table, row.id);
        const cert = parse(row.seedance2_asset);
        const status = String(cert?.status || '').toLowerCase();
        if (status === 'queued') {
          try {
            const result = await (kind === 'asset' ? certify(db, log, cfg, row.id, ownerUserId) : certifyResource(db, log, cfg, kind, row.id, ownerUserId));
            if (!result?.ok) markCertificationFailed(db, kind, row.id, result?.error);
          } catch (error) {
            markCertificationFailed(db, kind, row.id, error.message);
            log.warn('SD2 queued certification recovery failed', { table, id: row.id, error: error.message });
          }
          continue;
        }
        if (status !== 'processing' || !cert?.hub_asset_id) continue;
        try { await (options.refreshResource || refreshResource)(db, log, cfg, kind, row.id, ownerUserId); }
        catch (error) { log.warn('SD2 restart recovery refresh failed', { table, id: row.id, error: error.message }); }
      }
    }
    // Characters use a separate library representation but follow the same
    // persisted processing contract.
    try {
      const characters = db.prepare(`SELECT c.id, c.seedance2_asset, d.owner_user_id
        FROM characters c LEFT JOIN dramas d ON d.id=c.drama_id
        WHERE c.deleted_at IS NULL AND c.seedance2_asset IS NOT NULL`).all();
      for (const row of characters) {
        if (String(parse(row.seedance2_asset)?.status || '').toLowerCase() === 'processing') {
          await (options.refreshCharacter || require('./characterLibraryService').refreshCharacterJimengMaterialAsset)(db, log, cfg, row.id, row.owner_user_id || null);
        }
      }
    } catch (error) { log.warn('Character SD2 restart recovery refresh failed', { error: error.message }); }
  };
  if (options.immediate !== false) setImmediate(() => refreshOne().catch((error) => log.error('SD2 restart recovery failed', { error: error.message })));
  const interval = Number(options.interval_ms ?? 10_000);
  const timer = interval > 0 ? setInterval(() => refreshOne().catch((error) => log.error('SD2 recovery poll failed', { error: error.message })), interval) : null;
  if (typeof timer?.unref === 'function') timer.unref();
  return { refreshNow: refreshOne, stop: () => timer && clearInterval(timer) };
}

module.exports = { certify, refresh, queueBatchCertification, runCertificationBatch, ownedImageAssetIds, markStale, markCertificationFailed, certifyResource, refreshResource, markResourceStale, parse, sourceFingerprint, createdAssetFromResult, scheduleResourceSettlement, resumePendingCertifications };
