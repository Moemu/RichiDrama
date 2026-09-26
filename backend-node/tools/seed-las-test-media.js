// 本地验收用：向指定项目导入测试视频，仅创建项目素材；不会提交付费 LAS 任务。
// 模式一（默认）：ffmpeg 生成一段符合 LAS 门槛的小视频，走 /media/upload（受 2048MB 上传限制）。
// 模式二（导入）：node tools/seed-las-test-media.js <文件1> [文件2 ...]
//   把真实剧集文件直接拷入 storage/imports/ 并用 ffprobe 实测规格，经 POST /assets 登记为项目素材，
//   绕开 multipart 上传的内存暂存限制，用于投流剪辑等大文件本地冒烟。
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const BASE = { host: '127.0.0.1', port: Number(process.env.PORT || 5679) };
const TITLE = process.env.LAS_SEED_TITLE || 'LAS 本地验收项目';
const DURATION = Number(process.env.LAS_SEED_SECONDS || 12);
const USERNAME = process.env.LAS_SEED_USERNAME;
const PASSWORD = process.env.LAS_SEED_PASSWORD;
const IMPORT_FILES = process.argv.slice(2);

function request(method, urlPath, { body, headers = {}, token } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ ...BASE, path: urlPath, method,
      headers: { ...(token ? { 'x-lmd-session': token } : {}), ...headers } },
      (res) => { const chunks = []; res.on('data', (d) => chunks.push(d)); res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, json: JSON.parse(text) }); } catch (_) { resolve({ status: res.statusCode, text }); }
      }); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function json(method, urlPath, payload, token) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  return request(method, urlPath, { body, token, headers: { 'content-type': 'application/json', 'content-length': body.byteLength } });
}

