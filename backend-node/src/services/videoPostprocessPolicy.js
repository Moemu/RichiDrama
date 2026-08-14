'use strict';

const INPUT_RANK = { '480p': 1, '720p': 2, '1080p': 3 };
const UPSCALE_TARGETS = new Set(['720p', '1080p']);

function optionalValue(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized && !['none', 'off', 'false', 'null', 'original'].includes(normalized) ? normalized : null;
}

function normalizeTargetFps(value) {
  if (value === undefined || value === null || value === '') return null;
  const fps = Number(value);
  if (!Number.isInteger(fps) || fps < 15 || fps > 120) {
    throw new Error('插帧目标帧率必须是 15–120 的整数，留空表示不插帧');
  }
  return fps;
}

function normalizeUpscaleResolution(inputResolution, requestedTarget) {
  const target = optionalValue(requestedTarget);
  if (!target) return null;
  const input = optionalValue(inputResolution);
  if (!INPUT_RANK[input]) throw new Error('启用超分时，生成规格必须明确为 480p、720p 或 1080p');
  if (!UPSCALE_TARGETS.has(target)) throw new Error('超分目标仅支持 720p 或 1080p，留空表示保持原始规格');
  if (INPUT_RANK[target] <= INPUT_RANK[input]) throw new Error(`超分目标 ${target} 必须高于生成规格 ${input}`);
  if (input === '1080p') throw new Error('1080p 生成结果不提供重复超分');
  return target;
}

function normalize(input = {}) {
  const resolution = optionalValue(input.resolution) || null;
  return {
    resolution,
    upscale_resolution: normalizeUpscaleResolution(resolution, input.upscale_resolution),
    target_fps: normalizeTargetFps(input.target_fps),
  };
}

function describe(policy) {
  const steps = [`火山生成 ${policy.resolution || '原始规格'}`];
  if (policy.upscale_resolution) steps.push(`AI 超分 ${policy.upscale_resolution}`);
  if (policy.target_fps) steps.push(`AI 插帧 ${policy.target_fps}fps`);
  if (!policy.upscale_resolution && !policy.target_fps) steps.push('保持原片');
  return steps.join(' → ');
}

module.exports = { normalize, normalizeTargetFps, normalizeUpscaleResolution, describe };
