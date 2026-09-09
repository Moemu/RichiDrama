'use strict';

const aiClient = require('./aiClient');
const storyGeneration = require('./storyGenerationService');
const dramaService = require('./dramaService');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const { getFfmpegPath, getFfprobePath } = require('../utils/ffmpegPath');
const { resolveStorageFile } = require('../utils/storagePath');
const billingRequestContext = require('./billingRequestContext');
const billingUsage = require('./billingUsageService');

const BUILTINS = [{ tool_type: 'script_analysis', name: '完整漫剧拆解', language: 'zh', content: '请完整拆解剧本：项目概览、剧集、角色、场景、道具、镜头建议，并只返回 JSON。' }];
const stamp = () => new Date().toISOString();
const parse = (value, fallback = {}) => { try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; } };
function row(row) { return row && { ...row, input: parse(row.input_json), output: parse(row.output_json, null), assets: [] }; }

function mergeUsageValue(current, incoming) {
  if (!incoming || typeof incoming !== 'object') return current;
  const normalized = billingUsage.textUsage({
    ...incoming,
    prompt_tokens: incoming.prompt_tokens ?? incoming.input_tokens ?? incoming.input_token_count ?? incoming.input_token,
    completion_tokens: incoming.completion_tokens ?? incoming.output_tokens ?? incoming.output_token_count ?? incoming.output_token,
  });
  if (!normalized) return current;
  const result = { ...(current || {}) };
  for (const [meter, quantity] of Object.entries(normalized)) result[meter] = (result[meter] || 0) + quantity;
  return result;
}

function createUsageCollector() {
  // A tool run owns one authorization.  The request meter is charged once,
  // while token meters are accumulated from every provider response.
  let usage = { request: 1 };
  const requestIds = [];
  const responseUsages = [];
  return {
    record(rawUsage, providerRequestId) {
      const requestId = providerRequestId ? String(providerRequestId) : null;
      const normalized = billingUsage.textUsage({
        ...rawUsage,
        prompt_tokens: rawUsage?.prompt_tokens ?? rawUsage?.input_tokens ?? rawUsage?.input_token_count ?? rawUsage?.input_token,
        completion_tokens: rawUsage?.completion_tokens ?? rawUsage?.output_tokens ?? rawUsage?.output_token_count ?? rawUsage?.output_token,
      });
      responseUsages.push(normalized);
      usage = mergeUsageValue(usage, rawUsage);
      if (requestId && !requestIds.includes(requestId)) requestIds.push(requestId);
    },
    get usage() { return usage; },
    get responseUsages() { return responseUsages.slice(); },
    get providerRequestId() { return requestIds.join(',') || null; },
  };
}

function disableToolRunAutoBilling() {
  // The tool route already created one project-scoped authorization.  Nested
  // aiClient calls must not create a second authorization for the same run.
  billingRequestContext.disableAutoBilling();
}

function parseVideoProbe(stdout) {
  try {
    const parsed = JSON.parse(String(stdout || '{}'));
    const stream = parsed.streams?.[0] || {};
    const duration = [stream.duration, parsed.format?.duration]
      .map((value) => Number(value))
      .find((value) => Number.isFinite(value) && value > 0);
    const [numerator, denominator] = String(stream.avg_frame_rate || '').split('/').map(Number);
    const frameRate = Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
      ? numerator / denominator : null;
    if (duration != null) return { duration, frameRate };
  } catch (_) {}
  return null;
}

const MEDIA_PROCESS_TIMEOUT_MS = 30_000;

