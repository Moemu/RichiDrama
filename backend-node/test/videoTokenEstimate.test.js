const test = require('node:test');
const assert = require('node:assert/strict');
const estimate = require('../src/services/videoTokenEstimate');

// 锚点来自本地库 billing_usage_logs 与 video_generations 的真实扣费记录（2026-09-21 读取）。
const OBSERVED = [
  { duration: 4, resolution: '480p', aspectRatio: '16:9', observed: 40594, model: 'doubao-seedance-2.0-mini 4s 480p' },
  { duration: 4, resolution: '720p', aspectRatio: '16:9', observed: 87300, model: 'doubao-seedance-2.0-mini 4s 720p' },
  { duration: 5, resolution: '480p', aspectRatio: '16:9', observed: 50638, model: 'doubao-seedance-2.0-fast 5s 480p' },
  { duration: 4, resolution: '480p', aspectRatio: '9:16', observed: 38830, model: 'doubao-seedance-2.5 4s 480p（竖屏，同一像素量）' },
];

test('reserve estimate stays above every observed provider usage while staying tight', () => {
  for (const sample of OBSERVED) {
    const estimated = estimate.estimateOutputTokens(sample);
    assert.ok(estimated >= sample.observed, `${sample.model}: 估算 ${estimated} 必须不低于实测 ${sample.observed}`);
    assert.ok(estimated <= sample.observed * 1.5, `${sample.model}: 估算 ${estimated} 不应比实测 ${sample.observed} 高出 50% 以上`);
  }
});

test('reserve estimate scales with duration and resolution instead of any fixed cap', () => {
  const four = estimate.estimateOutputTokens({ duration: 4, resolution: '480p', aspectRatio: '16:9' });
  const eight = estimate.estimateOutputTokens({ duration: 8, resolution: '480p', aspectRatio: '16:9' });
  const hd = estimate.estimateOutputTokens({ duration: 4, resolution: '720p', aspectRatio: '16:9' });
  const uhd = estimate.estimateOutputTokens({ duration: 4, resolution: '1080p', aspectRatio: '16:9' });
  assert.ok(eight > four * 1.9 && eight < four * 2.1, '时长翻倍时冻结量按比例上升');
  assert.ok(hd > four, '720p 高于 480p');
  assert.ok(uhd > hd, '1080p 高于 720p');
  assert.equal(estimate.estimateOutputTokens({ duration: 4, resolution: '480p', aspectRatio: '9:16' }),
    four, '同一短边下横竖屏像素量一致，冻结量相同');
});

test('reserve basis explains the estimate for the user', () => {
  const basis = estimate.describeReserve({ duration: 4, resolution: '480p', aspectRatio: '16:9' });
  assert.equal(basis.duration_seconds, 4);
  assert.equal(basis.fps, 24);
  assert.ok(basis.canvas.width > basis.canvas.height, '16:9 画布应为横屏');
  assert.match(basis.basis, /4s × 480p × 16:9/);
});
