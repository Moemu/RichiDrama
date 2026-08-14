'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_BASE_URL = 'https://mediakit.cn-beijing.volces.com';

function config(db) {
  const row = require('./aiConfigService').listConfigs(db, 'video_postprocess').find((item) => item.is_active);
  if (!row) throw new Error('未配置火山 AI MediaKit 视频插帧');
  let settings = {};
  try { settings = JSON.parse(row.settings || '{}'); } catch (_) {}
  return { ...row, settings, base_url: String(row.base_url || DEFAULT_BASE_URL).replace(/\/$/, '') };
}

async function jsonRequest(url, apiKey, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${apiKey}`, ...(options.headers || {}) },
  });
  let data = null;
  try { data = await response.json(); } catch (_) {}
  if (!response.ok || data?.success === false) {
    throw new Error(data?.error?.message || `AI MediaKit 请求失败（HTTP ${response.status}）`);
  }
  return data || {};
}

async function uploadLocalVideo(db, absolutePath) {
  const cfg = config(db);
  const requested = await jsonRequest(`${cfg.base_url}/api/v1/tools-sync/request-media-upload-url`, cfg.api_key, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  const result = requested.result || {};
  if (!result.upload_url || !result.file_id) throw new Error('AI MediaKit 未返回上传地址或 file_id');
  const headers = {};
  for (const item of result.upload_headers || []) if (item?.key) headers[item.key] = item.value || '';
  if (!headers['Content-Type']) headers['Content-Type'] = path.extname(absolutePath).toLowerCase() === '.mov' ? 'video/quicktime' : 'video/mp4';
  const uploaded = await fetch(result.upload_url, { method: result.method || 'PUT', headers, body: fs.createReadStream(absolutePath), duplex: 'half' });
  if (!uploaded.ok) throw new Error(`AI MediaKit 本地视频上传失败（HTTP ${uploaded.status}）`);
  return { file_id: result.file_id, request_id: requested.request_id || null };
}

async function submit(db, input) {
  const cfg = config(db);
  const body = {
    video_url: input.video_url,
    fps: Number(input.fps || cfg.settings.target_fps || 60),
    // AI MediaKit calls this field client_token. It is the supplier-side
    // idempotency token and must be printable ASCII with at most 64 bytes.
    client_token: String(input.client_token || '').slice(0, 64),
    callback_args: input.callback_args || undefined,
    queue_id: cfg.settings.queue_id || undefined,
  };
  const data = await jsonRequest(`${cfg.base_url}/api/v1/tools/video-frame-interpolation`, cfg.api_key, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!data.task_id) throw new Error('AI MediaKit 插帧未返回 task_id');
  return { task_id: data.task_id, request_id: data.request_id || null };
}

async function retrieve(db, taskId) {
  const cfg = config(db);
  return jsonRequest(`${cfg.base_url}/api/v1/tasks/${encodeURIComponent(taskId)}`, cfg.api_key);
}

module.exports = { config, uploadLocalVideo, submit, retrieve, jsonRequest };
