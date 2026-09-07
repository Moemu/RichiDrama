const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getFfprobePath } = require('../utils/ffmpegPath');
const { parseFps } = require('./videoMediaProbeService');

// https://docs.volcengine.com/docs/82379/1520757 — checked 2026-09-07.
// The documented minimum is 2 s; provider errors mentioning 1.8 s are not the contract.
const MB = 1024 * 1024;
const VERSION = 1;
function rulesForModel(model) {
  const name = String(model || '');
  if (/seedance[-_.]?2[-_.]?5/i.test(name)) return { image: 30, video: 10, audio: 10, seconds: 30, audioOnly: true };
  if (/seedance[-_.]?2[-_.]?0|(^|[-_./])sd2($|[-_./])/i.test(name)) return { image: 9, video: 3, audio: 3, seconds: 15, audioOnly: false };
  return null;
}

function invalid(asset, message) {
  const label = asset.name || asset.alias || `素材 ${asset.id || ''}`;
  throw new Error(`素材“${label}”${asset.id ? `（ID: ${asset.id}）` : ''}：${message}`);
}

function metadata(asset) {
  if (asset.metadata && typeof asset.metadata === 'object') return asset.metadata;
  try { return JSON.parse(asset.metadata_json || '{}'); } catch (_) { return {}; }
}

