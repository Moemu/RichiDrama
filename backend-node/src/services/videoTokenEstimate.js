'use strict';

/**
 * 按 output token 计费的视频：提交前「预授权用量」估算。
 *
 * 定位（不要混淆）：
 * - 结算永远以上游返回的真实 usage 为准（`billingUsageService.videoUsage` →
 *   `settleAuthorization`），本模块只决定提交前冻结多少额度，绝不参与扣费口径。
 * - 上游按输出 token 计费，token 数由「画布像素 × 帧率 × 时长」驱动，**不存在**任何
 *   固定的“上限”；把配置里的数字当作上限既不准也不安全，因此这里按时长与分辨率精算。
 *
 * 实测锚点（2026-09-21 读本地库 billing_usage_logs 与 video_generations 对应记录）：
 *   doubao-seedance-2-0-mini-260615  4s 480p → 40,594 tokens（实扣 93.37 积分）
 *   doubao-seedance-2-0-mini-260615  4s 720p → 87,300 tokens（实扣 200.79 积分）
 *   doubao-seedance-2-0-fast-260128  4s 480p → 40,594 tokens
 *   doubao-seedance-2-0-fast-260128  5s 480p → 50,638 tokens
 *   doubao-seedance-2-5-260628       4s 480p → 38,830 tokens
 * 720p 与 480p 的实测比值为 2.15（画布面积比 2.25），与「像素 × 帧率 × 时长 ÷ 1024」
 * 同量级；480p 实测比该式高约 5.6%，720p 高约 1.0%，因此统一乘安全系数 1.15 并向上
 * 取整到百位，保证估算不低于真实用量（实测最大偏差 13.9% 余量）。
 */

const TOKEN_DIVISOR = 1024;
const GENERATION_FPS = 24;
const SAFETY_FACTOR = 1.15;
const ROUNDING_STEP = 100;

/** 精确画布来自仓库既有的画幅契约，避免自己另立一套分辨率口径。 */
function canvasFor(resolution, aspectRatio) {
  const videoService = require('./videoService');
  const canvas = videoService.targetVideoPixelsForAspect(aspectRatio || '16:9', resolution || '720p');
  if (!Number.isFinite(canvas?.w) || !Number.isFinite(canvas?.h) || canvas.w <= 0 || canvas.h <= 0) {
    throw new Error('无法从画幅与分辨率推导视频画布，不能估算预授权 token');
  }
  return canvas;
}

function estimateOutputTokens(input = {}) {
  const duration = Math.max(1, Math.ceil(Number(input.duration) || 0));
  const canvas = canvasFor(input.resolution, input.aspectRatio);
  const raw = (canvas.w * canvas.h * GENERATION_FPS * duration) / TOKEN_DIVISOR;
  return Math.ceil((raw * SAFETY_FACTOR) / ROUNDING_STEP) * ROUNDING_STEP;
}

/**
 * 报价与预授权共用的展示口径：让用户看得到冻结是按什么估出来的。
 */
function describeReserve(input = {}) {
  const canvas = canvasFor(input.resolution, input.aspectRatio);
  const duration = Math.max(1, Math.ceil(Number(input.duration) || 0));
  return {
    output_tokens: estimateOutputTokens({ ...input, duration }),
    basis: `${duration}s × ${input.resolution || '720p'} × ${input.aspectRatio || '16:9'}（${canvas.w}×${canvas.h} @${GENERATION_FPS}fps，已含 15% 余量）`,
    canvas: { width: canvas.w, height: canvas.h },
    duration_seconds: duration,
    fps: GENERATION_FPS,
    safety_factor: SAFETY_FACTOR,
  };
}

module.exports = { estimateOutputTokens, describeReserve, GENERATION_FPS, SAFETY_FACTOR };
