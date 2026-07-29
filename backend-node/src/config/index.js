const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const configPaths = [
  path.join(process.cwd(), 'configs', 'config.yaml'),
  path.join(process.cwd(), 'config.yaml'),
  path.join(__dirname, '..', '..', 'configs', 'config.yaml'),
];

/**
 * 将环境变量字符串值按 JSON/类型规则解析。
 * "true"/"false" → 布尔；纯整数 → 数字；空串 → 空串；其它原样字符串。
 */
function parseEnvValue(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
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
    changed.push(`${envKey} -> ${relPath.join('.')} = ${rawVal}`);
  }
  return changed;
}

let _envOverrideLog = null;
function getEnvOverrideLog() {
  return _envOverrideLog || [];
}

function loadConfig() {
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
  // 环境变量覆盖（仅本地调试用；线上不设 CFG_* 变量即不触发）
  _envOverrideLog = applyEnvOverrides(parsed);
  return parsed;
}

module.exports = { loadConfig, getEnvOverrideLog };
