const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();

function configuration(source = {}) {
  const region = String(source.region || 'cn-beijing').trim();
  const bucket = String(source.bucket || '').trim();
  const accessKeyId = String(source.accessKeyId || '').trim();
  const secretAccessKey = String(source.secretAccessKey || '').trim();
  if (!/^[a-z]+-[a-z]+(?:-\d+)?$/.test(region) || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
    || !accessKeyId || !secretAccessKey) throw new Error('未填写有效的 TOS 地域、Bucket 或受限读写凭证');
  return { region, bucket, accessKeyId, secretAccessKey, host: `${bucket}.tos-${region}.volces.com` };
}

function objectKey(jobId, kind, name) {
  if (!/^[a-f0-9-]{36}$/i.test(String(jobId)) || !['input', 'translate', 'inpaint'].includes(kind)
    || !/^[a-zA-Z0-9_.-]{1,80}$/.test(name) || name.startsWith('.')) throw new Error('LAS TOS 对象路径无效');
  return `richidrama/las/${jobId}/${kind}/${name}`;
}

function signedHeaders(config, method, key, payloadHash, contentType = '', at = new Date()) {
  if (!['GET', 'PUT', 'HEAD'].includes(method) || !/^richidrama\/las\/[\w./-]+$/.test(key) || key.includes('..')) throw new Error('LAS TOS 请求无效');
  const date = at.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = date.slice(0, 8);
  const scope = `${day}/${config.region}/tos/request`;
  const headers = { host: config.host, 'x-tos-content-sha256': payloadHash, 'x-tos-date': date };
  if (contentType) headers['content-type'] = contentType;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name].trim()}\n`).join('');
  const uri = '/' + key.split('/').map(encodeURIComponent).join('/');
  const canonical = [method, uri, '', canonicalHeaders, names.join(';'), payloadHash].join('\n');
  const stringToSign = ['TOS4-HMAC-SHA256', date, scope, hash(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(config.secretAccessKey, day), config.region), 'tos'), 'request');
  const signature = hmac(signingKey, stringToSign).toString('hex');
  headers.authorization = `TOS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope},SignedHeaders=${names.join(';')},Signature=${signature}`;
  return { uri, headers };
}

async function fileHash(file) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

function request(config, method, key, payloadHash, contentType, bodyFile, targetFile) {
  const signed = signedHeaders(config, method, key, payloadHash, contentType);
  const headers = { ...signed.headers };
  if (bodyFile) headers['content-length'] = fs.statSync(bodyFile).size;
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: config.host, path: signed.uri, method, headers, timeout: 120_000 }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`LAS TOS ${method} 失败：HTTP ${res.statusCode}`));
        return;
      }
      if (targetFile) {
        const temp = `${targetFile}.part`;
        pipeline(res, fs.createWriteStream(temp)).then(() => {
          if (!fs.statSync(temp).size) throw new Error('LAS TOS 下载文件为空');
          fs.renameSync(temp, targetFile);
          resolve({ bytes: fs.statSync(targetFile).size });
        }).catch((error) => { try { fs.unlinkSync(temp); } catch (_) {} reject(error); });
      } else {
        res.resume();
        res.on('end', () => resolve({ etag: res.headers.etag || null }));
      }
    });
    req.on('timeout', () => req.destroy(new Error('LAS TOS 请求超时')));
    req.on('error', reject);
    if (bodyFile) fs.createReadStream(bodyFile).on('error', (error) => req.destroy(error)).pipe(req);
    else req.end();
  });
}

async function upload(config, key, localFile, contentType = 'video/mp4') {
  const stats = fs.statSync(localFile);
  if (!stats.isFile() || stats.size <= 0 || stats.size > 5 * 1024 ** 3) throw new Error('LAS TOS 单文件上传仅支持 0–5GB');
  const digest = await fileHash(localFile);
  await request(config, 'PUT', key, digest, contentType, localFile, null);
  return `tos://${config.bucket}/${key}`;
}

async function download(config, tosPath, localFile) {
  const prefix = `tos://${config.bucket}/`;
  if (!String(tosPath).startsWith(prefix)) throw new Error('LAS 输出不在配置的 TOS Bucket 内');
  const key = tosPath.slice(prefix.length);
  if (!/^richidrama\/las\/[\w./-]+$/.test(key) || key.includes('..')) throw new Error('LAS 输出对象路径无效');
  fs.mkdirSync(path.dirname(localFile), { recursive: true });
  return request(config, 'GET', key, hash(''), '', null, localFile);
}

module.exports = { configuration, objectKey, signedHeaders, upload, download };
