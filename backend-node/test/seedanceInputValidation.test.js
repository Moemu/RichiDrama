const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateAssets, rulesForModel, assertRequestSize, describeAsset } = require('../src/services/seedanceInputValidation');
const MODEL = 'doubao-seedance-2-0-fast-260128';
const MODEL25 = 'doubao-seedance-2-5-260628';
const MB = 1024 * 1024;
const image = (extra = {}) => ({ type: 'image', url: 'https://example.test/image.png', width: 1280, height: 720, file_size: 1000, ...extra });
const audio = (extra = {}) => ({ type: 'audio', name: '西西.wav', id: 956, url: 'https://example.test/voice.wav', duration: 2, file_size: 249934, ...extra });
const video = (extra = {}) => ({ type: 'video', url: 'https://example.test/motion.mp4', width: 1280, height: 720, duration: 2, file_size: 1000,
  metadata: { codec: 'h264', frame_rate: '30000/1001', audio_codecs: ['aac'] }, ...extra });

test('task 1299 audio duration is rejected with asset identity and official minimum', () => {
  assert.throws(() => validateAssets(MODEL, [image(), audio({ duration: 1.416417 })]), /西西.wav.*956.*1.416417.*2–15/);
  assert.throws(() => validateAssets(MODEL, [image(), audio({ duration: 1.8 })]), /2–15/);
  assert.doesNotThrow(() => validateAssets(MODEL, [image(), audio({ duration: 2 })]));
  assert.doesNotThrow(() => validateAssets(MODEL, [image(), audio({ duration: 15 })]));
  assert.throws(() => validateAssets(MODEL, [image(), audio({ duration: 15.001 })]), /2–15/);
});

test('audio and video totals are separate and use model family limits', () => {
  assert.doesNotThrow(() => validateAssets(MODEL, [audio({ duration: 15 }), video({ duration: 15 })]));
  assert.throws(() => validateAssets(MODEL, [image(), audio({ duration: 8 }), audio({ duration: 8 })]), /音频总时长 16/);
  assert.throws(() => validateAssets(MODEL, [video({ duration: 8 }), video({ duration: 8 })]), /视频总时长 16/);
  assert.doesNotThrow(() => validateAssets(MODEL25, [audio({ duration: 30 })]));
  assert.throws(() => validateAssets(MODEL25, [video({ duration: 20 }), video({ duration: 11 })]), /视频总时长 31/);
  assert.equal(rulesForModel('seedance-2.0').seconds, 15);
  assert.equal(rulesForModel('seedance-2.5').seconds, 30);
  assert.equal(rulesForModel('kling-v3'), null);
});

test('reference counts and modes reject incompatible combinations', () => {
  for (const [make, max] of [[image, 9], [audio, 3], [video, 3]]) {
    assert.throws(() => validateAssets(MODEL, Array.from({ length: max + 1 }, () => make())), /最多支持/);
  }
  assert.doesNotThrow(() => validateAssets(MODEL25, Array.from({ length: 30 }, () => image())));
  assert.doesNotThrow(() => validateAssets(MODEL25, Array.from({ length: 10 }, () => audio())));
  assert.throws(() => validateAssets(MODEL, [audio()]), /至少一张/);
  assert.throws(() => validateAssets(MODEL, [image({ usage: 'first_frame' }), audio()], 'first_last_frame'), /不能混用/);
  assert.doesNotThrow(() => validateAssets(MODEL, [image(), audio({ duration: 1, send_to_model: false })]));
  assert.doesNotThrow(() => validateAssets('kling-v3', [audio({ duration: 1 })]));
});

test('image dimensions, ratio, format and exclusive byte limit', () => {
  assert.doesNotThrow(() => validateAssets(MODEL, [image({ width: 300, height: 750, file_size: 30 * MB - 1 })]));
  assert.doesNotThrow(() => validateAssets(MODEL, [image({ width: 6000, height: 2400 })]));
  for (const extra of [{ width: 299 }, { height: 6001 }, { width: 300, height: 751 }, { file_size: 30 * MB }, { url: 'https://example.test/image.svg' }]) {
    assert.throws(() => validateAssets(MODEL, [image(extra)]), /素材/);
  }
});

test('audio format and inclusive byte limit', () => {
  assert.doesNotThrow(() => validateAssets(MODEL, [image(), audio({ file_size: 15 * MB })]));
  assert.throws(() => validateAssets(MODEL, [image(), audio({ file_size: 15 * MB + 1 })]), /15 MB/);
  assert.throws(() => validateAssets(MODEL, [image(), audio({ url: 'https://example.test/audio.m4a' })]), /wav、mp3/);
});

test('video pixels, FPS, container and codecs match current official specification', () => {
  assert.doesNotThrow(() => validateAssets(MODEL, [video({ width: 3840, height: 2160, file_size: 200 * MB })]));
  assert.doesNotThrow(() => validateAssets(MODEL, [video({ width: 614, height: 664 })]));
  assert.doesNotThrow(() => validateAssets(MODEL, [video({ url: 'https://example.test/motion.mov', metadata: { codec: 'hevc', frame_rate: '60/1', audio_codecs: ['pcm_s16le'] } })]));
  for (const extra of [
    { width: 600, height: 600 }, { width: 3840, height: 2200 }, { file_size: 200 * MB + 1 },
    { url: 'https://example.test/motion.webm' },
    { metadata: { codec: 'vp9', frame_rate: '24/1', audio_codecs: [] } },
    { metadata: { codec: 'h264', frame_rate: '23/1', audio_codecs: [] } },
    { metadata: { codec: 'h264', frame_rate: '61/1', audio_codecs: [] } },
    { metadata: { codec: 'h264', frame_rate: '24/1', audio_codecs: ['opus'] } },
    { metadata: { codec: 'h264', frame_rate: '24/1', audio_codecs: ['pcm_s16le'] } },
  ]) assert.throws(() => validateAssets(MODEL, [video(extra)]), /素材/);
});

test('missing metadata fails closed; local audio can be probed without changing the file', () => {
  for (const duration of [null, NaN, Infinity, -1]) assert.throws(() => validateAssets(MODEL, [image(), audio({ duration })]), /时长/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seedance-audio-probe-'));
  try {
    const samples = 16000 * 2;
    const buffer = Buffer.alloc(44 + samples * 2);
    buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
    fs.writeFileSync(path.join(root, 'voice.wav'), buffer);
    const result = describeAsset({ type: 'audio', local_path: 'voice.wav' }, root);
    assert.equal(result.duration, 2); assert.equal(result.file_size, buffer.length);
    assert.deepEqual(fs.readFileSync(path.join(root, 'voice.wav')), buffer);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('final payload limit counts UTF-8 bytes', () => {
  assert.doesNotThrow(() => assertRequestSize({ content: [] }));
  assert.throws(() => assertRequestSize({ prompt: '中'.repeat(Math.ceil(64 * MB / 3)) }), /64 MB/);
});