function localFile(asset, root) {
  let key = asset.local_path || '';
  if (!key && String(asset.url || '').startsWith('/static/')) key = asset.url.slice(8);
  if (!key || !root) return null;
  const target = path.resolve(root, key);
  const relative = path.relative(path.resolve(root), target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (!fs.existsSync(target)) return null;
  const real = fs.realpathSync(target);
  const realRelative = path.relative(fs.realpathSync(root), real);
  return realRelative && !realRelative.startsWith('..') && !path.isAbsolute(realRelative) ? real : null;
}

function describeAsset(asset, root) {
  const meta = metadata(asset);
  let source = asset.local_path || asset.url || '';
  if (/^https?:/i.test(source)) { try { source = new URL(source).pathname; } catch (_) {} }
  const extension = path.extname(source).slice(1).toLowerCase();
  const result = {
    ...asset, format: extension || meta.format,
    duration: Number(asset.duration ?? meta.duration), width: Number(asset.width), height: Number(asset.height),
    file_size: Number(asset.file_size), codec: meta.codec, fps: parseFps(meta.frame_rate),
    audio_codecs: meta.audio_codecs,
  };
  const filename = localFile(asset, root);
  if (filename) result.file_size = fs.statSync(filename).size;
  const missing = !result.file_size || !result.format
    || (asset.type !== 'audio' && (!result.width || !result.height))
    || (asset.type !== 'image' && !result.duration)
    || (asset.type === 'video' && (!result.codec || !result.fps || !Array.isArray(result.audio_codecs)));
  if (missing && filename) {
    const probe = spawnSync(getFfprobePath(), ['-v', 'error', '-protocol_whitelist', 'file,pipe',
      '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate', '-of', 'json', filename],
    { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true });
    if (probe.status !== 0) invalid(asset, '无法读取媒体规格，请重新上传素材后再提交');
    let payload;
    try { payload = JSON.parse(probe.stdout); } catch (_) { invalid(asset, '媒体规格读取失败，请重新上传'); }
    const streams = payload.streams || [];
    const stream = streams.find((item) => item.codec_type === (asset.type === 'audio' ? 'audio' : 'video'));
    if (!stream) invalid(asset, '文件内容与素材类型不符');
    Object.assign(result, {
      width: stream.width, height: stream.height, duration: Number(payload.format?.duration),
      codec: stream.codec_name, fps: parseFps(stream.avg_frame_rate),
      audio_codecs: streams.filter((item) => item.codec_type === 'audio').map((item) => item.codec_name),
    });
  }
  return result;
}

function validateAssets(model, assets, mode = 'multi_reference', root = null) {
  const rules = rulesForModel(model);
  if (!rules) return;
  const sent = assets.filter((asset) => asset.send_to_model !== false);
  for (const type of ['image', 'video', 'audio']) {
    const count = sent.filter((asset) => asset.type === type).length;
    if (count > rules[type]) throw new Error(`模型 ${model} 最多支持 ${rules[type]} 个${{ image: '图片', video: '视频', audio: '音频' }[type]}参考素材，当前为 ${count} 个`);
  }
  if (mode === 'first_last_frame' && sent.some((asset) => asset.type !== 'image' || !['first_frame', 'last_frame'].includes(asset.usage))) {
    throw new Error('Seedance 首尾帧模式不能混用参考图片、视频或音频');
  }
  if (!rules.audioOnly && sent.some((asset) => asset.type === 'audio') && !sent.some((asset) => ['image', 'video'].includes(asset.type))) {
    throw new Error('Seedance 2.0 参考音频必须搭配至少一张参考图片或一个参考视频');
  }
  const totals = { audio: 0, video: 0 };
  const inspected = [];
  for (const asset of sent) {
    const info = describeAsset(asset, root);
    inspected.push(info);
    const formats = { image: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'gif', 'heic', 'heif'], video: ['mp4', 'mov'], audio: ['wav', 'mp3'] };
    if (!formats[asset.type]) invalid(asset, '不支持此素材类型');
    if (!formats[asset.type].includes(info.format)) invalid(asset, `格式 ${info.format || '未知'} 不受支持，可用格式：${formats[asset.type].join('、')}`);
    const maxSize = { image: 30, video: 200, audio: 15 }[asset.type];
    if (!(info.file_size > 0) || !Number.isFinite(info.file_size)) invalid(asset, '缺少有效文件大小，请先导入素材库或重新上传');
    if (asset.type === 'image' ? info.file_size >= maxSize * MB : info.file_size > maxSize * MB) invalid(asset, `文件大小 ${(info.file_size / MB).toFixed(2)} MB，要求${asset.type === 'image' ? '小于' : '不超过'} ${maxSize} MB`);
    if (asset.type !== 'image') {
      if (!Number.isFinite(info.duration) || info.duration <= 0) invalid(asset, '缺少有效时长，请先导入素材库或重新上传');
      if (info.duration < 2 || info.duration > rules.seconds) invalid(asset, `时长 ${info.duration} 秒，模型要求 2–${rules.seconds} 秒，请更换或裁剪素材`);
      totals[asset.type] += info.duration;
    }
    if (asset.type !== 'audio') {
      if (![info.width, info.height].every((value) => Number.isInteger(value) && value >= 300 && value <= 6000)) invalid(asset, `尺寸 ${info.width || '?'}×${info.height || '?'}，宽和高均须在 300–6000 像素内`);
      const ratio = info.width / info.height;
      if (ratio < 0.4 || ratio > 2.5) invalid(asset, `宽高比 ${ratio.toFixed(3)}，要求 0.4–2.5`);
    }
    if (asset.type === 'video') {
      const pixels = info.width * info.height;
      if (pixels < 407696 || pixels > 8295044) invalid(asset, `总像素 ${pixels}，要求 407696–8295044`);
      if (!Number.isFinite(info.fps) || info.fps < 24 || info.fps > 60) invalid(asset, `帧率 ${info.fps || '未知'}，要求 24–60 FPS`);
      if (!['h264', 'hevc'].includes(info.codec)) invalid(asset, `视频编码 ${info.codec || '未知'}，仅支持 H.264 或 H.265`);
      if (!Array.isArray(info.audio_codecs)) invalid(asset, '缺少视频内音轨编码信息，请重新上传素材');
      if (info.audio_codecs.some((codec) => !['aac', 'mp3'].includes(codec) && !(info.format === 'mov' && /^pcm_/.test(codec)))) invalid(asset, '视频内音轨仅支持 AAC、MP3；MOV 另支持 PCM');
    }
  }
  for (const type of ['audio', 'video']) {
    if (totals[type] > rules.seconds + 1e-9) throw new Error(`参考${type === 'audio' ? '音频' : '视频'}总时长 ${totals[type]} 秒，模型 ${model} 最多允许 ${rules.seconds} 秒`);
  }
  return inspected;
}

