/**
 * TTS 语音合成服务
 * 支持多种 TTS 接口：minimax、edge-tts（本地）、通用 HTTP
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

/**
 * 使用 MiniMax T2A v2 合成语音
 */
async function synthesizeWithMinimax(text, voiceId, apiKey, groupId, model) {
  const body = JSON.stringify({
    model: model || 'speech-02-hd',
    text,
    stream: false,
    voice_setting: {
      voice_id: voiceId || 'female-shaonv',
      speed: 1.0,
      vol: 1.0,
      pitch: 0,
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1,
    },
  });
  const url = `https://api.minimax.chat/v1/t2a_v2?GroupId=${groupId}`;
  return new Promise((resolve, reject) => {
    const reqOpts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.request(urlObj, reqOpts, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`MiniMax TTS HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString()}`));
          return;
        }
        const data = JSON.parse(Buffer.concat(chunks).toString());
        if (data.base_resp?.status_code !== 0) {
          reject(new Error(`MiniMax TTS error: ${data.base_resp?.status_msg || 'unknown'}`));
          return;
        }
        const audioHex = data.data?.audio;
        if (!audioHex) { reject(new Error('MiniMax TTS 未返回音频')); return; }
        resolve(Buffer.from(audioHex, 'hex'));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * 使用 OpenAI TTS API 合成语音（兼容所有 OpenAI 格式的代理）
 * POST {base_url}/audio/speech  body: { model, input, voice, response_format, speed }
 */
async function synthesizeWithOpenai(text, voice, apiKey, baseUrl, model, speed) {
  const url = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/audio/speech';
  const body = JSON.stringify({
    model: model || 'tts-1',
    input: text,
    voice: voice || 'alloy',
    response_format: 'mp3',
    speed: speed || 1.0,
  });
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
    };
    const req = mod.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`OpenAI TTS HTTP ${res.statusCode}: ${buf.toString('utf-8').slice(0, 500)}`));
          return;
        }
        resolve(buf);
      });
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error('OpenAI TTS 请求超时')); }, 120000);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('close', () => clearTimeout(timer));
    req.write(body);
    req.end();
  });
}

/**
 * 使用豆包语音（火山引擎 TTS）并发合成接口合成语音
 * 参考 Go 版示例：POST {base_url}/api/v1/tts （或 settings.endpoint 指定的中间层路径）
 * 认证头格式为 "Bearer;{token}"（注意是分号），返回 code=3000 表示成功，data 为 base64 音频。
 * @param {string} text 待合成文本
 * @param {{ apiKey: string, baseUrl: string, settings?: object }} opts
 *   - settings.appid / settings.cluster 必填（火山引擎接入信息）
 *   - settings.voice_type 默认 BV001
 *   - settings.endpoint 覆盖请求路径（如 tts_middle_layer/tts），缺省 /api/v1/tts
 *   - settings.speed/volume/pitch 取值范围 1~100（火山要求），缺省 10
 */
function synthesizeWithDoubao(text, opts) {
  const settings = opts.settings || {};
  const appid = String(settings.appid || '').trim();
  const cluster = String(settings.cluster || '').trim();
  const token = opts.apiKey || settings.token || '';
  if (!appid || !cluster) {
    throw new Error('豆包语音 TTS 缺少 appid 或 cluster，请在「AI 配置」TTS 配置的 settings 中填写 { appid, cluster, voice_type }');
  }
  if (!token) {
    throw new Error('豆包语音 TTS 缺少 Access Token（api_key）');
  }
  const endpoint = String(settings.endpoint || '/api/v1/tts');
  const base = (opts.baseUrl || 'https://openspeech.bytedance.com').replace(/\/+$/, '');
  const url = base + (endpoint.startsWith('/') ? endpoint : '/' + endpoint);
  // 火山并发合成要求 speed/volume/pitch 范围 [1,100]，缺省 10
  const clampVolc = (v, dflt) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.max(1, Math.min(100, Math.round(n)));
  };
  const body = JSON.stringify({
    app: { appid, token: 'access_token', cluster },
    user: { uid: 'LocalMiniDrama' },
    audio: {
      voice_type: settings.voice_type || 'BV001',
      encoding: settings.encoding || 'mp3',
      speed: clampVolc(settings.speed, 10),
      volume: clampVolc(settings.volume, 10),
      pitch: clampVolc(settings.pitch, 10),
    },
    request: {
      reqid: randomUUID(),
      text,
      text_type: 'plain',
      operation: 'query',
    },
  });
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        // 豆包特有：Bearer 后面是分号，不是空格
        'Authorization': `Bearer;${token}`,
      },
    };
    const req = mod.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`豆包 TTS HTTP ${res.statusCode}: ${buf.toString('utf-8').slice(0, 500)}`));
          return;
        }
        let data;
        try {
          data = JSON.parse(buf.toString('utf-8'));
        } catch (e) {
          reject(new Error(`豆包 TTS 返回非 JSON: ${buf.toString('utf-8').slice(0, 200)}`));
          return;
        }
        if (data.code !== 3000) {
          reject(new Error(`豆包 TTS 合成失败 [code:${data.code}] ${data.Message || data.message || ''}`));
          return;
        }
        const audioHex = data.data;
        if (!audioHex) { reject(new Error('豆包 TTS 未返回音频数据')); return; }
        // data 是 base64 编码的音频
        resolve(Buffer.from(audioHex, 'base64'));
      });
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error('豆包 TTS 请求超时')); }, 30000);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('close', () => clearTimeout(timer));
    req.write(body);
    req.end();
  });
}

