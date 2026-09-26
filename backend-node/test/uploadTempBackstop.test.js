const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const uploadTempBackstop = require('../src/middleware/uploadTempBackstop');

test('upload temp backstop removes the multer temp file when the response ends without reaching the handler', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-backstop-'));
  try {
    const tempFile = path.join(dir, 'rejected.mp4');
    fs.writeFileSync(tempFile, 'x');
    const req = { file: { path: tempFile } };
    const res = new EventEmitter();
    let handled = false;
    uploadTempBackstop(req, res, () => { handled = true; });
    assert.equal(handled, true, '必须继续进入守卫等后续中间件');
    assert.ok(fs.existsSync(tempFile), '响应结束前不得提前删除（守卫可能仍要读取）');
    res.emit('finish');
    assert.equal(fs.existsSync(tempFile), false, '守卫拒绝路径的临时文件必须在响应结束时兜底删除');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('upload temp backstop is a no-op without a file and tolerates already-renamed paths', () => {
  const req = {};
  const res = new EventEmitter();
  let handled = false;
  uploadTempBackstop(req, res, () => { handled = true; });
  assert.equal(handled, true);
  res.emit('close');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-backstop-gone-'));
  try {
    // 成功路径：文件已被 rename 转正，force 删除是幂等空操作，不得抛错。
    const req2 = { file: { path: path.join(dir, 'renamed-away.mp4') } };
    const res2 = new EventEmitter();
    uploadTempBackstop(req2, res2, () => {});
    res2.emit('finish');
    res2.emit('close');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
