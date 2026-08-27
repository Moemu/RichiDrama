const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// loadConfig() resolves configs/config.yaml from process.cwd() first, so every
// case materialises its own fixture project and chdirs into it.
//
// Two contamination sources are deliberately dodged so the tests stay hermetic:
// 1. The repo-root minidrama.oss.env (relative to the module, regardless of cwd)
//    would otherwise inject storage values into every load — therefore storage
//    itself is exercised through deploymentSafety assertions on the deploy side,
//    and these unit tests prove merge mechanics through an app.tag leaf that no
//    deployment mapping touches.
// 2. CFG_*/MINIDRAMA_* variables are snapshotted and restored around each load.
const MOD_PATH = require.resolve('../src/config/index.js');
const BASE_YAML = [
  'app:',
  '  name: profile-fixture',
  'image_proxy:',
  '  use_for_video: true',
].join('\n');
const DEV_OVERLAY = [
  '# dev',
  'app:',
  '  tag: dev',
  'image_proxy:',
  '  use_for_video: false',
].join('\n');
const PROD_EMPTY = '# intentionally empty\n';
const PREVIEW_OVERLAY = [
  '# preview',
  'app:',
  '  tag: preview',
  'image_proxy:',
  '  use_for_video: false',
].join('\n');

function writeFixture(profiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-profile-'));
  fs.mkdirSync(path.join(dir, 'configs', 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'configs', 'config.yaml'), BASE_YAML);
  for (const [name, content] of Object.entries(profiles)) {
    fs.writeFileSync(path.join(dir, 'configs', 'profiles', `${name}.yaml`), content);
  }
  return dir;
}

function loadFrom(dir) {
  const previousCwd = process.cwd();
  const savedProxy = process.env.CFG_IMAGE_PROXY__USE_FOR_VIDEO;
  const savedProfile = process.env.MINIDRAMA_PROFILE;
  fs.mkdirSync(dir, { recursive: true });
  process.chdir(dir);
  try {
    const mod = require(MOD_PATH); // caller resets require.cache for a fresh read
    return { mod, cfg: mod.loadConfig() };
  } finally {
    process.chdir(previousCwd);
    if (savedProxy === undefined) delete process.env.CFG_IMAGE_PROXY__USE_FOR_VIDEO;
    else process.env.CFG_IMAGE_PROXY__USE_FOR_VIDEO = savedProxy;
    if (savedProfile === undefined) delete process.env.MINIDRAMA_PROFILE;
    else process.env.MINIDRAMA_PROFILE = savedProfile;
  }
}

test('profile unset: behaviour is identical to the historical default', () => {
  process.env.MINIDRAMA_PROFILE = '';
  const dir = writeFixture({ dev: DEV_OVERLAY });
  delete require.cache[MOD_PATH];
  const { mod, cfg } = loadFrom(dir);
  assert.equal(cfg.app.tag, undefined);
  assert.equal(cfg.image_proxy.use_for_video, true);
  assert.equal(mod.getActiveProfile(), null);
});

test('dev profile pins local intent without touching unrelated sections', () => {
  process.env.MINIDRAMA_PROFILE = 'dev';
  const dir = writeFixture({ dev: DEV_OVERLAY });
  delete require.cache[MOD_PATH];
  const { mod, cfg } = loadFrom(dir);
  assert.equal(cfg.app.name, 'profile-fixture'); // base fields survive the merge
  assert.equal(cfg.app.tag, 'dev'); // overlay leaf landed
  assert.equal(mod.getProfileLog().some((line) => line === 'profile:dev -> app.tag'), true);
});

test('prod profile is an intentional empty set', () => {
  process.env.MINIDRAMA_PROFILE = 'prod';
  const dir = writeFixture({ prod: PROD_EMPTY });
  delete require.cache[MOD_PATH];
  const { cfg } = loadFrom(dir);
  assert.equal(cfg.image_proxy.use_for_video, true);
  assert.equal(cfg.app.tag, undefined);
});

test('unknown profile aborts loudly instead of guessing', () => {
  process.env.MINIDRAMA_PROFILE = 'staging';
  const dir = writeFixture({});
  delete require.cache[MOD_PATH];
  assert.throws(() => loadFrom(dir), /Unknown MINIDRAMA_PROFILE "staging"/);
});

test('an explicit CFG_* variable still wins over the profile overlay', () => {
  process.env.MINIDRAMA_PROFILE = 'preview';
  process.env.CFG_IMAGE_PROXY__USE_FOR_VIDEO = 'true';
  const dir = writeFixture({ preview: PREVIEW_OVERLAY });
  delete require.cache[MOD_PATH];
  const { cfg } = loadFrom(dir);
  assert.equal(cfg.image_proxy.use_for_video, true); // escape hatch honoured
  assert.equal(cfg.app.tag, 'preview'); // other leaves unaffected
});
