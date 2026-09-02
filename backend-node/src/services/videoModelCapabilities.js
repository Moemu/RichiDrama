const aiConfigService = require('./aiConfigService');

const DEFAULT_CAPABILITIES = {
  text_to_video: true,
  image_reference: { max: 9 },
  first_last_frame: true,
  video_reference: false,
  video_extend: false,
  audio_reference: false,
  audio_driven: false,
  output_audio: false,
};

const DEFAULT_LIMITS = {
  duration: { min: 4, max: 15, step: 1 },
  resolutions: ['480p', '720p', '1080p'],
};

function parseSettings(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (_) { return {}; }
}

function list(db, options = {}) {
  // A config can declare several models while choosing one default.  Expose
  // every declared model to creators so selecting a cheaper/safer SKU does
  // not silently collapse back to the default model.
  return aiConfigService.listConfigs(db, 'video', options).filter((item) => item.is_active).flatMap((item) => {
    const settings = parseSettings(item.settings);
    const declared = settings.video_capabilities || settings.capabilities || {};
    const models = [...new Set([
      ...(Array.isArray(item.model) ? item.model : item.model ? [item.model] : []),
      item.default_model,
    ].map((model) => String(model || '').trim()).filter(Boolean))];
    return (models.length ? models : [item.name || `video-${item.id}`]).map((model) => ({
      config_id: item.id,
      model,
      provider: item.provider || '',
      supports: normalizeSupports(item, declared.supports || declared, model),
      limits: modelLimits(settings, declared, model),
      is_default: !!item.is_default && model === item.default_model,
      priority: item.priority || 0,
    }));
  });
}

// A provider setting is only a declaration; native routing needs a matching
// request adapter. Keep unsupported modes on their explicit fallback paths.
function seedance25Limits(model) {
  return /seedance[-_]?2[-_]?5|2[-_]?5[-_]?260628/i.test(String(model || ''))
    ? { duration: { min: 4, max: 30, step: 1 }, image_reference: { max: 30 }, video_reference: { max: 10 }, audio_reference: { max: 10 }, total_reference: { max: 50 }, resolutions: ['480p', '720p'] }
    : {};
}

function seedance20FastLimits(model) {
  return /seedance[-_]?2[-_]?0[-_]?fast|2[-_]?0[-_]?fast[-_]?260128/i.test(String(model || ''))
    ? { duration: { min: 4, max: 15, step: 1 }, resolutions: ['480p', '720p'] }
    : {};
}

function configuredModelLimits(settings, model) {
  const entries = settings?.video_capabilities?.models || settings?.video_model_limits;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return {};
  const requested = String(model || '').trim().toLowerCase();
  const matched = Object.entries(entries).find(([name]) => String(name).trim().toLowerCase() === requested);
  if (!matched || !matched[1] || typeof matched[1] !== 'object' || Array.isArray(matched[1])) return {};
  const configured = matched[1].limits || matched[1];
  return configured && typeof configured === 'object' && !Array.isArray(configured) ? configured : {};
}

function modelLimits(settings, declared, model) {
  const shared = declared.limits || settings.video_limits || {};
  return {
    ...DEFAULT_LIMITS,
    ...shared,
    ...seedance25Limits(model),
    ...seedance20FastLimits(model),
    ...configuredModelLimits(settings, model),
  };
}

function validateResolution(capability, requestedResolution) {
  const requested = String(requestedResolution || '').trim().toLowerCase();
  const allowed = Array.isArray(capability?.limits?.resolutions)
    ? capability.limits.resolutions.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
    : [];
  if (!requested || !allowed.length || allowed.includes(requested)) return requested || null;
  const choices = allowed.join('、');
  const upscaleHint = requested === '1080p' && allowed.includes('720p')
    ? '需要 1080p 成片时，请选择 720p 原片并启用 AI 超分至 1080p。'
    : '';
  throw new Error(`模型 ${capability?.model || '当前模型'} 不支持 ${requested} 原片，可选分辨率：${choices}。${upscaleHint}`);
}

function normalizeSupports(config, declared = {}, selectedModel = '') {
  const supports = { ...DEFAULT_CAPABILITIES, ...declared };
  const protocol = String(config.api_protocol || '').toLowerCase();
  const provider = String(config.provider || '').toLowerCase();
  const model = String(selectedModel || config.default_model || config.model || '').toLowerCase();
  const hasNativeAudioReference = protocol === 'volcengine_omni'
    || protocol === 'kling_omni'
    || ((!protocol || protocol === 'volcengine') && /seedance|doubao-seedance/.test(model));
  const usesModelArkContentsAdapter = protocol === 'volcengine_omni'
    || (!protocol && ['volces', 'volcengine', 'volc'].includes(provider));
  const isSeedanceFullModal = /seedance[-_]?2|seedance2|(^|[-_./])sd2($|[-_./])/.test(model);

  const seedance25 = seedance25Limits(model);
  if (seedance25.image_reference) supports.image_reference = { ...supports.image_reference, ...seedance25.image_reference };
  supports.audio_reference = hasNativeAudioReference && declared.audio_reference !== false;
  // The ModelArk contents adapter serializes reference_video parts for
  // Seedance 2.x. Other protocols stay on the explicit keyframe fallback.
  supports.video_reference = usesModelArkContentsAdapter && isSeedanceFullModal && declared.video_reference !== false;
  supports.video_extend = false;
  supports.audio_driven = false;
  return supports;
}

function resolve(db, requestedModel, assets, options = {}) {
  const entries = list(db, options);
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

module.exports = {
  DEFAULT_CAPABILITIES,
  DEFAULT_LIMITS,
  list,
  resolve,
  supportsAssets,
  normalizeSupports,
  seedance25Limits,
  seedance20FastLimits,
  configuredModelLimits,
  modelLimits,
  validateResolution,
};
