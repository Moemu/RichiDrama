'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROVIDER = 'richbest_asset_v3';
const DEFAULT_BASE_URL = 'https://api.richbest.cn';
const PENDING_STATUSES = new Set(['queued', 'uploading', 'registering', 'processing', 'reconciling']);

class RichbestAssetError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'RichbestAssetError';
    this.status = options.status || null;
    this.code = options.code || null;
    this.requestId = options.requestId || null;
    this.ambiguous = !!options.ambiguous;
    this.fallbackAllowed = !!options.fallbackAllowed;
    this.durationMs = Number(options.durationMs || 0) || null;
  }
}

function parseJson(raw, fallback = null) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (_) { return fallback; }
}

function normalizeStatus(raw) {
  const status = String(raw || '').trim().toLowerCase();
  if (['active', 'available', 'ready', 'completed', 'complete', 'success', 'succeeded'].includes(status)) return 'active';
  if (['failed', 'fail', 'error', 'invalid'].includes(status)) return 'failed';
  if (status === 'stale') return 'stale';
  if (PENDING_STATUSES.has(status)) return status;
  return 'processing';
}

function assetUrlForVideo(assetId) {
  const id = String(assetId || '').trim();
  if (!id) return null;
  if (id.startsWith('asset://')) return id;
  return `asset://${id.replace(/^\/+/, '')}`;
}

function requestIdFrom(payload, response) {
  return String(
    payload?.requestId || payload?.RequestId || payload?.request_id
    || payload?.ResponseMetadata?.RequestId || response?.headers?.get?.('x-request-id') || ''
  ).trim() || null;
}

function errorView(payload, response) {
  const error = payload?.error || payload?.Error || payload?.ResponseMetadata?.Error || {};
  const message = typeof error === 'string'
    ? error
    : error.message || error.Message || payload?.message || payload?.detail || response?.statusText || '远端素材服务请求失败';
  const code = typeof error === 'object' ? (error.code || error.Code) : null;
  return { message: String(message).slice(0, 2000), code: code ? String(code) : null };
}

async function request(ctx, pathname, options = {}) {
  const startedAt = Date.now();
  const method = options.method || 'GET';
  const writeAttempt = !!options.writeAttempt;
  const url = new URL(pathname, `${ctx.baseUrl}/`);
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value == null || value === '') continue;
    if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, String(item)));
    else url.searchParams.set(key, String(value));
  }
  const headers = { Authorization: `Bearer ${ctx.apiKey}`, Accept: 'application/json', ...(options.headers || {}) };
  let body = options.body;
  if (body != null && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  let response;
  try {
    response = await (ctx.fetchImpl || fetch)(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(options.timeoutMs || 30_000),
    });
  } catch (error) {
    throw new RichbestAssetError(`远端素材服务网络请求失败：${error.message}`, {
      ambiguous: writeAttempt,
      fallbackAllowed: !writeAttempt,
      durationMs: Date.now() - startedAt,
    });
  }
  const raw = await response.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch (_) { payload = { _raw: raw }; }
  if (!response.ok) {
    const view = errorView(payload, response);
    throw new RichbestAssetError(view.message, {
      status: response.status,
      code: view.code,
      requestId: requestIdFrom(payload, response),
      ambiguous: writeAttempt && response.status >= 500,
      fallbackAllowed: !writeAttempt,
      durationMs: Date.now() - startedAt,
    });
  }
  return { payload, requestId: requestIdFrom(payload, response), status: response.status, durationMs: Date.now() - startedAt };
}

function loadConfigRow(db, userId) {
  const tenantService = require('./tenantService');
  const tenant = userId ? tenantService.tenantForUser(db, userId) : null;
  if (tenant) {
    const bound = db.prepare(`SELECT c.id, c.name, c.base_url, c.api_key, c.provider, c.settings, ? AS tenant_id
      FROM tenant_sd2_config_bindings b JOIN ai_service_configs c ON c.id=b.ai_config_id
      WHERE b.tenant_id=? AND b.is_active=1 AND c.deleted_at IS NULL AND c.is_active=1
        AND c.service_type='jimeng2_character_auth' AND c.provider=?
      ORDER BY c.is_default DESC, c.priority DESC, c.id ASC LIMIT 1`)
      .get(tenant.id, tenant.id, PROVIDER);
    if (bound) return bound;
    if (!tenantService.usesLegacyGlobalConfigs(db, tenant.id)) return null;
  }
  return db.prepare(`SELECT id, name, base_url, api_key, provider, settings, ? AS tenant_id
    FROM ai_service_configs WHERE deleted_at IS NULL AND is_active=1
      AND service_type='jimeng2_character_auth' AND provider=?
    ORDER BY is_default DESC, priority DESC, id ASC LIMIT 1`).get(tenant?.id || 0, PROVIDER) || null;
}

function buildContext(db, userId, options = {}) {
  const row = options.row || loadConfigRow(db, userId);
  if (!row) return { ready: false, provider: PROVIDER, error: '未配置 Richbest 多类型素材 API' };
  const baseUrl = String(row.base_url || DEFAULT_BASE_URL).trim().replace(/\/$/, '');
  const apiKey = String(row.api_key || '').trim().replace(/^Bearer\s+/i, '').trim();
  if (!baseUrl || !apiKey) return { ready: false, provider: PROVIDER, row, error: 'Richbest 素材 API 缺少 Base URL 或业务 API Key' };
  return {
    ready: true,
    provider: PROVIDER,
    row,
    tenantId: Number(row.tenant_id || 0),
    baseUrl,
    apiKey,
    fetchImpl: options.fetchImpl,
  };
}

