const fs = require('fs');
const path = require('path');

function normalizeStorageKey(value) {
  const key = String(value || '').replace(/\\/g, '/');
  if (!key || key.includes('\0') || key.includes(':') || key.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw Object.assign(new Error('媒体路径必须是存储目录内的相对路径'), { code: 'INVALID_MEDIA_PATH' });
  }
  return key;
}

function assertContained(root, target) {
  const relative = path.relative(root, target);
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw Object.assign(new Error('媒体路径超出存储目录'), { code: 'INVALID_MEDIA_PATH' });
  }
}

function resolveStorageFile(storageRoot, value) {
  const root = path.resolve(storageRoot);
  const input = String(value || '');
  // Some historical jobs persisted absolute paths inside the storage root.
  const target = path.isAbsolute(input) ? path.resolve(input) : path.resolve(root, normalizeStorageKey(input));
  assertContained(root, target);
  const realRoot = fs.realpathSync(root);
  const realTarget = fs.realpathSync(target);
  assertContained(realRoot, realTarget);
  if (!fs.statSync(realTarget).isFile()) throw new Error('媒体路径不是文件');
  return realTarget;
}

module.exports = { normalizeStorageKey, resolveStorageFile };
