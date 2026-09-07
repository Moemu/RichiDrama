const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');

const { parseZip, ZIP_LIMITS } = require('../src/services/dramaImportService');
const {
  importNovel,
  detectChaptersByRules,
  MAX_NOVEL_TEXT_BYTES,
  MAX_NOVEL_CHAPTERS,
} = require('../src/services/novelImportService');

test('ZIP media entries are lazy and keep the Map contract', () => {
  const zip = new AdmZip();
  zip.addFile('project.json', Buffer.from(JSON.stringify({ drama: { title: '测试' } })));
  zip.addFile('media/unused.bin', Buffer.alloc(1024 * 1024, 1));

  const parsed = parseZip(zip.toBuffer());
  assert.equal(parsed.files instanceof Map, true);
  assert.equal(parsed.files.size, 1);
  assert.equal(parsed.files.cache.size, 0);
  assert.equal(parsed.files.get('media/unused.bin').length, 1024 * 1024);
  assert.equal(parsed.files.cache.size, 1);
  assert.equal(ZIP_LIMITS.maxEntryUncompressedBytes > 0, true);
});

test('ZIP rejects a project manifest above the JSON budget', () => {
  const zip = new AdmZip();
  const oversized = Buffer.alloc(ZIP_LIMITS.maxProjectJsonBytes + 1, 32);
  zip.addFile('project.json', oversized);
  assert.throws(() => parseZip(zip.toBuffer()), /project\.json.*过大/);
});

test('novel chapter scan avoids line-array splitting and caps imported chapters', async () => {
  const sections = [];
  for (let i = 1; i <= MAX_NOVEL_CHAPTERS + 2; i++) {
    sections.push(`第${i}章 标题`, '这一段正文足够长，可以稳定通过章节内容长度校验。');
  }
  const chapters = detectChaptersByRules(sections.join('\n'));
  assert.equal(chapters.length, MAX_NOVEL_CHAPTERS + 2);
  const result = await importNovel(null, { warn() {} }, {
    text: sections.join('\n'),
    title: '测试小说',
    maxChapters: 100,
    aiSummarize: false,
  });
  assert.equal(result.chapters.length, MAX_NOVEL_CHAPTERS);
  assert.equal(result.total, MAX_NOVEL_CHAPTERS + 2);
});

test('novel import rejects text over its byte budget before chapter work', async () => {
  const text = '字'.repeat(Math.ceil(MAX_NOVEL_TEXT_BYTES / 2) + 1);
  await assert.rejects(
    () => importNovel(null, { warn() {} }, { text, title: '过大', aiSummarize: false }),
    /小说内容过大/
  );
});
