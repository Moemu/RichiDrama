const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const configPaths = [
  path.join(process.cwd(), 'configs', 'config.yaml'),
  path.join(process.cwd(), 'config.yaml'),
  path.join(__dirname, '..', '..', 'configs', 'config.yaml'),
];

const DEPLOYMENT_OSS_ENV_MAP = {
  MINIDRAMA_STORAGE_TYPE: 'CFG_STORAGE__TYPE',
  MINIDRAMA_OSS_ENDPOINT: 'CFG_STORAGE__OSS__ENDPOINT',
  MINIDRAMA_OSS_BUCKET: 'CFG_STORAGE__OSS__BUCKET',
  MINIDRAMA_OSS_ACCESS_KEY_ID: 'CFG_STORAGE__OSS__ACCESS_KEY_ID',
  MINIDRAMA_OSS_ACCESS_KEY_SECRET: 'CFG_STORAGE__OSS__ACCESS_KEY_SECRET',
  MINIDRAMA_OSS_PREFIX: 'CFG_STORAGE__OSS__PREFIX',
  MINIDRAMA_OSS_CDN_DOMAIN: 'CFG_STORAGE__OSS__PUBLIC_BASE_URL',
  MINIDRAMA_OSS_AUTO_ARCHIVE_ENABLED: 'CFG_STORAGE__OSS__AUTO_ARCHIVE_ENABLED',
};

function applyDeploymentEnv(name, value) {
  const target = DEPLOYMENT_OSS_ENV_MAP[name];
  if (!target || value == null || !String(value).trim()) return;
  if (!String(process.env[target] || '').trim()) process.env[target] = value;
}

function parseEnvFile(file) {
  const values = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function resolveLocalEnvFile() {
  const explicit = String(process.env.MINIDRAMA_ENV_FILE || '').trim();
  if (explicit) {
    const file = path.resolve(explicit);
    if (!fs.existsSync(file)) throw new Error(`MINIDRAMA_ENV_FILE does not exist: ${file}`);
    return file;
  }
  const profile = String(process.env.MINIDRAMA_PROFILE || '').trim().toLowerCase();
  const roots = [...new Set([process.cwd(), path.resolve(process.cwd(), '..')])];
  const candidates = [];
  if (PROFILE_NAMES.includes(profile)) {
    for (const root of roots) candidates.push(path.join(root, `.${profile}.env`));
  }
  // Compatibility path. A profile file always wins when both files exist.
  for (const root of roots) candidates.push(path.join(root, 'minidrama.oss.env'));
  return candidates.find((file) => fs.existsSync(file)) || null;
}

// Docker receives the selected file through --env-file. Local node processes
// load the same ignored profile file here. Existing process variables win.
// The legacy minidrama.oss.env path remains a final compatibility fallback.
function loadOptionalDeploymentEnv() {
  const envPath = resolveLocalEnvFile();
  if (envPath) {
    for (const [name, value] of Object.entries(parseEnvFile(envPath))) {
      if (process.env[name] == null || process.env[name] === '') process.env[name] = value;
    }
  }
  for (const name of Object.keys(DEPLOYMENT_OSS_ENV_MAP)) applyDeploymentEnv(name, process.env[name]);
}

/**
 * 将环境变量字符串值按 JSON/类型规则解析。
 * "true"/"false" → 布尔；纯整数 → 数字；空串 → 空串；其它原样字符串。
 */
function parseEnvValue(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  if ((v.startsWith('[') && v.endsWith(']')) || (v.startsWith('{') && v.endsWith('}'))) {
    try { return JSON.parse(v); } catch (_) { /* keep the original string */ }
  }
  return v;
}

/**
 * 用 CFG_ 前缀的环境变量覆盖 config 字段，方便本地调试，无需改 config.yaml。
 * 命名规则：CFG_<段名>__<键名>（双下划线分层，全大写，对应 config 的 snake_case 路径）。
 * 例：
 *   CFG_IMAGE_PROXY__USE_FOR_VIDEO=false → config.image_proxy.use_for_video = false
 *   CFG_SERVER__PORT=8080                → config.server.port = 8080
 * 线上不设这些变量即不触发，零影响。
 * @returns {string[]} 被覆盖的字段描述（用于启动日志）
 */
function applyEnvOverrides(cfg) {
  const changed = [];
  for (const envKey of Object.keys(process.env)) {
    if (!envKey.startsWith('CFG_')) continue;
    const relPath = envKey.slice(4).toLowerCase().split('__');
    if (!relPath.length || relPath.some((s) => !s)) continue;
    let obj = cfg;
    for (let i = 0; i < relPath.length - 1; i++) {
      const seg = relPath[i];
      if (obj[seg] == null || typeof obj[seg] !== 'object') obj[seg] = {};
      obj = obj[seg];
    }
    const finalKey = relPath[relPath.length - 1];
    const rawVal = process.env[envKey];
    obj[finalKey] = parseEnvValue(rawVal);
    // Startup diagnostics must never disclose credentials or tokens. The
    // key/path still makes it clear that the override took effect.
    const sensitivePattern = /(?:secret|password|token|api.*key|access.*key|private.*key|certificate|\bpem\b)/i;
    const sensitive = sensitivePattern.test(envKey) || sensitivePattern.test(relPath.join('_'));
    changed.push(`${envKey} -> ${relPath.join('.')} = ${sensitive ? '<redacted>' : rawVal}`);
  }
  return changed;
}

let _envOverrideLog = null;
function getEnvOverrideLog() {
  return _envOverrideLog || [];
}

const PROFILE_NAMES = ['dev', 'preview', 'prod'];
let _activeProfile = null;
function getActiveProfile() {
  return _activeProfile;
}

/**
 * 深度合并 profile 覆盖到基础配置：profile 定义过的叶子节点整体生效，
 * 未提及的字段保持 config.yaml 原值。数组整体替换。
 */
function deepMergeProfile(base, override) {
  for (const [key, value] of Object.entries(override || {})) {
    if (
      value && typeof value === 'object' && !Array.isArray(value) &&
      base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])
    ) {
      deepMergeProfile(base[key], value);
    } else {
      base[key] = value;
    }
  }
  return base;
}