function assertRequestSize(body) {
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 64 * MB) throw new Error('Seedance 请求体超过 64 MB，请减少参考素材或使用已同步的素材 URL');
}

function resolveReference(db, asset, ownerId) {
  if (asset.id) return asset;
  const url = String(asset.url || asset.local_path || '');
  let key = asset.local_path || '';
  if (!key && url.startsWith('/static/')) key = decodeURIComponent(url.slice(8));
  if (!key && /^https?:/i.test(url)) {
    const pathname = new URL(url).pathname;
    if (pathname.startsWith('/static/')) key = decodeURIComponent(pathname.slice(8));
  }
  const row = db.prepare(`SELECT a.* FROM assets a LEFT JOIN dramas d ON d.id=a.drama_id
    WHERE a.deleted_at IS NULL AND COALESCE(d.owner_user_id,a.owner_user_id)=?
      AND (a.url=? OR (?<>'' AND a.local_path=?)) LIMIT 1`).get(ownerId, url, key, key);
  return row ? { ...row, model_url: asset.model_url, alias: asset.alias, usage: asset.usage, send_to_model: asset.send_to_model }
    : { ...asset, local_path: key || asset.local_path };
}

function validateSubmission(db, capability, assets, body) {
  if (!rulesForModel(capability.model)) return null;
  const cfg = require('../config').loadConfig();
  const root = path.resolve(cfg.storage?.local_path || './data/storage');
  const sent = assets.filter((asset) => asset.send_to_model !== false).map((asset) => resolveReference(db, asset, body.owner_user_id));
  const automaticVoice = sent.some((asset) => asset.type === 'audio') ? null
    : require('./videoClient').selectCharacterVoiceReference(db, body.drama_id, body.storyboard_id);
  if (automaticVoice) sent.push(resolveReference(db, { type: 'audio', url: automaticVoice, alias: '角色音色参考', send_to_model: true }, body.owner_user_id));
  const inspected = validateAssets(capability.model, sent, body.creation_mode || 'multi_reference', root);
  // Bound inline payloads before billing; the adapter also checks its exact final JSON.
  let bytes = Buffer.byteLength(JSON.stringify(String(body.prompt || '')), 'utf8') + 4096;
  for (const asset of inspected) {
    const url = String(asset.model_url || asset.url || asset.local_path || '');
    const inline = asset.type !== 'video' && (!/^https?:\/\//i.test(url) || /localhost|127\.0\.0\.1|\[::1\]/i.test(url)) && !url.startsWith('asset://');
    bytes += inline ? Math.ceil(asset.file_size / 3) * 4 + 128 : Buffer.byteLength(JSON.stringify(url), 'utf8') + 128;
  }
  if (bytes > 64 * MB) throw new Error('Seedance 请求体预计超过 64 MB，请减少参考素材或使用已同步的素材 URL');
  return { version: VERSION, automatic_voice_url: automaticVoice || null };
}

function legacyAssets(body) {
  const first = body.first_frame_url || body.first_frame_local_path;
  const last = body.last_frame_url || body.last_frame_local_path;
  const refs = Array.isArray(body.reference_image_urls) ? body.reference_image_urls : [];
  if ((first || last) && refs.length) throw new Error('Seedance 首尾帧模式不能混用参考图片');
  if (last && !first) throw new Error('Seedance 尾帧必须搭配首帧');
  const inputs = first ? [{ url: first, usage: 'first_frame' }, ...(last ? [{ url: last, usage: 'last_frame' }] : [])]
    : [...new Set([body.image_url, ...refs].filter(Boolean))].map((url) => ({ url, usage: 'reference' }));
  return inputs.map((input, index) => ({ ...input, type: 'image', alias: `参考图 ${index + 1}`, send_to_model: true }));
}

module.exports = { VERSION, rulesForModel, validateAssets, describeAsset, assertRequestSize, validateSubmission, legacyAssets };
