const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { callVolcengineOmniVideoApi } = require('../src/services/videoClient');

const log = { info() {}, warn() {}, error() {} };

test('Seedance omni sends a valid text-only video request without reference material', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, text: async () => JSON.stringify({ id: 'task-text-only', status: 'processing' }) };
  };
  try {
    const output = await callVolcengineOmniVideoApi({
      base_url: 'https://video.example.test', api_key: 'test-key', model: ['seedance-2.0'], default_model: 'seedance-2.0',
    }, log, {
      prompt: '雨夜的未来城市', model: 'seedance-2.0', duration: 5, aspect_ratio: '16:9',
      reference_urls: [], video_gen_id: 41,
    });

    assert.equal(output.task_id, 'task-text-only');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body.content, [{ type: 'text', text: '雨夜的未来城市' }]);
    assert.equal(calls[0].body.task_type, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

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

test('Seedance omni converts a library relative path to a data URL before sending it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-mini-drama-omni-'));
  const relativePath = 'library/images/reference.png';
  const imagePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, Buffer.from('reference-image'));

  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, text: async () => JSON.stringify({ id: 'task-local-reference', status: 'processing' }) };
  };
  try {
    await callVolcengineOmniVideoApi({
      base_url: 'https://video.example.test', api_key: 'test-key', model: ['seedance-2.0'], default_model: 'seedance-2.0',
    }, log, {
      prompt: '本地素材参考图', model: 'seedance-2.0', duration: 5, aspect_ratio: '16:9',
      reference_urls: [relativePath], storage_local_path: root, video_gen_id: 43,
    });

    const reference = calls[0].body.content.find((item) => item.role === 'reference_image');
    assert.match(reference.image_url.url, /^data:image\/png;base64,/);
    assert.doesNotMatch(reference.image_url.url, /library\/images/);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
