const test = require('node:test');
const assert = require('node:assert/strict');
const { callVolcengineOmniVideoApi } = require('../src/services/videoClient');

const log = { info() {}, warn() {}, error() {} };

test('Seedance omni request carries every image reference and the selected audio reference', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, text: async () => JSON.stringify({ id: 'task-omni-1', status: 'processing' }) };
  };
  try {
    const output = await callVolcengineOmniVideoApi({
      base_url: 'https://video.example.test', api_key: 'test-key', model: ['seedance-2.0'], default_model: 'seedance-2.0',
    }, log, {
      prompt: '一个角色在雨夜奔跑', model: 'seedance-2.0', duration: 5, aspect_ratio: '16:9',
      reference_urls: ['https://assets.example.test/character.jpg', 'https://assets.example.test/street.jpg'],
      voice_reference_url: 'https://assets.example.test/voice.mp3', video_gen_id: 42,
    });

    assert.equal(output.task_id, 'task-omni-1');
    assert.equal(calls.length, 1);
    const content = calls[0].body.content;
    assert.deepEqual(content.filter((item) => item.role === 'reference_image').map((item) => item.image_url.url), [
      'https://assets.example.test/character.jpg', 'https://assets.example.test/street.jpg',
    ]);
    assert.deepEqual(content.find((item) => item.role === 'reference_audio'), {
      type: 'audio_url', audio_url: { url: 'https://assets.example.test/voice.mp3' }, role: 'reference_audio',
    });
  } finally {
    global.fetch = originalFetch;
  }
});