function multipart(filePath, fields) {
  const boundary = `----lasseed${Date.now()}`;
  const file = fs.readFileSync(filePath);
  const head = Object.entries(fields).map(([name, value]) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`).join('');
  const fileHead = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(filePath)}"\r\nContent-Type: video/mp4\r\n\r\n`;
  return { body: Buffer.concat([Buffer.from(head + fileHead, 'utf8'), file, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')]), boundary };
}

function generateClip() {
  const target = path.join(os.tmpdir(), `las-seed-${Date.now()}.mp4`);
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=0x1f3b8f:s=640x360:r=24:d=${DURATION}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${DURATION}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-crf', '28',
    '-c:a', 'aac', '-shortest', '-movflags', '+faststart', target], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg 生成失败：${result.stderr || result.stdout}`);
  return target;
}

function storageRoot() {
  const cfg = require('../src/config').loadConfig();
  const raw = cfg?.storage?.local_path || './data/storage';
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(process.cwd(), raw);
}

function probeVideo(file) {
  const { getFfprobePath } = require('../src/utils/ffmpegPath');
  const stdout = spawnSync(getFfprobePath(),
    ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).stdout;
  const info = JSON.parse(stdout);
  const video = (info.streams || []).find((stream) => stream.codec_type === 'video');
  const duration = Number(info.format?.duration);
  if (!video?.width || !video?.height || !Number.isFinite(duration) || duration <= 0) throw new Error(`无法读取视频规格：${file}`);
  return { duration, width: video.width, height: video.height };
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let read;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

async function login() {
  const res = await json('POST', '/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
  if (res.status !== 200) throw new Error(`登录失败 ${res.status}`);
  return res.json.data.token;
}

async function resolveProject(token) {
  const projects = await request('GET', '/api/v1/dramas?page_size=200', { token });
  const existing = (projects.json?.data?.items || projects.json?.data || []).find((row) => row.title === TITLE);
  if (existing) {
    console.log('project  复用   :', existing.id, TITLE);
    return existing.id;
  }
  const project = await json('POST', '/api/v1/dramas', { title: TITLE }, token);
  if (![200, 201].includes(project.status)) throw new Error(`创建项目失败 ${project.status} ${JSON.stringify(project.text || project.json)}`);
  console.log('project  新建   :', project.json.data.id, TITLE);
  return project.json.data.id;
}

async function importFile(token, dramaId, filePath) {
  const file = path.resolve(filePath);
  if (!fs.existsSync(file)) throw new Error(`文件不存在：${file}`);
  const stats = fs.statSync(file);
  const probe = probeVideo(file);
  const checksum = sha256File(file);
  const extension = path.extname(file).toLowerCase() || '.mp4';
  const relative = `imports/${checksum.slice(0, 12)}${extension}`;
  const target = path.join(storageRoot(), relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const listed = await request('GET', `/api/v1/assets?scope=project&drama_id=${dramaId}&type=video&page_size=200`, { token });
  const dup = (listed.json?.data?.items || []).find((row) => row.checksum === checksum);
  if (dup) { console.log('asset    已存在 :', dup.id, '|', path.basename(file)); return dup; }
  if (!fs.existsSync(target) || fs.statSync(target).size !== stats.size) {
    console.log('copy             :', `${path.basename(file)} (${(stats.size / 1024 / 1024).toFixed(1)} MB) → ${relative}`);
    fs.copyFileSync(file, target);
  } else {
    console.log('copy             : 跳过（storage 内已存在同哈希文件）');
  }
  const mime = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska', '.webm': 'video/webm' }[extension] || 'video/mp4';
  const created = await json('POST', '/api/v1/assets', {
    drama_id: dramaId, name: path.basename(file, path.extname(file)), type: 'video',
    local_path: relative, duration: Math.ceil(probe.duration), width: probe.width, height: probe.height,
    file_size: stats.size, mime_type: mime, checksum, source_type: 'upload',
  }, token);
  if (![200, 201].includes(created.status)) throw new Error(`登记素材失败 ${created.status} ${created.text || JSON.stringify(created.json)}`);
  const asset = created.json.data;
  console.log('asset            :', asset.id, `| ${probe.width}x${probe.height}`, `| ${probe.duration.toFixed(1)}s`);
  return asset;
}

(async () => {
  if (!USERNAME || !PASSWORD) throw new Error('请设置 LAS_SEED_USERNAME 和 LAS_SEED_PASSWORD');
  const token = await login();
  const dramaId = await resolveProject(token);

  if (IMPORT_FILES.length) {
    for (const file of IMPORT_FILES) await importFile(token, dramaId, file);
    const listed = await request('GET', `/api/v1/assets?scope=project&drama_id=${dramaId}&type=video&page_size=100`, { token });
    console.log('\n项目视频素材     :', (listed.json?.data?.items || []).map((row) => `${row.id}:${row.name}`).join(', ') || '(空)');
    console.log(`\n打开 http://127.0.0.1:${BASE.port === 5679 ? '3013' : BASE.port}/drama/${dramaId}?tab=viral 即可在「投流素材」里选用。`);
    return;
  }

  const clip = generateClip();
  console.log('clip             :', clip, `(${(fs.statSync(clip).size / 1024 / 1024).toFixed(2)} MB, ${DURATION}s)`);
  const part = multipart(clip, { drama_id: String(dramaId), name: `LAS 验收素材 ${DURATION}s` });
  const uploaded = await request('POST', '/api/v1/media/upload', {
    body: part.body, token,
    headers: { 'content-type': `multipart/form-data; boundary=${part.boundary}`, 'content-length': part.body.byteLength },
  });
  if (![200, 201].includes(uploaded.status)) throw new Error(`上传失败 ${uploaded.status} ${uploaded.text || JSON.stringify(uploaded.json)}`);
  const asset = uploaded.json.data.asset;
  console.log('asset            :', asset.id, '| type:', asset.type, '| local_path:', asset.local_path);
  console.log('probe            :', `${asset.width}x${asset.height}`, `${asset.duration}s`, '| 内容去重复用:', !!asset.deduplicated);

  const listed = await request('GET', `/api/v1/assets?scope=project&drama_id=${dramaId}&type=video&page_size=100`, { token });
  const visible = (listed.json?.data?.items || []).map((row) => `${row.id}:${row.name}`);
  console.log('LAS 下拉可见     :', visible.join(', ') || '(空)');

  console.log('\n清理：删除项目', dramaId, '即连带素材；或只删素材', asset.id);
  fs.rmSync(clip, { force: true });
})().catch((error) => { console.error('FAILED:', error.message); process.exitCode = 1; });
