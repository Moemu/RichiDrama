'use strict';

// Generic SD2 asset registration. Characters keep their richer display metadata,
// while media-library assets use the same provider contract and asset:// result.
const path = require('path');
const modelArk = require('./modelArkAssetConfigService');
const materialHub = require('./jimengMaterialHubService');
const { uploadLocalImageToProxy } = require('./uploadService');

function parse(raw) { try { return raw ? JSON.parse(raw) : null; } catch (_) { return null; } }
function isPublic(url) { return /^https?:\/\//i.test(String(url || '')) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(String(url)); }

async function publicImageUrl(asset, cfg, log) {
  const url = String(asset.url || '').trim();
  if (isPublic(url)) return { ok: true, url, via: 'direct' };
  const localPath = String(asset.local_path || '').trim();
  if (!localPath) return { ok: false, error: '素材没有可认证的图片 URL 或本地文件' };
  const root = path.isAbsolute(cfg?.storage?.local_path) ? cfg.storage.local_path : path.join(process.cwd(), cfg?.storage?.local_path || './data/storage');
  const proxied = await uploadLocalImageToProxy(root, localPath || url, log, `sd2_asset_${asset.id}`);
  if (proxied) return { ok: true, url: proxied, via: 'proxy' };
  const base = String(cfg?.storage?.base_url || '').replace(/\/$/, '');
  if (base && !/localhost|127\.0\.0\.1/i.test(base)) return { ok: true, url: `${base}/static/${localPath.replace(/^\/+/, '')}`, via: 'storage' };
  return { ok: false, error: 'SD2 认证需要可由云端访问的图片。请配置图床或公开 storage.base_url' };
}

function sourceFingerprint(asset) { return `${asset.local_path || ''}|${asset.url || ''}|${asset.checksum || ''}`; }
function payload(asset, created, sourceUrl, provider) {
  return {
    hub_asset_id: created.id,
    asset_url: created.asset_url || modelArk.assetUrlForVideo(created),
    status: created.status || 'processing', sd2_provider: provider,
    source_image_url: sourceUrl, source_fingerprint: sourceFingerprint(asset),
    updated_at: new Date().toISOString(),
  };
}

function chooseProvider(db, cfg, log) {
  const ark = modelArk.buildModelArkContext(db, log);
  if (ark.ready) return { provider: 'model_ark', ctx: ark };
  const hub = materialHub.buildHubContext(cfg, db, log);
  if (hub.token) return { provider: 'hub', ctx: hub };
  return { provider: null, error: '未配置 SD2 资产库：请配置 ModelArk 资产库或即梦2角色认证网关' };
}

async function certify(db, log, cfg, id) {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  if (!asset) return { ok: false, error: '素材不存在' };
  if (asset.type !== 'image') return { ok: false, error: '仅图片素材支持 SD2 认证' };
  const route = chooseProvider(db, cfg, log); if (!route.provider) return { ok: false, error: route.error };
  const source = await publicImageUrl(asset, cfg, log); if (!source.ok) return source;
  const create = route.provider === 'model_ark'
    ? await modelArk.createImageAsset(route.ctx, { name: asset.name || `asset-${asset.id}`, url: source.url }, log)
    : await materialHub.createImageAsset(route.ctx, { name: asset.name || `asset-${asset.id}`, url: source.url }, log);
  if (!create.ok) return { ok: false, error: create.error };
  let out = payload(asset, create.data, source.url, route.provider);
  db.prepare('UPDATE assets SET seedance2_asset = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(out), out.updated_at, asset.id);
  const settled = route.provider === 'model_ark'
    ? await modelArk.pollAssetUntilSettled(route.ctx, create.data.id, { log })
    : await materialHub.pollAssetUntilSettled(route.ctx, create.data.id, { log });
  if (!settled.ok) return { ok: false, error: settled.error };
  const data = settled.asset || create.data;
  out = { ...out, asset_url: data.asset_url || out.asset_url || modelArk.assetUrlForVideo(data), status: data.status || out.status, poll_timed_out: !!settled.timedOut, updated_at: new Date().toISOString() };
  db.prepare('UPDATE assets SET seedance2_asset = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(out), out.updated_at, asset.id);
  return { ok: true, seedance2_asset: out };
}

async function refresh(db, log, cfg, id) {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  if (!asset) return { ok: false, error: '素材不存在' };
  const previous = parse(asset.seedance2_asset); if (!previous?.hub_asset_id) return { ok: false, error: '请先完成 SD2 认证' };
  const route = previous.sd2_provider === 'model_ark' ? { provider: 'model_ark', ctx: modelArk.buildModelArkContext(db, log) } : { provider: 'hub', ctx: materialHub.buildHubContext(cfg, db, log) };
  if ((route.provider === 'model_ark' && !route.ctx.ready) || (route.provider === 'hub' && !route.ctx.token)) return { ok: false, error: '当前 SD2 认证配置不可用，无法刷新状态' };
  const result = route.provider === 'model_ark' ? await modelArk.getAsset(route.ctx, previous.hub_asset_id, log) : await materialHub.getAsset(route.ctx, previous.hub_asset_id, log);
  if (!result.ok) return { ok: false, error: result.error };
  const data = result.data;
  const out = { ...previous, asset_url: data.asset_url || previous.asset_url || modelArk.assetUrlForVideo(data), status: data.status || previous.status || 'processing', updated_at: new Date().toISOString() };
  db.prepare('UPDATE assets SET seedance2_asset = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(out), out.updated_at, asset.id);
  return { ok: true, seedance2_asset: out };
}

function markStale(db, previous, next) {
  const cert = parse(previous.seedance2_asset); if (!cert) return;
  const oldFp = sourceFingerprint(previous); const newFp = sourceFingerprint({ ...previous, ...next });
  if (oldFp === newFp) return;
  const out = { ...cert, status: 'stale', stale_reason: 'asset_source_changed', updated_at: new Date().toISOString() };
  db.prepare('UPDATE assets SET seedance2_asset = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(out), out.updated_at, previous.id);
}

module.exports = { certify, refresh, markStale, parse, sourceFingerprint };
