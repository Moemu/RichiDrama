'use strict';

function parse(value, array = false) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return array ? (Array.isArray(parsed) ? parsed : []) : (parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
  } catch (_) { return array ? [] : {}; }
}

// All three storyboard read paths expose the same persisted editing inputs.
function storyboardInputState(row) {
  return {
    text_model: row.text_model ?? null,
    video_model: row.video_model ?? null,
    video_resolution: row.video_resolution ?? null,
    video_upscale_resolution: row.video_upscale_resolution ?? null,
    video_target_fps: row.video_target_fps ?? null,
    video_aspect_ratio: row.video_aspect_ratio ?? null,
    generation_overrides: parse(row.generation_overrides_json),
    omni_prompt_document: parse(row.omni_prompt_document_json),
    omni_asset_ids: parse(row.omni_asset_ids, true),
    omni_asset_usage: parse(row.omni_asset_usage_json),
    omni_creation_mode: row.omni_creation_mode || 'multi_reference',
    omni_asset_send_policy: row.omni_asset_send_policy || 'all_selected',
    omni_first_frame_asset_id: row.omni_first_frame_asset_id != null ? Number(row.omni_first_frame_asset_id) : null,
    omni_last_frame_asset_id: row.omni_last_frame_asset_id != null ? Number(row.omni_last_frame_asset_id) : null,
    audio_strategy: row.audio_strategy || 'reference_only',
    keep_original_audio: !!row.keep_original_audio,
    audio_volume: row.audio_volume ?? 1,
    audio_fade_seconds: row.audio_fade_seconds ?? 0,
  };
}

module.exports = { storyboardInputState };
