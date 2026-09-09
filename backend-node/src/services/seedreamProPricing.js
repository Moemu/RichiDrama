'use strict';

const VERSION = 'seedream-pro-v1';
const PIXEL_THRESHOLD = 2610000;

function enabled(conditions) { return conditions?.image_pricing_version === VERSION; }
function billableQuantity(conditions, quantity) {
  return Math.max(0, quantity - (enabled(conditions) ? conditions.free_units || 0 : 0));
}

function pixelBand(size) {
  const value = String(size || '').trim().toLowerCase();
  const match = /^(\d+)\s*[x×]\s*(\d+)$/.exec(value);
  if (match) {
    const pixels = Number(match[1]) * Number(match[2]);
    if (!Number.isSafeInteger(pixels) || pixels <= 0) throw new Error('图片尺寸必须为正整数像素');
    return pixels <= PIXEL_THRESHOLD ? 'small' : 'large';
  }
  if (['1k', '1.5k'].includes(value)) return 'small';
  if (['2k', '4k'].includes(value)) return 'large';
  throw new Error('Seedream Pro 计费需要明确的图片尺寸');
}

function referenceCount(input = {}) {
  const refs = input.reference_image_urls ?? input.reference_images ?? input.image_url ?? [];
  return (Array.isArray(refs) ? refs : [refs]).filter(value => typeof value === 'string' && value.trim()).length;
}

function context(input = {}) {
  return {
    has_image_input: referenceCount(input) > 0,
    input_image_count: referenceCount(input),
    pixel_band: input.size ? pixelBand(input.size) : 'large',
    image_scene: input.layer_decomposition === true ? 'layer' : 'single',
  };
}

function validate(conditions, meter) {
  if (!enabled(conditions)) return;
  if (meter === 'input_image') {
    if (conditions.free_units !== 1 || Number(conditions.unit_size) !== 1) throw new Error('Seedream Pro 输入图必须按张计费，且每次请求首张免费');
  } else if (meter === 'image') {
    const rates = conditions.rates || [];
    if (conditions.free_units || Number(conditions.unit_size) !== 1) throw new Error('Seedream Pro 输出图必须按张计费');
    if (rates.length !== 4 || ['single', 'layer'].some(scene => ['small', 'large'].some(band =>
      rates.filter(rate => rate.when?.image_scene === scene && rate.when?.pixel_band === band && Number(rate.unit_size) === 1).length !== 1))) {
      throw new Error('Seedream Pro 输出图需要完整的单图、图层及两个像素档位价格');
    }
  } else throw new Error('Seedream Pro 价格只能使用 image 或 input_image');
}

function validateItems(items) {
  for (const item of items) {
    const conditions = typeof item.conditions_json === 'string' ? JSON.parse(item.conditions_json) : item.conditions_json;
    if (!enabled(conditions)) continue;
    validate(conditions, item.meter);
    const companion = items.find(other => other.service_type === item.service_type && other.model === item.model && other.meter === (item.meter === 'image' ? 'input_image' : 'image'));
    const otherConditions = typeof companion?.conditions_json === 'string' ? JSON.parse(companion.conditions_json) : companion?.conditions_json;
    if (!enabled(otherConditions)) throw new Error('Seedream Pro 输入图和输出图价目必须成对发布');
  }
}

module.exports = { VERSION, PIXEL_THRESHOLD, enabled, billableQuantity, pixelBand, referenceCount, context, validate, validateItems };
