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
function chooseProvider(db, cfg, log) {
  const ark = modelArk.buildModelArkContext(db, log);
  if (ark.ready) return { provider: 'model_ark', ctx: ark };
  const hub = materialHub.buildHubContext(cfg, db, log);
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

async function certifyResource(db, log, cfg, kind, id) {
  const table = tableFor(kind);
  if (!table) return { ok: false, error: '不支持的 SD2 素材类型' };
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(Number(id));
  if (!row) return { ok: false, error: '素材不存在' };
  if (!String(row.image_url || row.url || '').trim() && !String(row.local_path || '').trim()) return { ok: false, error: '请先为素材上传图片后再认证' };
  const route = chooseProvider(db, cfg, log); if (!route.provider) return { ok: false, error: route.error };
  const source = await publicImageUrl(row, cfg, log); if (!source.ok) return source;
  const name = row.name || row.location || `${kind}-${row.id}`;
  const create = route.provider === 'model_ark' ? await modelArk.createImageAsset(route.ctx, { name, url: source.url }, log) : await materialHub.createImageAsset(route.ctx, { name, url: source.url }, log);
  if (!create.ok) return { ok: false, error: create.error };
  let out = payload(row, create.data, source.url, route.provider);
  db.prepare(`UPDATE ${table} SET seedance2_asset = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(out), out.updated_at, row.id);
  const settled = route.provider === 'model_ark' ? await modelArk.pollAssetUntilSettled(route.ctx, create.data.id, { log }) : await materialHub.pollAssetUntilSettled(route.ctx, create.data.id, { log });
  if (!settled.ok) return { ok: false, error: settled.error };
  const data = settled.asset || create.data;
  out = { ...out, asset_url: data.asset_url || out.asset_url || modelArk.assetUrlForVideo(data), status: data.status || out.status, poll_timed_out: !!settled.timedOut, updated_at: new Date().toISOString() };
  db.prepare(`UPDATE ${table} SET seedance2_asset = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(out), out.updated_at, row.id);
  return { ok: true, seedance2_asset: out };
}

async function refreshResource(db, log, cfg, kind, id) {
  const table = tableFor(kind);
  if (!table) return { ok: false, error: '不支持的 SD2 素材类型' };
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(Number(id));
  if (!row) return { ok: false, error: '素材不存在' };
  const previous = parse(row.seedance2_asset);
  if (!previous?.hub_asset_id) return { ok: false, error: '请先完成 SD2 认证' };
  const route = previous.sd2_provider === 'model_ark' ? { provider: 'model_ark', ctx: modelArk.buildModelArkContext(db, log) } : { provider: 'hub', ctx: materialHub.buildHubContext(cfg, db, log) };
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

async function certify(db, log, cfg, id) {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  if (!asset) return { ok: false, error: '素材不存在' };
  if (asset.type !== 'image') return { ok: false, error: '仅图片素材支持 SD2 认证' };
  const linked = mappedResource(asset);
  if (linked?.kind === 'character') {
    return require('./characterLibraryService').registerCharacterJimengMaterialAsset(db, log, cfg, linked.id);
  }
  if (linked) {
    const out = await certifyResource(db, log, cfg, linked.kind, linked.id);
    if (!out.ok) return out;
    return { ...out, seedance2_asset: mappedAssetAfterSync(db, log, linked) || out.seedance2_asset };
  }
  return certifyResource(db, log, cfg, 'asset', id);
}
async function refresh(db, log, cfg, id) {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  if (!asset) return { ok: false, error: '素材不存在' };
  const linked = mappedResource(asset);
  if (linked?.kind === 'character') return require('./characterLibraryService').refreshCharacterJimengMaterialAsset(db, log, cfg, linked.id);
  if (linked) {
    const out = await refreshResource(db, log, cfg, linked.kind, linked.id);
    if (!out.ok) return out;
    return { ...out, seedance2_asset: mappedAssetAfterSync(db, log, linked) || out.seedance2_asset };
  }
  return refreshResource(db, log, cfg, 'asset', id);
}
function markStale(db, previous, next) { return markResourceStale(db, 'asset', previous, next); }

module.exports = { certify, refresh, markStale, certifyResource, refreshResource, markResourceStale, parse, sourceFingerprint };
