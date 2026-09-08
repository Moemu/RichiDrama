const capabilities = ['text', 'image', 'video', 'tts'];

function infer(model) {
  const name = String(model || '').trim().toLowerCase();
  if (/^(doubao-seedream-|gpt-image-|dall-e-|flux[-.]|qwen-image)/.test(name)) return 'image';
  if (/^(doubao-seedance-|sora-|veo[-.]|kling-)/.test(name)) return 'video';
  if (/^(tts-|cosyvoice|qwen3-tts)/.test(name)) return 'tts';
  if (/^(doubao-seed-|doubao-pro-|doubao-lite-|gpt-[345]|o[134](?:-|$)|claude-|deepseek-(?:chat|reasoner|v\d|r1))/.test(name)) return 'text';
  return null;
}

function canonical(type) { return type === 'storyboard_image' ? 'image' : type; }

function resolve(model, selected) {
  const known = infer(model);
  if (selected && !capabilities.includes(selected)) throw new Error(`模型 ${model} 的能力无效`);
  if (known && selected && selected !== known) throw new Error(`模型 ${model} 的能力是 ${known}，不能导入为 ${selected}`);
  if (!known && !selected) throw new Error(`无法判断模型 ${model} 的能力，请选择文本、图片、视频或语音`);
  return known || selected;
}

module.exports = { capabilities, infer, canonical, resolve };