async function verify(ctx) {
  const result = await request(ctx, '/api/auth/me', { fallbackAllowed: true });
  if (result.payload?.authenticated !== true) {
    throw new RichbestAssetError('Richbest 业务 API Key 未通过验证', { fallbackAllowed: true, requestId: result.requestId });
  }
  return result.payload;
}

function pick(obj, keys) {
  for (const key of keys) if (obj && obj[key] != null && obj[key] !== '') return obj[key];
  return null;
}

function unwrapAsset(payload, depth = 0) {
  if (!payload || typeof payload !== 'object' || depth > 6) return null;
  if (Array.isArray(payload)) {
    for (const item of payload) { const found = unwrapAsset(item, depth + 1); if (found) return found; }
    return null;
  }
  const id = pick(payload, ['assetId', 'asset_id', 'Id', 'id']);
  if (id && (payload.status != null || payload.Status != null || payload.assetType != null || payload.AssetType != null)) {
    return {
      id: String(id),
      name: pick(payload, ['name', 'Name']),
      status: normalizeStatus(pick(payload, ['status', 'Status', 'state', 'State'])),
      raw: payload,
    };
  }
  for (const key of ['data', 'result', 'Result', 'asset', 'Asset', 'item', 'Item']) {
    const found = unwrapAsset(payload[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function extractAssetItems(payload, depth = 0) {
  if (!payload || typeof payload !== 'object' || depth > 6) return [];
  if (Array.isArray(payload)) return payload.map((item) => unwrapAsset(item)).filter(Boolean);
  for (const key of ['items', 'Items', 'assets', 'Assets', 'list', 'List', 'data', 'result', 'Result']) {
    const items = extractAssetItems(payload[key], depth + 1);
    if (items.length) return items;
  }
  const single = unwrapAsset(payload);
  return single ? [single] : [];
}

function unwrapGroup(payload, depth = 0) {
  if (!payload || typeof payload !== 'object' || depth > 6) return null;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = unwrapGroup(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const id = pick(payload, [
    'groupId', 'group_id', 'GroupId',
    'assetGroupId', 'asset_group_id', 'AssetGroupId',
    'id', 'Id',
  ]);
  if (id) {
    return {
      id: String(id),
      name: pick(payload, ['name', 'Name', 'groupName', 'group_name', 'GroupName']),
      raw: payload,
    };
  }
  for (const key of ['data', 'result', 'Result', 'group', 'Group', 'assetGroup', 'AssetGroup', 'item', 'Item']) {
    const found = unwrapGroup(payload[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function extractGroupItems(payload, depth = 0) {
  if (!payload || typeof payload !== 'object' || depth > 6) return [];
  if (Array.isArray(payload)) return payload.map((item) => unwrapGroup(item)).filter(Boolean);
  for (const key of ['items', 'Items', 'groups', 'Groups', 'assetGroups', 'AssetGroups', 'list', 'List', 'data', 'result', 'Result']) {
    const items = extractGroupItems(payload[key], depth + 1);
    if (items.length) return items;
  }
  const single = unwrapGroup(payload);
  return single ? [single] : [];
}

async function findGroupByName(ctx, name) {
  const result = await request(ctx, '/api/asset-group/list', {
    query: { name, pageNumber: 1, pageSize: 20 },
  });
  return extractGroupItems(result.payload)
    .find((item) => String(item.name || '') === String(name)) || null;
}

function saveGroup(db, ctx, name, groupId) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO external_asset_groups
    (tenant_id,ai_config_id,provider,remote_group_id,name,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(tenant_id,ai_config_id,provider) DO UPDATE SET
      remote_group_id=excluded.remote_group_id,name=excluded.name,updated_at=excluded.updated_at`)
    .run(ctx.tenantId, ctx.row.id, PROVIDER, groupId, name, now, now);
  return db.prepare(`SELECT * FROM external_asset_groups WHERE tenant_id=? AND ai_config_id=? AND provider=?`)
    .get(ctx.tenantId, ctx.row.id, PROVIDER);
}

async function ensureGroup(db, ctx) {
  const existing = db.prepare(`SELECT * FROM external_asset_groups
    WHERE tenant_id=? AND ai_config_id=? AND provider=?`).get(ctx.tenantId, ctx.row.id, PROVIDER);
  if (existing?.remote_group_id) return existing;
  const name = `RichiDrama素材库-T${ctx.tenantId || 0}`.slice(0, 64);
  const remoteExisting = await findGroupByName(ctx, name);
  if (remoteExisting?.id) return saveGroup(db, ctx, name, remoteExisting.id);
  const result = await request(ctx, '/api/asset-group/create', {
    method: 'POST',
    body: { name, description: 'RichiDrama 用户显式上传的图片、视频和音频素材' },
    writeAttempt: true,
  });
  let created = unwrapGroup(result.payload);
  if (!created?.id) {
    try { created = await findGroupByName(ctx, name); } catch (_) { /* Preserve the ambiguous write result. */ }
  }
  if (!created?.id) {
    throw new RichbestAssetError('Richbest 已接收素材组创建请求，但返回结果缺少素材组 ID，正在等待核对', {
      code: 'group_create_result_unknown',
      ambiguous: true,
      requestId: result.requestId,
    });
  }
  return saveGroup(db, ctx, name, created.id);
}

async function uploadFile(ctx, absolutePath, filename, mimeType) {
  const form = new FormData();
  const buffer = fs.readFileSync(absolutePath);
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  const result = await request(ctx, '/api/asset/upload-file', {
    method: 'POST', body: form, writeAttempt: true, timeoutMs: 120_000,
  });
  const payload = result.payload?.data || result.payload;
  const uploadId = String(pick(payload, ['uploadId', 'upload_id']) || '').trim();
  const url = String(pick(payload, ['url', 'URL']) || '').trim();
  if (!uploadId || !url) {
    throw new RichbestAssetError('Richbest 上传成功响应缺少 uploadId 或 url', { ambiguous: true, requestId: result.requestId });
  }
  return {
    uploadId,
    url,
    objectKey: pick(payload, ['objectKey', 'object_key']),
    assetType: pick(payload, ['assetType', 'asset_type']) || 'Image',
    requestId: result.requestId,
    durationMs: result.durationMs,
  };
}

async function createAsset(ctx, input) {
  const result = await request(ctx, '/api/asset/create', {
    method: 'POST', writeAttempt: true,
    body: { groupId: input.groupId, url: input.url, uploadId: input.uploadId, assetType: input.assetType || 'Image', name: input.name },
  });
  const asset = unwrapAsset(result.payload);
  if (!asset?.id) throw new RichbestAssetError('Richbest 登记响应缺少素材 ID', { ambiguous: true, requestId: result.requestId });
  return { ...asset, requestId: result.requestId, durationMs: result.durationMs };
}

async function getAsset(ctx, assetId) {
  const result = await request(ctx, '/api/asset/get', { query: { assetId } });
  const asset = unwrapAsset(result.payload);
  if (!asset?.id) throw new RichbestAssetError('Richbest 素材查询响应缺少素材 ID', { requestId: result.requestId });
  return { ...asset, requestId: result.requestId, durationMs: result.durationMs };
}

async function findAssetByName(ctx, groupId, name) {
  const result = await request(ctx, '/api/asset/list', {
    query: { groupId, name, pageNumber: 1, pageSize: 20 },
  });
  return extractAssetItems(result.payload).find((item) => String(item.name || '') === String(name)) || null;
}

function sourceFingerprint(row, absolutePath = null) {
  const isGenericAsset = !!(row.type || row.asset_type || row.mime_type || row.checksum);
  const source = isGenericAsset
    ? [row.type || row.asset_type || '', row.local_path || '', row.image_url || row.url || '', row.mime_type || '', row.file_size || '', row.checksum || ''].join('|')
    : `${row.local_path || ''}|${row.image_url || ''}`;
  const hash = crypto.createHash('sha256').update(source);
  if (absolutePath && fs.existsSync(absolutePath)) hash.update(fs.readFileSync(absolutePath));
  return hash.digest('hex');
}

function mimeFor(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  return ({
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.gif': 'image/gif',
    '.heic': 'image/heic', '.heif': 'image/heif',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime',
    '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  })[ext] || 'application/octet-stream';
}

function assetTypeFor(row) {
  return ({ image: 'Image', video: 'Video', audio: 'Audio' })[String(row?.type || '').toLowerCase()] || null;
}

function validateLocalAsset(asset, absolutePath) {
  const ext = path.extname(absolutePath || '').toLowerCase();
  const allowed = {
    image: new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff', '.gif', '.heic', '.heif']),
    video: new Set(['.mp4', '.mov']),
    audio: new Set(['.wav', '.mp3']),
  };
  const type = String(asset?.type || '').toLowerCase();
  if (!allowed[type]?.has(ext)) {
    return { ok: false, error: `${assetTypeFor(asset) || '素材'}格式不受远端素材库支持` };
  }
  const size = Number(asset.file_size || fs.statSync(absolutePath).size || 0);
  const maxBytes = ({ image: 30, video: 200, audio: 15 })[type] * 1024 * 1024;
  if (size > maxBytes) return { ok: false, error: `${assetTypeFor(asset)}文件超过远端素材库大小限制` };
  const duration = Number(asset.duration || 0);
  if ((type === 'video' || type === 'audio') && duration > 0 && (duration < 2 || duration > 30)) {
    return { ok: false, error: `${assetTypeFor(asset)}时长必须为 2 至 30 秒` };
  }
  const width = Number(asset.width || 0);
  const height = Number(asset.height || 0);
  if ((type === 'image' || type === 'video') && width > 0 && height > 0) {
    const ratio = width / height;
    if (width <= 300 || width >= 6000 || height <= 300 || height >= 6000 || ratio <= 0.4 || ratio >= 2.5) {
      return { ok: false, error: `${assetTypeFor(asset)}尺寸或宽高比不符合远端素材库限制` };
    }
  }
  return { ok: true };
}

function bindingPayload(binding, character) {
  const status = normalizeStatus(binding.status);
  return {
    hub_asset_id: binding.remote_asset_id || null,
    asset_url: binding.remote_asset_id ? assetUrlForVideo(binding.remote_asset_id) : null,
    status,
    stage: binding.stage || status,
    sd2_provider: PROVIDER,
    group_id: binding.remote_group_id || null,
    certified_image_url: binding.source_image_url ?? character.image_url ?? null,
    certified_local_path: binding.source_local_path ?? character.local_path ?? null,
    source_fingerprint: binding.source_fingerprint,
    request_id: binding.provider_request_id || null,
    error_code: binding.error_code || null,
    error: binding.error_message || null,
    updated_at: binding.updated_at,
  };
}

function saveProjection(db, log, characterId, binding) {
  const character = db.prepare('SELECT * FROM characters WHERE id=? AND deleted_at IS NULL').get(Number(characterId));
  if (!character) return null;
  const payload = bindingPayload(binding, character);
  db.prepare('UPDATE characters SET seedance2_asset=?, updated_at=? WHERE id=?')
    .run(JSON.stringify(payload), payload.updated_at, Number(characterId));
  require('./assetMappingService').syncEntities(db, log, 'character', [characterId]);
  return payload;
}

function saveAssetProjection(db, assetId, binding) {
  const asset = db.prepare('SELECT * FROM assets WHERE id=? AND deleted_at IS NULL').get(Number(assetId));
  if (!asset) return null;
  const status = normalizeStatus(binding.status);
  const payload = {
    hub_asset_id: binding.remote_asset_id || null,
    asset_url: binding.remote_asset_id ? assetUrlForVideo(binding.remote_asset_id) : null,
    status,
    stage: binding.stage || status,
    sd2_provider: PROVIDER,
    group_id: binding.remote_group_id || null,
    asset_type: binding.asset_type || assetTypeFor(asset),
    source_url: binding.source_image_url ?? asset.url ?? null,
    certified_image_url: binding.source_image_url ?? asset.url ?? null,
    certified_local_path: binding.source_local_path ?? asset.local_path ?? null,
    source_fingerprint: binding.source_fingerprint,
    request_id: binding.provider_request_id || null,
    error_code: binding.error_code || null,
    error: binding.error_message || null,
    updated_at: binding.updated_at,
  };
  db.prepare('UPDATE assets SET seedance2_asset=?, updated_at=? WHERE id=?')
    .run(JSON.stringify(payload), payload.updated_at, Number(assetId));
  return payload;
}

function saveBindingProjection(db, log, binding, resourceId = null) {
  const id = Number(resourceId || binding.resource_id);
  return binding.resource_type === 'asset'
    ? saveAssetProjection(db, id, binding)
    : saveProjection(db, log, id, binding);
}

function updateBinding(db, id, values) {
  const allowed = ['local_asset_id', 'remote_group_id', 'remote_asset_id', 'upload_id', 'object_key', 'status', 'stage', 'error_code', 'error_message', 'provider_request_id', 'upload_duration_ms', 'create_duration_ms', 'settlement_duration_ms', 'payload_json', 'active_at', 'stale_at'];
  const columns = [];
  const params = [];
  for (const key of allowed) if (values[key] !== undefined) { columns.push(`${key}=?`); params.push(values[key]); }
  const now = values.updated_at || new Date().toISOString();
  columns.push('updated_at=?'); params.push(now, Number(id));
  db.prepare(`UPDATE external_asset_bindings SET ${columns.join(',')} WHERE id=?`).run(...params);
  return db.prepare('SELECT * FROM external_asset_bindings WHERE id=?').get(Number(id));
}

function findBinding(db, ctx, characterId, fingerprint) {
  return db.prepare(`SELECT * FROM external_asset_bindings
    WHERE ai_config_id=? AND provider=? AND resource_type='character' AND resource_id=? AND source_fingerprint=?
    ORDER BY attempt_no DESC, id DESC LIMIT 1`)
    .get(ctx.row.id, PROVIDER, Number(characterId), fingerprint);
}

function createBinding(db, ctx, character, localAssetId, fingerprint, sourceName) {
  const now = new Date().toISOString();
  const latest = findBinding(db, ctx, character.id, fingerprint);
  const attemptNo = Number(latest?.attempt_no || 0) + 1;
  const uniqueName = `${sourceName}-a${attemptNo}`.slice(0, 64);
  db.prepare(`INSERT INTO external_asset_bindings
    (tenant_id,owner_user_id,local_asset_id,resource_type,resource_id,ai_config_id,provider,asset_type,source_fingerprint,source_image_url,source_local_path,attempt_no,source_name,status,stage,created_at,updated_at)
    VALUES (?,?,?,'character',?,?,?,'Image',?,?,?,?,?, 'queued','queued',?,?)`)
    .run(ctx.tenantId, character.owner_user_id || null, localAssetId || null, character.id, ctx.row.id, PROVIDER,
      fingerprint, character.image_url || null, character.local_path || null, attemptNo, uniqueName, now, now);
  return findBinding(db, ctx, character.id, fingerprint);
}

function markOtherBindingsStale(db, ctx, characterId, fingerprint) {
  const now = new Date().toISOString();
  db.prepare(`UPDATE external_asset_bindings SET status='stale',stage='stale',stale_at=?,updated_at=?
    WHERE ai_config_id=? AND provider=? AND resource_type='character' AND resource_id=?
      AND source_fingerprint<>? AND status IN ('queued','uploading','registering','processing','reconciling','active')`)
    .run(now, now, ctx.row.id, PROVIDER, Number(characterId), fingerprint);
}

async function refreshBinding(db, log, ctx, binding, characterId) {
  let asset = null;
  if (binding.remote_asset_id) {
    asset = await getAsset(ctx, binding.remote_asset_id);
  } else if (binding.stage === 'reconciling' && binding.remote_group_id && binding.source_name) {
    asset = await findAssetByName(ctx, binding.remote_group_id, binding.source_name);
    if (!asset) {
      const age = Date.now() - Date.parse(binding.updated_at || binding.created_at || 0);
      if (Number.isFinite(age) && age >= 10 * 60 * 1000) {
        binding = updateBinding(db, binding.id, { status: 'failed', stage: 'failed', error_code: 'create_result_unknown', error_message: '远端登记结果在 10 分钟内无法确认，请手动重试' });
      }
      return { ok: true, seedance2_asset: saveBindingProjection(db, log, binding, characterId), pending: binding.status !== 'failed' };
    }
  } else {
    return { ok: false, error: '远端素材尚未取得 ID，请重新上传到素材库' };
  }
  const latest = db.prepare('SELECT * FROM external_asset_bindings WHERE id=?').get(Number(binding.id));
  if (!latest || String(latest.status).toLowerCase() === 'stale') {
    return { ok: true, seedance2_asset: latest ? saveBindingProjection(db, log, latest, characterId) : null, pending: false };
  }
  binding = latest;
  const status = normalizeStatus(asset.status);
  const remoteError = asset.raw?.failureReason || asset.raw?.errorMessage || asset.raw?.message || asset.raw?.Error?.Message;
  binding = updateBinding(db, binding.id, {
    remote_asset_id: asset.id,
    status,
    stage: status === 'processing' ? 'processing' : status,
    provider_request_id: asset.requestId || binding.provider_request_id,
    settlement_duration_ms: asset.durationMs || binding.settlement_duration_ms,
    payload_json: JSON.stringify(asset.raw || {}),
    active_at: status === 'active' ? new Date().toISOString() : binding.active_at,
    error_code: status === 'failed' ? 'provider_asset_failed' : null,
    error_message: status === 'failed' ? String(remoteError || '远端素材处理失败').slice(0, 2000) : null,
  });
  return { ok: true, seedance2_asset: saveBindingProjection(db, log, binding, characterId), pending: PENDING_STATUSES.has(status) };
}

const activePolls = new Set();
function scheduleSettlement(db, log, ctx, binding, characterId) {
  const key = Number(binding.id);
  if (activePolls.has(key)) return;
  activePolls.add(key);
  setImmediate(async () => {
    try {
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const latest = db.prepare('SELECT * FROM external_asset_bindings WHERE id=?').get(key);
        if (!latest || !PENDING_STATUSES.has(normalizeStatus(latest.status))) break;
        const out = await refreshBinding(db, log, ctx, latest, characterId);
        if (!out.pending) break;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    } catch (error) {
      log.warn('Richbest asset background poll failed', { binding_id: key, error: error.message });
    } finally { activePolls.delete(key); }
  });
}

async function registerCharacter(db, log, cfg, characterId, userId, options = {}) {
  const ctx = buildContext(db, userId, options);
  if (!ctx.ready) return { ok: false, fallback_allowed: true, error: ctx.error };
  const character = db.prepare(`SELECT c.*, d.owner_user_id FROM characters c
    JOIN dramas d ON d.id=c.drama_id AND d.deleted_at IS NULL
    WHERE c.id=? AND c.deleted_at IS NULL`).get(Number(characterId));
  if (!character) return { ok: false, error: 'character not found' };
  if (!character.local_path) return { ok: false, fallback_allowed: true, error: '角色主图没有本地持久化文件' };
  const storageRoot = path.isAbsolute(cfg?.storage?.local_path || '')
    ? cfg.storage.local_path : path.join(process.cwd(), cfg?.storage?.local_path || './data/storage');
  const absolutePath = path.resolve(storageRoot, String(character.local_path).replace(/\//g, path.sep));
  const root = path.resolve(storageRoot) + path.sep;
  if (!absolutePath.startsWith(root) || !fs.existsSync(absolutePath)) {
    return { ok: false, fallback_allowed: true, error: '角色主图本地文件不存在或路径无效' };
  }
  const fingerprint = sourceFingerprint(character, absolutePath);
  const short = fingerprint.slice(0, 12);
  const sourceName = `rb-char-${character.id}-${short}`.slice(0, 64);
  const mapped = require('./assetMappingService').syncEntities(db, log, 'character', [character.id])[0] || null;
  if (mapped?.id) {
    db.prepare('UPDATE assets SET requires_sd2_identity=1, updated_at=? WHERE id=?')
      .run(new Date().toISOString(), Number(mapped.id));
  }
  markOtherBindingsStale(db, ctx, character.id, fingerprint);
  let binding = findBinding(db, ctx, character.id, fingerprint);
  if (!binding || ['failed', 'stale'].includes(String(binding.status).toLowerCase())) {
    binding = createBinding(db, ctx, character, mapped?.id, fingerprint, sourceName);
  }
  if (binding.status === 'active') return { ok: true, seedance2_asset: saveProjection(db, log, character.id, binding), reused: true };
  if (binding.remote_asset_id || (binding.stage === 'reconciling' && binding.remote_group_id)) {
    const refreshed = await refreshBinding(db, log, ctx, binding, character.id);
    if (refreshed.ok && refreshed.pending) scheduleSettlement(db, log, ctx, db.prepare('SELECT * FROM external_asset_bindings WHERE id=?').get(binding.id), character.id);
    return refreshed;
  }
  try {
    await verify(ctx);
    const group = await ensureGroup(db, ctx);
    binding = updateBinding(db, binding.id, { remote_group_id: group.remote_group_id, status: 'uploading', stage: 'uploading', error_code: null, error_message: null });
    saveProjection(db, log, character.id, binding);
    const uploaded = await uploadFile(ctx, absolutePath, path.basename(absolutePath), mimeFor(absolutePath));
    binding = updateBinding(db, binding.id, {
      upload_id: uploaded.uploadId,
      object_key: uploaded.objectKey || null,
      provider_request_id: uploaded.requestId,
      upload_duration_ms: uploaded.durationMs,
      payload_json: JSON.stringify({ url: uploaded.url, assetType: uploaded.assetType }),
      status: 'registering', stage: 'registering',
    });
    saveProjection(db, log, character.id, binding);
    let created;
    try {
      created = await createAsset(ctx, { groupId: group.remote_group_id, url: uploaded.url, uploadId: uploaded.uploadId, name: binding.source_name });
    } catch (error) {
      binding = updateBinding(db, binding.id, {
        status: error.ambiguous ? 'reconciling' : 'failed',
        stage: error.ambiguous ? 'reconciling' : 'failed',
        error_code: error.code || (error.ambiguous ? 'create_result_unknown' : 'create_failed'),
        error_message: error.message,
        provider_request_id: error.requestId || binding.provider_request_id,
        create_duration_ms: error.durationMs || null,
      });
      return { ok: error.ambiguous, pending: error.ambiguous, seedance2_asset: saveProjection(db, log, character.id, binding), error: error.ambiguous ? undefined : error.message };
    }
    binding = updateBinding(db, binding.id, {
      remote_asset_id: created.id,
      status: normalizeStatus(created.status),
      stage: normalizeStatus(created.status),
      provider_request_id: created.requestId || binding.provider_request_id,
      create_duration_ms: created.durationMs,
      payload_json: JSON.stringify(created.raw || {}),
      active_at: normalizeStatus(created.status) === 'active' ? new Date().toISOString() : binding.active_at,
    });
    const seedance2Asset = saveProjection(db, log, character.id, binding);
    if (PENDING_STATUSES.has(normalizeStatus(binding.status))) scheduleSettlement(db, log, ctx, binding, character.id);
    return { ok: true, async: binding.status !== 'active', seedance2_asset: seedance2Asset };
  } catch (error) {
    const timings = binding.stage === 'uploading'
      ? { upload_duration_ms: error.durationMs || null }
      : (binding.stage === 'registering' ? { create_duration_ms: error.durationMs || null } : {});
    binding = updateBinding(db, binding.id, {
      status: error.ambiguous ? 'reconciling' : 'failed',
      stage: error.ambiguous ? 'reconciling' : 'failed',
      error_code: error.code || (error.ambiguous ? 'write_result_unknown' : 'preflight_failed'),
      error_message: error.message,
      provider_request_id: error.requestId || null,
      ...timings,
    });
    const projection = saveProjection(db, log, character.id, binding);
    if (error.fallbackAllowed && !binding.upload_id && !binding.remote_asset_id) {
      return { ok: false, fallback_allowed: true, error: error.message };
    }
    if (error.ambiguous) return { ok: true, pending: true, seedance2_asset: projection };
    return { ok: false, error: error.message, seedance2_asset: projection };
  }
}

async function refreshCharacter(db, log, cfg, characterId, userId, options = {}) {
  const ctx = buildContext(db, userId, options);
  if (!ctx.ready) return { ok: false, error: ctx.error };
  const character = db.prepare('SELECT * FROM characters WHERE id=? AND deleted_at IS NULL').get(Number(characterId));
  if (!character) return { ok: false, error: 'character not found' };
  const previous = parseJson(character.seedance2_asset, {});
  let binding = previous?.hub_asset_id
    ? db.prepare(`SELECT * FROM external_asset_bindings WHERE ai_config_id=? AND provider=? AND remote_asset_id=? ORDER BY id DESC LIMIT 1`).get(ctx.row.id, PROVIDER, previous.hub_asset_id)
    : db.prepare(`SELECT * FROM external_asset_bindings WHERE ai_config_id=? AND provider=? AND resource_type='character' AND resource_id=? ORDER BY id DESC LIMIT 1`).get(ctx.row.id, PROVIDER, Number(characterId));
  if (!binding) return { ok: false, error: '未找到角色主图上传记录' };
  const stage = String(binding.stage || binding.status || '').toLowerCase();
  if (stage === 'queued') {
    return registerCharacter(db, log, cfg, characterId, userId, options);
  }
  if (stage === 'reconciling' && !binding.remote_group_id && !binding.upload_id) {
    return registerCharacter(db, log, cfg, characterId, userId, options);
  }
  if (stage === 'uploading' && !binding.upload_id) {
    binding = updateBinding(db, binding.id, {
      status: 'failed',
      stage: 'failed',
      error_code: 'upload_result_unknown',
      error_message: '服务重启前未确认上传结果，请手动重新登记',
    });
    return { ok: true, pending: false, seedance2_asset: saveProjection(db, log, character.id, binding) };
  }
  if (stage === 'registering' && !binding.remote_asset_id) {
    binding = updateBinding(db, binding.id, {
      status: 'reconciling',
      stage: 'reconciling',
      error_code: 'create_result_unknown',
      error_message: '正在核对服务重启前的远端登记结果',
    });
  }
  const result = await refreshBinding(db, log, ctx, binding, character.id);
  binding = db.prepare('SELECT * FROM external_asset_bindings WHERE id=?').get(binding.id);
  if (result.ok && result.pending) scheduleSettlement(db, log, ctx, binding, character.id);
  return result;
}

function findAssetBinding(db, ctx, assetId, fingerprint) {
  return db.prepare(`SELECT * FROM external_asset_bindings
    WHERE ai_config_id=? AND provider=? AND resource_type='asset' AND resource_id=? AND source_fingerprint=?
    ORDER BY attempt_no DESC, id DESC LIMIT 1`)
    .get(ctx.row.id, PROVIDER, Number(assetId), fingerprint);
}

function createAssetBinding(db, ctx, asset, fingerprint, sourceName, assetType) {
  const now = new Date().toISOString();
  const latest = findAssetBinding(db, ctx, asset.id, fingerprint);
  const attemptNo = Number(latest?.attempt_no || 0) + 1;
  const uniqueName = `${sourceName}-a${attemptNo}`.slice(0, 64);
  db.prepare(`INSERT INTO external_asset_bindings
    (tenant_id,owner_user_id,local_asset_id,resource_type,resource_id,ai_config_id,provider,asset_type,source_fingerprint,source_image_url,source_local_path,attempt_no,source_name,status,stage,created_at,updated_at)
    VALUES (?,?,?,'asset',?,?,?,?,?,?,?,?,?,'queued','queued',?,?)`)
    .run(ctx.tenantId, asset.effective_owner_user_id || asset.owner_user_id || null, asset.id, asset.id,
      ctx.row.id, PROVIDER, assetType, fingerprint, asset.url || null, asset.local_path || null,
      attemptNo, uniqueName, now, now);
  return findAssetBinding(db, ctx, asset.id, fingerprint);
}

function markOtherAssetBindingsStale(db, ctx, assetId, fingerprint) {
  const now = new Date().toISOString();
  db.prepare(`UPDATE external_asset_bindings SET status='stale',stage='stale',stale_at=?,updated_at=?
    WHERE ai_config_id=? AND provider=? AND resource_type='asset' AND resource_id=?
      AND source_fingerprint<>? AND status IN ('queued','uploading','registering','processing','reconciling','active')`)
    .run(now, now, ctx.row.id, PROVIDER, Number(assetId), fingerprint);
}

function loadLocalAsset(db, assetId) {
  return db.prepare(`SELECT a.*, COALESCE(a.owner_user_id,d.owner_user_id) AS effective_owner_user_id
    FROM assets a LEFT JOIN dramas d ON d.id=a.drama_id AND d.deleted_at IS NULL
    WHERE a.id=? AND a.deleted_at IS NULL`).get(Number(assetId));
}

function localAssetPath(cfg, asset) {
  if (!asset?.local_path) return { ok: false, error: '素材没有本地持久化文件' };
  const storageRoot = path.isAbsolute(cfg?.storage?.local_path || '')
    ? cfg.storage.local_path : path.join(process.cwd(), cfg?.storage?.local_path || './data/storage');
  const absolutePath = path.resolve(storageRoot, String(asset.local_path).replace(/\//g, path.sep));
  const root = path.resolve(storageRoot) + path.sep;
  if (!absolutePath.startsWith(root) || !fs.existsSync(absolutePath)) {
    return { ok: false, error: '素材本地文件不存在或路径无效' };
  }
  return { ok: true, absolutePath };
}

async function registerAsset(db, log, cfg, assetId, userId, options = {}) {
  const ctx = buildContext(db, userId, options);
  if (!ctx.ready) return { ok: false, fallback_allowed: true, error: ctx.error };
  const asset = loadLocalAsset(db, assetId);
  if (!asset) return { ok: false, error: '素材不存在' };
  const assetType = assetTypeFor(asset);
  if (!assetType) return { ok: false, fallback_allowed: true, error: '仅支持图片、视频和音频素材' };
  const local = localAssetPath(cfg, asset);
  if (!local.ok) return { ok: false, fallback_allowed: true, error: local.error };
  const specification = validateLocalAsset(asset, local.absolutePath);
  if (!specification.ok) return specification;

  const fingerprint = sourceFingerprint(asset, local.absolutePath);
  const sourceName = `rb-asset-${asset.id}-${fingerprint.slice(0, 12)}`.slice(0, 64);
  markOtherAssetBindingsStale(db, ctx, asset.id, fingerprint);
  let binding = findAssetBinding(db, ctx, asset.id, fingerprint);
  if (!binding || ['failed', 'stale'].includes(String(binding.status).toLowerCase())) {
    binding = createAssetBinding(db, ctx, asset, fingerprint, sourceName, assetType);
  }
  if (binding.status === 'active') {
    return { ok: true, seedance2_asset: saveAssetProjection(db, asset.id, binding), reused: true };
  }
  if (binding.remote_asset_id || (binding.stage === 'reconciling' && binding.remote_group_id)) {
    const refreshed = await refreshBinding(db, log, ctx, binding, asset.id);
    if (refreshed.ok && refreshed.pending) {
      scheduleSettlement(db, log, ctx, db.prepare('SELECT * FROM external_asset_bindings WHERE id=?').get(binding.id), asset.id);
    }
    return refreshed;
  }

  try {
    await verify(ctx);
    const group = await ensureGroup(db, ctx);
    binding = updateBinding(db, binding.id, { remote_group_id: group.remote_group_id, status: 'uploading', stage: 'uploading', error_code: null, error_message: null });
    saveAssetProjection(db, asset.id, binding);
    const uploaded = await uploadFile(ctx, local.absolutePath, path.basename(local.absolutePath), asset.mime_type || mimeFor(local.absolutePath));
    binding = updateBinding(db, binding.id, {
      upload_id: uploaded.uploadId,
      object_key: uploaded.objectKey || null,
      provider_request_id: uploaded.requestId,
      upload_duration_ms: uploaded.durationMs,
      payload_json: JSON.stringify({ url: uploaded.url, assetType: uploaded.assetType || assetType }),
      status: 'registering', stage: 'registering',
    });
    saveAssetProjection(db, asset.id, binding);
    let created;
    try {
      created = await createAsset(ctx, {
        groupId: group.remote_group_id,
        url: uploaded.url,
        uploadId: uploaded.uploadId,
        assetType: uploaded.assetType || assetType,
        name: binding.source_name,
      });
    } catch (error) {
      binding = updateBinding(db, binding.id, {
        status: error.ambiguous ? 'reconciling' : 'failed',
        stage: error.ambiguous ? 'reconciling' : 'failed',
        error_code: error.code || (error.ambiguous ? 'create_result_unknown' : 'create_failed'),
        error_message: error.message,
        provider_request_id: error.requestId || binding.provider_request_id,
        create_duration_ms: error.durationMs || null,
      });
      return { ok: error.ambiguous, pending: error.ambiguous, seedance2_asset: saveAssetProjection(db, asset.id, binding), error: error.ambiguous ? undefined : error.message };
    }
    binding = updateBinding(db, binding.id, {
      remote_asset_id: created.id,
      status: normalizeStatus(created.status),
      stage: normalizeStatus(created.status),
      provider_request_id: created.requestId || binding.provider_request_id,
      create_duration_ms: created.durationMs,
      payload_json: JSON.stringify(created.raw || {}),
      active_at: normalizeStatus(created.status) === 'active' ? new Date().toISOString() : binding.active_at,
    });
    const projection = saveAssetProjection(db, asset.id, binding);
    if (PENDING_STATUSES.has(normalizeStatus(binding.status))) scheduleSettlement(db, log, ctx, binding, asset.id);
    return { ok: true, async: binding.status !== 'active', seedance2_asset: projection };
  } catch (error) {
    const timings = binding.stage === 'uploading'
      ? { upload_duration_ms: error.durationMs || null }
      : (binding.stage === 'registering' ? { create_duration_ms: error.durationMs || null } : {});
    binding = updateBinding(db, binding.id, {
      status: error.ambiguous ? 'reconciling' : 'failed',
      stage: error.ambiguous ? 'reconciling' : 'failed',
      error_code: error.code || (error.ambiguous ? 'write_result_unknown' : 'preflight_failed'),
      error_message: error.message,
      provider_request_id: error.requestId || null,
      ...timings,
    });
    const projection = saveAssetProjection(db, asset.id, binding);
    if (error.fallbackAllowed && !binding.upload_id && !binding.remote_asset_id) {
      return { ok: false, fallback_allowed: true, error: error.message };
    }
    if (error.ambiguous) return { ok: true, pending: true, seedance2_asset: projection };
    return { ok: false, error: error.message, seedance2_asset: projection };
  }
}

async function refreshAsset(db, log, cfg, assetId, userId, options = {}) {
  const ctx = buildContext(db, userId, options);
  if (!ctx.ready) return { ok: false, error: ctx.error };
  const asset = loadLocalAsset(db, assetId);
  if (!asset) return { ok: false, error: '素材不存在' };
  const previous = parseJson(asset.seedance2_asset, {});
  let binding = previous?.hub_asset_id
    ? db.prepare(`SELECT * FROM external_asset_bindings WHERE ai_config_id=? AND provider=? AND remote_asset_id=? ORDER BY id DESC LIMIT 1`).get(ctx.row.id, PROVIDER, previous.hub_asset_id)
    : db.prepare(`SELECT * FROM external_asset_bindings WHERE ai_config_id=? AND provider=? AND resource_type='asset' AND resource_id=? ORDER BY id DESC LIMIT 1`).get(ctx.row.id, PROVIDER, Number(assetId));
  if (!binding) return { ok: false, error: '未找到素材库上传记录' };
  const stage = String(binding.stage || binding.status || '').toLowerCase();
  if (stage === 'queued') return registerAsset(db, log, cfg, assetId, userId, options);
  if (stage === 'reconciling' && !binding.remote_group_id && !binding.upload_id) {
    return registerAsset(db, log, cfg, assetId, userId, options);
  }
  if (stage === 'uploading' && !binding.upload_id) {
    binding = updateBinding(db, binding.id, {
      status: 'failed', stage: 'failed', error_code: 'upload_result_unknown',
      error_message: '服务重启前未确认上传结果，请手动重新上传',
    });
    return { ok: true, pending: false, seedance2_asset: saveAssetProjection(db, asset.id, binding) };
  }
  if (stage === 'registering' && !binding.remote_asset_id) {
    binding = updateBinding(db, binding.id, {
      status: 'reconciling', stage: 'reconciling', error_code: 'create_result_unknown',
      error_message: '正在核对服务重启前的远端登记结果',
    });
  }
  const result = await refreshBinding(db, log, ctx, binding, asset.id);
  binding = db.prepare('SELECT * FROM external_asset_bindings WHERE id=?').get(binding.id);
  if (result.ok && result.pending) scheduleSettlement(db, log, ctx, binding, asset.id);
  return result;
}

function prepareRebind(db, log, bindingId, reason) {
  const binding = db.prepare('SELECT * FROM external_asset_bindings WHERE id=? AND provider=?')
    .get(Number(bindingId), PROVIDER);
  if (!binding) throw new Error('Richbest 素材绑定不存在');
  const status = String(binding.status || '').toLowerCase();
  if (status === 'active') {
    const now = new Date().toISOString();
    const stale = updateBinding(db, binding.id, {
      status: 'stale',
      stage: 'stale',
      stale_at: now,
      error_code: 'admin_rebind_requested',
      error_message: String(reason || '管理员要求重新绑定').slice(0, 2000),
    });
    saveBindingProjection(db, log, stale);
    return stale;
  }
  if (status === 'stale' && binding.error_code === 'admin_rebind_requested') return binding;
  throw new Error(`绑定状态 ${binding.status || 'unknown'} 不能强制重绑`);
}

module.exports = {
  PROVIDER,
  PENDING_STATUSES,
  RichbestAssetError,
  normalizeStatus,
  assetUrlForVideo,
  unwrapAsset,
  extractAssetItems,
  buildContext,
  verify,
  ensureGroup,
  uploadFile,
  createAsset,
  getAsset,
  findAssetByName,
  registerCharacter,
  refreshCharacter,
  registerAsset,
  refreshAsset,
  refreshBinding,
  bindingPayload,
  assetTypeFor,
  mimeFor,
  validateLocalAsset,
  prepareRebind,
};