/**
 * MINIDRAMA_PROFILE=dev|preview|prod 时，把 configs/profiles/<name>.yaml
 * 叠加到基础配置之上（位于 CFG_* 显式环境变量之下一层）。
 * 未设置时不做任何事——行为与历史版本逐字段一致。
 * @returns {string[]} 生效的合并说明（用于启动日志）
 */
function applyProfile(cfg) {
  const name = String(process.env.MINIDRAMA_PROFILE || '').trim().toLowerCase();
  if (!name) return [];
  if (!PROFILE_NAMES.includes(name)) {
    throw new Error(`Unknown MINIDRAMA_PROFILE "${name}". Allowed: ${PROFILE_NAMES.join(', ')} (or unset).`);
  }
  _activeProfile = name;
  // Mirrors configPaths: the working tree wins (local debugging), then the
  // shipped configs directory relative to this module.
  const profilePaths = [
    path.join(process.cwd(), 'configs', 'profiles', `${name}.yaml`),
    path.join(__dirname, '..', '..', 'configs', 'profiles', `${name}.yaml`),
  ];
  const file = profilePaths.find((p) => fs.existsSync(p));
  if (!file) {
    throw new Error(`Profile file missing for MINIDRAMA_PROFILE=${name}. Looked at: ${profilePaths.join(', ')}`);
  }
  const overlay = yaml.load(fs.readFileSync(file, 'utf8')) || {};
  const leaves = [];
  (function collect(node, prefix) {
    for (const [key, value] of Object.entries(node || {})) {
      const dotPath = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value)) collect(value, dotPath);
      else leaves.push(dotPath);
    }
  })(overlay, '');
  deepMergeProfile(cfg, overlay);
  return leaves.map((dotPath) => `profile:${name} -> ${dotPath}`);
}

let _profileLog = [];
function getProfileLog() {
  return _profileLog || [];
}

function loadConfig() {
  loadOptionalDeploymentEnv();
  let raw = null;
  for (const p of configPaths) {
    if (fs.existsSync(p)) {
      raw = fs.readFileSync(p, 'utf8');
      break;
    }
  }
  if (!raw) {
    throw new Error('Config file not found: configs/config.yaml');
  }
  const parsed = yaml.load(raw);
  if (!parsed?.app?.name) {
    throw new Error('Invalid config: missing app section');
  }
  _activeProfile = null;
  _profileLog = applyProfile(parsed);
  // 环境变量覆盖（仅本地调试用；线上不设 CFG_* 变量即不触发）
  _envOverrideLog = applyEnvOverrides(parsed);
  return parsed;
}

module.exports = { loadConfig, getEnvOverrideLog, getActiveProfile, getProfileLog };
