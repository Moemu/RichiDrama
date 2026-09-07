const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeStorageKey, resolveStorageFile } = require('../src/utils/storagePath');
const { uploadLocalImageToProxy } = require('../src/services/uploadService');

test('storage paths preserve local history but reject traversal and symlink escapes before upload', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'minidrama-storage-path-'));
  const root = path.join(temp, 'storage');
  const outside = path.join(temp, 'outside');
  fs.mkdirSync(path.join(root, 'images'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(root, 'images', '历史.png'), 'local-fixture');
  fs.writeFileSync(path.join(outside, 'secret.png'), 'outside-fixture');
  try {
    assert.equal(normalizeStorageKey('images\\历史.png'), 'images/历史.png');
    for (const key of ['../outside/secret.png', 'images/../../outside/secret.png', '/outside.png', 'C:\\outside.png', '//server/share.png', 'images//x.png', 'images/./x.png', 'image\0.png']) {
      assert.throws(() => normalizeStorageKey(key));
    }
    const local = path.join(root, 'images', '历史.png');
    assert.equal(resolveStorageFile(root, 'images/历史.png'), fs.realpathSync(local));
    assert.equal(resolveStorageFile(root, local), fs.realpathSync(local));
    fs.symlinkSync(outside, path.join(root, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
    for (const value of ['../outside/secret.png', path.join(outside, 'secret.png'), 'external/secret.png']) {
      assert.throws(() => resolveStorageFile(root, value), /媒体路径/);
    }
    const originalFetch = global.fetch;
    let uploads = 0;
    global.fetch = async () => { uploads += 1; throw new Error('Unexpected upload'); };
    try {
      for (const value of ['../outside/secret.png', path.join(outside, 'secret.png'), 'external/secret.png', 'http://localhost/static/%2e%2e/outside/secret.png']) {
        assert.equal(await uploadLocalImageToProxy(root, value, { warn() {}, info() {} }, 'test'), null);
      }
      assert.equal(uploads, 0);
    } finally { global.fetch = originalFetch; }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