function runMediaProcess(command, args, timeoutMs = MEDIA_PROCESS_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
      finish(reject, new Error(`媒体处理超时（${timeoutMs}ms）`));
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => stdout.push(chunk));
    child.stderr?.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => finish(reject, error));
    child.on('close', (code, signal) => finish(resolve, {
      code,
      signal,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

function assertWithinStorage(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('临时帧路径超出存储目录');
}

function realStorageRoot(storageRoot) {
  const root = path.resolve(storageRoot);
  fs.mkdirSync(root, { recursive: true });
  return fs.realpathSync(root);
}

function safeTemporaryFramePath(root, runId, name) {
  const dir = path.join(root, 'tool-reverse');
  fs.mkdirSync(dir, { recursive: true });
  const realDir = fs.realpathSync(dir);
  assertWithinStorage(root, realDir);
  const target = path.join(realDir, `run-${runId}-${randomUUID()}-${name}.jpg`);
  assertWithinStorage(root, target);
  return target;
}

async function probeVideo(videoPath, timeoutMs = MEDIA_PROCESS_TIMEOUT_MS) {
  const result = await runMediaProcess(getFfprobePath(), [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=duration,avg_frame_rate:format=duration',
    '-of', 'json', videoPath,
  ], timeoutMs);
  if (result.code !== 0) throw new Error(`无法读取视频时长${result.stderr ? `：${result.stderr.slice(0, 180)}` : ''}`);
  return parseVideoProbe(result.stdout) || (() => { throw new Error('无法读取视频时长'); })();
}

async function extractVideoFrames(videoPath, storageRoot, runId, createdPaths = [], options = {}) {
  const root = realStorageRoot(storageRoot);
  const input = resolveStorageFile(root, videoPath);
  const dir = path.join(root, 'tool-reverse');
  fs.mkdirSync(dir, { recursive: true });
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs) : MEDIA_PROCESS_TIMEOUT_MS;
  const probe = await probeVideo(input, timeoutMs);
  const duration = probe.duration;
  const tailOffset = probe.frameRate && probe.frameRate > 0
    ? Math.max(0.05, 2 / probe.frameRate)
    : Math.max(0.2, duration / 20);
  const times = [0, duration / 2, Math.max(0, duration - tailOffset)];
  const names = ['first', 'middle', 'last'];
  const frames = [];
  for (const [position, name] of names.entries()) {
    const target = safeTemporaryFramePath(root, runId, name);
    createdPaths.push(target);
    const made = await runMediaProcess(getFfmpegPath(), [
      '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(times[position]),
      '-i', input, '-vf', 'format=yuvj420p', '-frames:v', '1', '-q:v', '2', target,
    ], timeoutMs);
    if (made.code !== 0 || !fs.existsSync(target)) {
      throw new Error(`无法提取视频代表帧（code=${made.code}, signal=${made.signal || ''}, target=${target}）${made.stderr ? `：${made.stderr.slice(0, 180)}` : ''}`);
    }
    frames.push(target);
  }
  return frames;
}

function cleanupTemporaryFrames(storageRoot, paths) {
  let root;
  try {
    root = realStorageRoot(storageRoot);
  } catch (_) {
    return;
  }
  for (const target of new Set(paths || [])) {
    try {
      const absolute = path.resolve(target);
      assertWithinStorage(root, absolute);
      if (!fs.existsSync(absolute)) continue;
      const realTarget = fs.realpathSync(absolute);
      assertWithinStorage(root, realTarget);
      if (fs.lstatSync(absolute).isSymbolicLink()) continue;
      fs.unlinkSync(absolute);
    } catch (_) {
      // Cleanup is best effort. A failed cleanup must not turn a completed
      // provider call into a failed tool run.
    }
  }
}

function ensureBuiltins(db) {
  const insert = db.prepare('INSERT INTO tool_prompt_templates (tool_type,name,language,content,is_builtin,created_at,updated_at) VALUES (?,?,?,?,1,?,?)');
  BUILTINS.forEach((item) => {
    const found = db.prepare('SELECT id FROM tool_prompt_templates WHERE tool_type=? AND name=? AND is_builtin=1').get(item.tool_type, item.name);
    if (!found) insert.run(item.tool_type, item.name, item.language, item.content, stamp(), stamp());
  });
}
function templates(db, type) { ensureBuiltins(db); return db.prepare(`SELECT * FROM tool_prompt_templates WHERE deleted_at IS NULL ${type ? 'AND tool_type = ?' : ''} ORDER BY is_builtin DESC, updated_at DESC`).all(...(type ? [type] : [])); }
function createTemplate(db, body) {
  if (!String(body.tool_type || '').trim() || !String(body.name || '').trim() || !String(body.content || '').trim()) throw new Error('工具类型、模板名称和内容不能为空');
  const now = stamp(); const out = db.prepare('INSERT INTO tool_prompt_templates (tool_type,name,language,content,is_builtin,created_at,updated_at) VALUES (?,?,?,?,0,?,?)').run(body.tool_type, body.name.trim(), body.language || 'zh', body.content, now, now);
  return db.prepare('SELECT * FROM tool_prompt_templates WHERE id=?').get(out.lastInsertRowid);
}
function updateTemplate(db, id, body) {
  const old = db.prepare('SELECT * FROM tool_prompt_templates WHERE id=? AND deleted_at IS NULL').get(Number(id)); if (!old) throw new Error('模板不存在'); if (old.is_builtin) throw new Error('内置模板只读，请复制后编辑');
  db.prepare('UPDATE tool_prompt_templates SET name=?, language=?, content=?, updated_at=? WHERE id=?').run(body.name ?? old.name, body.language ?? old.language, body.content ?? old.content, stamp(), old.id);
  return db.prepare('SELECT * FROM tool_prompt_templates WHERE id=?').get(old.id);
}
function create(db, body) {
  const now = stamp(); const input = body.input || {};
  let out;
  try {
    out = db.prepare('INSERT INTO tool_runs (tool_type,batch_id,title,model,language,status,input_json,owner_user_id,tenant_id,drama_id,billing_authorization_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(body.tool_type, body.batch_id || null, body.title || '', body.model || null, body.language || 'zh', body.status || 'pending', JSON.stringify(input), body.owner_user_id || null, body.tenant_id || null, Number(body.drama_id) || null, body.billing_authorization_id || null, now, now);
  } catch (error) {
    if (!String(error.message || '').includes('owner_user_id')) throw error;
    // Kept for standalone tests and older embedded databases; app startup migration adds these columns.
    out = db.prepare('INSERT INTO tool_runs (tool_type,batch_id,title,model,language,status,input_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(body.tool_type, body.batch_id || null, body.title || '', body.model || null, body.language || 'zh', body.status || 'pending', JSON.stringify(input), now, now);
  }
  const id = Number(out.lastInsertRowid); linkAssets(db, id, body.assets || []); return get(db, id, true);
}
function linkAssets(db, runId, assets) {
  const insert = db.prepare('INSERT INTO tool_run_assets (tool_run_id,asset_id,ordinal,usage,snapshot_json,created_at) VALUES (?,?,?,?,?,?)');
  (assets || []).forEach((item, index) => insert.run(runId, Number(item.asset_id || item.id), index, item.usage || null, JSON.stringify(item), stamp()));
}
function get(db, id, includeDeleted = false) {
  const raw = db.prepare(`SELECT * FROM tool_runs WHERE id=? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`).get(Number(id)); if (!raw) return null;
  const result = row(raw); result.assets = db.prepare(`SELECT a.*, r.usage, r.ordinal FROM tool_run_assets r JOIN assets a ON a.id=r.asset_id WHERE r.tool_run_id=? ORDER BY r.ordinal`).all(result.id); return result;
}
function list(db, query = {}) { const deleted = query.deleted === '1' || query.deleted === true; const type = query.tool_type; const owner = query.owner_user_id; const args=[]; let sql=`SELECT * FROM tool_runs WHERE deleted_at ${deleted ? 'IS NOT NULL' : 'IS NULL'}`; if(type){sql+=' AND tool_type=?';args.push(type)} if(owner){sql+=' AND owner_user_id=?';args.push(Number(owner))} return db.prepare(sql+' ORDER BY updated_at DESC,id DESC').all(...args).map(row); }
function settleBilling(db, run, actualUsage, providerRequestId, responseUsages = null) {
  if (!run?.owner_user_id || !run?.billing_authorization_id) return;
  let tokenUsage = null;
  try {
    const billing = require('./billingService');
    const auth = billing.getAuthorization(db, run.billing_authorization_id);
    tokenUsage = billingUsage.textUsage(actualUsage);
    const requestMeter = Object.prototype.hasOwnProperty.call(auth?.snapshot?.usage || {}, 'request');
    const usage = tokenUsage
      ? { ...(requestMeter || actualUsage?.request ? { request: 1 } : {}), ...tokenUsage }
      : (requestMeter || actualUsage?.request ? { request: 1 } : null);
    if (!billingUsage.hasCompleteTextUsage(auth?.snapshot, tokenUsage, responseUsages)) {
      billing.markPendingReconciliation(db, { id: run.owner_user_id, role: 'admin' }, run.billing_authorization_id, {
        provider_request_id: providerRequestId,
        observed_usage: tokenUsage || undefined,
        reason: '工具文本供应商成功响应但未返回完整 token 用量',
      });
      return;
    }
    billing.settleAuthorization(db, { id: run.owner_user_id, role: 'admin' }, run.billing_authorization_id, {
      usage: usage || auth.snapshot.usage, provider_request_id: providerRequestId || `tool-run:${run.id}:${run.continuation_count}`,
    });
  } catch (error) {
    try {
      require('./billingService').markPendingReconciliation(db, { id: run.owner_user_id, role: 'admin' }, run.billing_authorization_id, {
        provider_request_id: providerRequestId || `tool-run:${run.id}:${run.continuation_count}`,
        observed_usage: tokenUsage || undefined,
        reason: `工具文本结算无法匹配已冻结价目，等待核对供应商用量：${String(error.message || 'unknown error').slice(0, 180)}`,
      });
    } catch (_) {}
  }
}
function voidBilling(db, run, reason) { if (!run?.owner_user_id || !run?.billing_authorization_id) return; try { require('./billingService').voidAuthorization(db, { id: run.owner_user_id, role: 'admin' }, run.billing_authorization_id, reason); } catch (_) {} }
function set(db, id, values) {
  const old = get(db, id, true);
  if (!old) throw new Error('工具运行不存在');
  const now = stamp();
  db.prepare('UPDATE tool_runs SET status=?, output_json=?, streamed_text=?, error_msg=?, continuation_count=?, updated_at=?, completed_at=? WHERE id=?').run(
    values.status ?? old.status,
    values.output !== undefined ? JSON.stringify(values.output) : JSON.stringify(old.output),
    values.streamed_text ?? old.streamed_text,
    values.error_msg ?? null,
    values.continuation_count ?? old.continuation_count,
    now,
    values.status === 'completed' ? now : old.completed_at,
    old.id,
  );
  const updated = get(db, id, true);
  if (values.status === 'completed') {
    settleBilling(db, updated, values.billing_usage, values.provider_request_id, values.billing_usage_responses ?? null);
  }
  if (values.status === 'failed') voidBilling(db, updated, values.error_msg);
  return updated;
}
function retryWithAuthorization(db, id, authorizationId) {
  const old = get(db, id, true);
  if (!old) throw new Error('工具运行不存在');
  const now = stamp();
  db.prepare(`UPDATE tool_runs
    SET status='pending', output_json=NULL, streamed_text='', error_msg=NULL,
        billing_authorization_id=?, continuation_count=?, updated_at=?, completed_at=NULL
    WHERE id=?`).run(authorizationId, old.continuation_count + 1, now, old.id);
  return get(db, old.id, true);
}
function softDelete(db, id) { db.prepare('UPDATE tool_runs SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL').run(stamp(), stamp(), Number(id)); }
function restore(db, id) { db.prepare('UPDATE tool_runs SET deleted_at=NULL, updated_at=? WHERE id=?').run(stamp(), Number(id)); return get(db,id); }
function analysisPrompt(input) { return `${input.template || BUILTINS[0].content}\n语言：${input.language || '中文'}\n项目资料：${input.project_info || ''}\n剧本资料：${input.script || ''}\n返回字段：overview, episodes, characters, scenes, props, shots。`; }
async function executeAnalysis(db, log, id, onDelta) {
  const run = get(db, id, true);
  const input = run.input;
  disableToolRunAutoBilling();
  if (billingRequestContext.current()) billingRequestContext.current().cost_authorization_id = run.billing_authorization_id;
  set(db, id, { status: 'processing', streamed_text: '' });
  const usage = createUsageCollector();
  let text = '';
  try {
    text = await aiClient.streamGenerateText(
      db,
      log,
      'text',
      analysisPrompt(input),
      '你是专业漫剧策划与剧本分析师。',
      {
        model: run.model || undefined,
        tenant_id: run.tenant_id || undefined,
        temperature: .4,
        usage_callback: (providerUsage, providerRequestId) => usage.record(providerUsage, providerRequestId),
      },
      (delta) => {
        text += delta;
        db.prepare('UPDATE tool_runs SET streamed_text=?,updated_at=? WHERE id=?').run(text, stamp(), id);
        if (onDelta) onDelta(delta);
      },
    );
    let output;
    try {
      output = JSON.parse(text.replace(/^```json\s*|```$/g, '').trim());
    } catch (_) {
      output = { raw_json: text };
    }
    return set(db, id, {
      status: 'completed',
      output,
      streamed_text: text,
      billing_usage: usage.usage,
      billing_usage_responses: usage.responseUsages,
      provider_request_id: usage.providerRequestId,
    });
  } catch (error) {
    set(db, id, { status: 'failed', error_msg: error.message, streamed_text: text });
    throw error;
  }
}

async function executeStory(db, log, id) {
  const run = get(db, id, true);
  disableToolRunAutoBilling();
  if (billingRequestContext.current()) billingRequestContext.current().cost_authorization_id = run.billing_authorization_id;
  set(db, id, { status: 'processing' });
  const usage = createUsageCollector();
  try {
    const output = await storyGeneration.generateStory(db, log, {
      ...run.input,
      model: run.model,
      tenant_id: run.tenant_id || undefined,
      usage_callback: (providerUsage, providerRequestId) => usage.record(providerUsage, providerRequestId),
    });
    return set(db, id, {
      status: 'completed',
      output,
      billing_usage: usage.usage,
      billing_usage_responses: usage.responseUsages,
      provider_request_id: usage.providerRequestId,
    });
  } catch (error) {
    set(db, id, { status: 'failed', error_msg: error.message });
    throw error;
  }
}

async function executeReverse(db, log, id) {
  const run = get(db, id, true);
  const asset = run.assets[0];
  if (!asset) throw new Error('请选择要反推的素材');

  const cfg = billingRequestContext.current()?.cfg || require('../config').loadConfig();
  const root = path.resolve(process.cwd(), cfg.storage?.local_path || './data/storage');
  let abs = null;
  const usage = createUsageCollector();
  // The route-level tool authorization covers the complete reverse workflow.
  // Vision and final text calls only report usage to this collector.
  disableToolRunAutoBilling();
  if (billingRequestContext.current()) billingRequestContext.current().cost_authorization_id = run.billing_authorization_id;
  set(db, id, { status: 'processing' });

  const temporaryFrames = [];
  const callVision = (prompt, systemPrompt, imageSource, maxTokens) => {
    return aiClient.generateTextWithVision(
      db,
      log,
      'vision',
      prompt,
      systemPrompt,
      imageSource,
      {
        model: run.model || undefined,
        tenant_id: run.tenant_id || undefined,
        max_tokens: maxTokens,
        usage_callback: (providerUsage, providerRequestId) => usage.record(providerUsage, providerRequestId),
      },
    );
  };
  const callText = (prompt, systemPrompt, options = {}) => {
    return aiClient.generateText(db, log, 'text', prompt, systemPrompt, {
      ...options,
      model: run.model || undefined,
      tenant_id: run.tenant_id || undefined,
      usage_callback: (providerUsage, providerRequestId) => usage.record(providerUsage, providerRequestId),
    });
  };

  try {
    abs = asset.local_path ? resolveStorageFile(root, asset.local_path) : null;
    const question = `按${run.language === 'en' ? 'English' : run.language === 'bilingual' ? '中英文双语' : '中文'}输出：主体、构图、镜头、色彩光影、风格、负面约束和完整提示词。`;
    let result;
    if (asset.type === 'image') {
      result = await callVision(
        question,
        '你是视觉提示词分析师。',
        { localAbsPath: abs || undefined, imageUrl: asset.url },
        1200,
      );
    } else if (asset.type === 'video') {
      if (!abs) throw new Error('视频反推需要本地视频素材');
      const frames = await extractVideoFrames(abs, root, id, temporaryFrames);
      const analyses = [];
      for (const frame of frames) {
        analyses.push(await callVision(
          '描述该视频代表帧的画面、构图、镜头与风格。',
          '你是视觉分析师。',
          { localAbsPath: frame },
          500,
        ));
      }
      result = await callText(
        `综合首、中、尾帧分析，重点说明运动、运镜、转场与完整提示词。\n${analyses.join('\n---\n')}`,
        '你是视频提示词分析师。',
        { temperature: .3, max_tokens: 1400 },
      );
    } else {
      throw new Error('仅支持图片或视频素材反推');
    }
    return set(db, id, {
      status: 'completed',
      output: { prompt: result },
      billing_usage: usage.usage,
      billing_usage_responses: usage.responseUsages,
      provider_request_id: usage.providerRequestId,
    });
  } catch (error) {
    set(db, id, { status: 'failed', error_msg: error.message });
    throw error;
  } finally {
    cleanupTemporaryFrames(root, temporaryFrames);
  }
}
function importDrama(db, log, id, body={}) { const run=get(db,id); if(!run) throw new Error('工具运行不存在'); const output=run.output || {}; const title=body.title || run.title || output.overview?.title || 'AI 导入项目'; const drama=dramaService.createDrama(db,log,{title,description:output.overview?.summary || '',owner_user_id:run.owner_user_id || null}); if(Array.isArray(output.episodes)) dramaService.saveEpisodes(db,log,drama.id,{episodes:output.episodes.map((ep,i)=>({episode_number:ep.episode_number || ep.episode || i+1,title:ep.title || `第${i+1}集`,script_content:ep.content || ep.script || ''}))}); return drama; }
module.exports = {
  templates,
  createTemplate,
  updateTemplate,
  create,
  get,
  list,
  set,
  retryWithAuthorization,
  softDelete,
  restore,
  executeAnalysis,
  executeStory,
  executeReverse,
  importDrama,
  linkAssets,
  // Exported for deterministic local media and billing tests. These helpers
  // do not change the public HTTP contract.
  createUsageCollector,
  extractVideoFrames,
  cleanupTemporaryFrames,
};
