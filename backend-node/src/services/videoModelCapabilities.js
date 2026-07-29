const aiConfigService = require('./aiConfigService');

const DEFAULT_CAPABILITIES = {
  text_to_video: true,
  image_reference: { max: 9 },
  first_last_frame: true,
  video_reference: false,
  video_extend: false,
  audio_reference: true,
  audio_driven: false,
  output_audio: false,
};

function parseSettings(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (_) { return {}; }
}

function list(db) {
  return aiConfigService.listConfigs(db, 'video').filter((item) => item.is_active).map((item) => {
    const settings = parseSettings(item.settings);
    const declared = settings.video_capabilities || settings.capabilities || {};
    return {
      config_id: item.id,
      model: item.default_model || (Array.isArray(item.model) ? item.model[0] : item.model) || item.name || `video-${item.id}`,
      provider: item.provider || '',
      supports: { ...DEFAULT_CAPABILITIES, ...(declared.supports || declared) },
      limits: declared.limits || settings.video_limits || {},
      is_default: !!item.is_default,
      priority: item.priority || 0,
    };
  });
}

function resolve(db, requestedModel, assets) {
  const entries = list(db);
  const requested = String(requestedModel || '').trim();
  const ranked = [...entries].sort((a, b) => Number(b.is_default) - Number(a.is_default) || b.priority - a.priority);
  const candidate = requested && requested !== 'auto'
    ? ranked.find((entry) => entry.model === requested) || ranked[0]
    : ranked.find((entry) => supportsAssets(entry.supports, assets)) || ranked[0];
  if (!candidate) return { model: requested || null, supports: DEFAULT_CAPABILITIES, limits: {}, reason: '尚未配置视频模型' };
  return { ...candidate, reason: requested && requested !== 'auto' ? '手动选择模型' : '按素材能力自动匹配' };
}

function supportsAssets(supports, assets = []) {
  return assets.every((asset) => {
    if (asset.type === 'image') return Number(supports.image_reference?.max || 0) > 0;
    if (asset.type === 'audio') return !asset.send_to_model || !!supports.audio_reference;
    if (asset.type === 'video') return !asset.send_to_model || !!supports.video_reference;
    return true;
  });
}

module.exports = { DEFAULT_CAPABILITIES, list, resolve, supportsAssets };
