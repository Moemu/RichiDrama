// 本地验收用：生成一段符合 LAS 门槛的测试视频，并通过项目 HTTP API 导入指定项目。
// 仅创建项目素材；不会提交付费 LAS 任务。
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BASE = { host: '127.0.0.1', port: Number(process.env.PORT || 5679) };
const TITLE = process.env.LAS_SEED_TITLE || 'LAS 本地验收项目';
const DURATION = Number(process.env.LAS_SEED_SECONDS || 12);
const USERNAME = process.env.LAS_SEED_USERNAME;
const PASSWORD = process.env.LAS_SEED_PASSWORD;

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

(async () => {
  if (!USERNAME || !PASSWORD) throw new Error('请设置 LAS_SEED_USERNAME 和 LAS_SEED_PASSWORD');
  const clip = generateClip();
  console.log('clip             :', clip, `(${(fs.statSync(clip).size / 1024 / 1024).toFixed(2)} MB, ${DURATION}s)`);

  const login = await json('POST', '/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
  if (login.status !== 200) throw new Error(`登录失败 ${login.status}`);
  const token = login.json.data.token;

  // 幂等：同名验收项目复用，不重复造壳。
  const projects = await request('GET', '/api/v1/dramas?page_size=200', { token });
  const existing = (projects.json?.data?.items || projects.json?.data || []).find((row) => row.title === TITLE);
  let dramaId;
  if (existing) {
    dramaId = existing.id;
    console.log('project  复用   :', dramaId, TITLE);
  } else {
    const project = await json('POST', '/api/v1/dramas', { title: TITLE }, token);
    if (![200, 201].includes(project.status)) throw new Error(`创建项目失败 ${project.status} ${JSON.stringify(project.text || project.json)}`);
    dramaId = project.json.data.id;
    console.log('project  新建   :', dramaId, TITLE);
  }

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