/**
 * 合成 TTS 并保存到本地文件
 * @returns {{ local_path: string, audio_url: string }}
 */
async function synthesize(db, log, { text, storyboard_id, config, storage_base, voice_id, speed, billing_actor, billing_reference }) {
  if (!text || !text.trim()) throw new Error('text 不能为空');
  const aiConfigService = require('./aiConfigService');
  const ttsConfig = config || (() => {
    const configs = aiConfigService.listConfigs(db, 'tts');
    const active = configs.filter((c) => c.is_active);
    return active.find((c) => c.is_default) || active[0];
  })();
  if (!ttsConfig) throw new Error('未配置 TTS 模型，请在「AI 配置」中添加 service_type=tts 的配置');

  const provider = (ttsConfig.provider || '').toLowerCase();
  let ttsSettings = {};
  try { ttsSettings = JSON.parse(ttsConfig.settings || '{}'); } catch (_) {}
  // 外部传入的 voice_id / speed 优先（海外化场景），否则取配置值
  const voiceId = voice_id || ttsConfig.voice_id || ttsSettings.voice_id || '';
  const groupId = ttsConfig.group_id || ttsSettings.group_id || '';
  const ttsModel = ttsConfig.default_model || (Array.isArray(ttsConfig.model) ? ttsConfig.model[0] : ttsConfig.model) || '';
  const finalSpeed = speed || ttsSettings.speed || 1.0;
  // TTS providers bill text characters, which are known exactly before the
  // request.  Reserve and settle the same Unicode character count; on every
  // provider or persistence failure the reservation is released.
  let billingAuthorization = null;
  let billingActor = billing_actor || null;
  if (!billingActor && storyboard_id) {
    const owner = db.prepare('SELECT d.owner_user_id FROM storyboards s JOIN dramas d ON d.id=s.drama_id WHERE s.id=?').get(Number(storyboard_id));
    if (owner?.owner_user_id) billingActor = { id: owner.owner_user_id, role: 'user' };
  }
  const billingTarget = aiConfigService.resolveBillingTarget(db, 'tts', ttsModel, ttsConfig.id);
  const billing = require('./billingService');
  if (!billingActor?.id) throw new Error('无法确定 TTS 计费账号');
  const meters = billing.activeMeters(db, billingActor, 'tts', billingTarget.billing_key);
  if (!meters.includes('character')) throw new Error(`TTS 模型 ${billingTarget.billing_key} 未配置按字符价格，已拒绝调用`);
  const characters = require('./billingUsageService').unicodeCharacterCount(text);
  billingAuthorization = billing.createAuthorization(db, billingActor, {
    idempotency_key: `tts:${billingActor.id}:${randomUUID()}`,
    service_type: 'tts', model: billingTarget.billing_key, usage: { character: characters },
    reference_type: billing_reference?.type || 'tts', reference_id: billing_reference?.id || storyboard_id || null,
  });
  let audioBuffer;

  try {
  if (provider === 'minimax') {
    audioBuffer = await synthesizeWithMinimax(
      text,
      voiceId || 'female-shaonv',
      ttsConfig.api_key,
      groupId,
      ttsModel || 'speech-02-hd'
    );
  } else if (provider === 'doubao' || provider === '豆包语音' || provider === 'volcengine_tts') {
    // 豆包语音（火山引擎 TTS）：必须在 openai/base_url 分支之前判断，否则会被当作 OpenAI 兼容接口导致 404
    audioBuffer = await synthesizeWithDoubao(text, {
      apiKey: ttsConfig.api_key,
      baseUrl: ttsConfig.base_url,
      settings: ttsSettings,
    });
  } else if (provider === 'openai' || ttsConfig.base_url) {
    console.log('==c sxy synthesizeWithOpenai', text, voiceId, ttsConfig.api_key, ttsConfig.base_url, ttsModel, finalSpeed);
    audioBuffer = await synthesizeWithOpenai(
      text,
      voiceId || 'alloy',
      ttsConfig.api_key,
      ttsConfig.base_url,
      ttsModel || 'tts-1',
      finalSpeed
    );
  } else {
    throw new Error(`不支持的 TTS provider: ${provider}，目前支持 openai、minimax、doubao(豆包语音)`);
  }

  billing.settleAuthorization(db, billingActor, billingAuthorization.authorization_id, {
    usage: { character: characters }, provider_request_id: `tts:${billingAuthorization.authorization_id}`,
  });

  // 保存到本地
  const audioDir = path.join(storage_base, 'audio');
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  const filename = `tts_sb${storyboard_id || 'x'}_${randomUUID().slice(0, 8)}.mp3`;
  const filePath = path.join(audioDir, filename);
  fs.writeFileSync(filePath, audioBuffer);
  const localPath = `audio/${filename}`;
  log.info('[TTS] 合成完成', { storyboard_id, local_path: localPath, provider });
  try { const cs = require('./cloudService'); cs.reportUsage('tts', ttsModel || '', '', 0); } catch (_) {}
  return { local_path: localPath, billed_characters: characters };
  } catch (error) {
    if (billingAuthorization) {
      try { billing.voidAuthorization(db, billingActor, billingAuthorization.authorization_id, error.message); } catch (_) {}
    }
    throw error;
  }
}

module.exports = { synthesize };
