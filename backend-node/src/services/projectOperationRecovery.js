'use strict';

const edits = require('./projectEditService');

// These handlers persist their result synchronously. Generation submission only
// queues background work with setImmediate, after the transaction has committed.
function supportsAtomicResponse(req) {
  if (edits.supports(req)) return true;
  if (req.method === 'POST' && /^\/(storyboards|characters|scenes|props|assets|character-library|scene-library|prop-library|images|videos|omni-video-jobs)$/.test(req.path)) return true;
  if (req.method === 'POST' && /^\/storyboards\/\d+\/copy$/.test(req.path)) return true;
  if (req.method === 'POST' && /^\/dramas\/\d+\/collaboration\/(assets|suggestions\/\d+\/apply)$/.test(req.path)) return true;
  return ['PUT', 'DELETE'].includes(req.method) && /^\/dramas\/\d+\/collaboration\/members(?:\/\d+)?$/.test(req.path);
}

function pending(dramaId, operationId) {
  return {
    status: 409,
    body: { success: false, error: { code: 'OPERATION_PENDING', message: '此操作已受理，结果尚未确认。请刷新查看，勿重复提交生成。' } },
    recovery: { version: 1, confirm_before: new Date(Date.now() + 15 * 60_000).toISOString(), drama_id: dramaId, operation_id: operationId },
  };
}

function unconfirmed(saved, reason) {
  return {
    ...saved,
    status: 409,
    body: { success: false, error: {
      code: 'OPERATION_UNCONFIRMED',
      message: reason === 'stream'
        ? '此操作的流式响应已结束，无法重复回放。请刷新项目查看已保存的内容。'
        : '此操作未能确认最终响应。请刷新项目并核对生成记录；不要重复提交付费操作。',
      details: { operation_id: saved.recovery.operation_id, drama_id: saved.recovery.drama_id, results_url: `/api/v1/dramas/${saved.recovery.drama_id}/collaboration/results` },
    } },
  };
}

function recover(saved) {
  const recovery = saved.recovery;
  if (saved.body?.error?.code !== 'OPERATION_PENDING' || recovery?.version !== 1) return saved;
  // Expiry changes the reported uncertainty, never the right to execute again.
  // A late handler may still save its final response under the same operation ID.
  return Date.now() >= Date.parse(recovery.confirm_before) ? unconfirmed(saved, 'interrupted') : saved;
}

module.exports = { supportsAtomicResponse, pending, unconfirmed, recover };
