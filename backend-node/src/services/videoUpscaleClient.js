'use strict';

const mediaKit = require('./videoInterpolationClient');

async function submit(db, input) {
  const cfg = mediaKit.config(db);
  const body = {
    video_url: input.video_url,
    resolution: input.resolution || cfg.settings.upscale_resolution || '1080p',
    bitrate_level: input.bitrate_level || cfg.settings.upscale_bitrate_level || 'medium',
    client_token: String(input.client_token || '').slice(0, 64),
    callback_args: input.callback_args || undefined,
    queue_id: cfg.settings.queue_id || undefined,
  };
  // Deliberately omit fps: the enhancement stage must preserve the source
  // frame rate. Frame generation belongs to the following billed stage.
  const data = await mediaKit.jsonRequest(`${cfg.base_url}/api/v1/tools/enhance-video-generative`, cfg.api_key, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!data.task_id) throw new Error('AI MediaKit 超分未返回 task_id');
  return { task_id: data.task_id, request_id: data.request_id || null };
}

module.exports = {
  config: mediaKit.config,
  uploadLocalVideo: mediaKit.uploadLocalVideo,
  retrieve: mediaKit.retrieve,
  submit,
};
