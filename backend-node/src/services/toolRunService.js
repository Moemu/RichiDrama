'use strict';

const aiClient = require('./aiClient');
const storyGeneration = require('./storyGenerationService');
const dramaService = require('./dramaService');

const BUILTINS = [{ tool_type: 'script_analysis', name: '完整漫剧拆解', language: 'zh', content: '请完整拆解剧本：项目概览、剧集、角色、场景、道具、镜头建议，并只返回 JSON。' }];
const stamp = () => new Date().toISOString();
const parse = (value, fallback = {}) => { try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; } };
function row(row) { return row && { ...row, input: parse(row.input_json), output: parse(row.output_json, null), assets: [] }; }

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
    out = db.prepare('INSERT INTO tool_runs (tool_type,batch_id,title,model,language,status,input_json,owner_user_id,tenant_id,billing_authorization_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(body.tool_type, body.batch_id || null, body.title || '', body.model || null, body.language || 'zh', body.status || 'pending', JSON.stringify(input), body.owner_user_id || null, body.tenant_id || null, body.billing_authorization_id || null, now, now);
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
function settleBilling(db, run, actualUsage, providerRequestId) {
  if (!run?.owner_user_id || !run?.billing_authorization_id) return;
  try {
    const billing = require('./billingService');
    const auth = billing.getAuthorization(db, run.billing_authorization_id);
    const usage = require('./billingUsageService').textUsage(actualUsage);
    if (require('./billingUsageService').hasTokenMeter(auth?.snapshot) && !usage) {
      billing.markPendingReconciliation(db, { id: run.owner_user_id, role: 'admin' }, run.billing_authorization_id, {
        provider_request_id: providerRequestId,
        reason: '工具文本供应商成功响应但未返回实际 token 用量',
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
        observed_usage: require('./billingUsageService').textUsage(actualUsage) || undefined,
        reason: `工具文本结算无法匹配已冻结价目，等待核对供应商用量：${String(error.message || 'unknown error').slice(0, 180)}`,
      });
    } catch (_) {}
  }
}
function voidBilling(db, run, reason) { if (!run?.owner_user_id || !run?.billing_authorization_id) return; try { require('./billingService').voidAuthorization(db, { id: run.owner_user_id, role: 'admin' }, run.billing_authorization_id, reason); } catch (_) {} }
function set(db, id, values) { const old = get(db, id, true); if (!old) throw new Error('工具运行不存在'); const now = stamp(); db.prepare('UPDATE tool_runs SET status=?, output_json=?, streamed_text=?, error_msg=?, continuation_count=?, updated_at=?, completed_at=? WHERE id=?').run(values.status ?? old.status, values.output !== undefined ? JSON.stringify(values.output) : JSON.stringify(old.output), values.streamed_text ?? old.streamed_text, values.error_msg ?? null, values.continuation_count ?? old.continuation_count, now, values.status === 'completed' ? now : old.completed_at, old.id); const updated = get(db, id, true); if (values.status === 'completed') settleBilling(db, updated, values.billing_usage, values.provider_request_id); if (values.status === 'failed') voidBilling(db, updated, values.error_msg); return updated; }
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
async function executeAnalysis(db, log, id, onDelta) { const run = get(db,id,true); const input = run.input; set(db,id,{ status:'processing', streamed_text:'' }); let text=''; let providerUsage=null; let providerRequestId=null; try { text=await aiClient.streamGenerateText(db,log,'text',analysisPrompt(input),'你是专业漫剧策划与剧本分析师。', {model:run.model || undefined, tenant_id:run.tenant_id || undefined, temperature:.4, usage_callback:(usage, requestId)=>{providerUsage=usage;providerRequestId=requestId;}}, (delta)=>{ text+=delta; db.prepare('UPDATE tool_runs SET streamed_text=?,updated_at=? WHERE id=?').run(text,stamp(),id); if(onDelta) onDelta(delta); }); let output; try { output=JSON.parse(text.replace(/^```json\s*|```$/g,'').trim()); } catch (_) { output={ raw_json:text }; } return set(db,id,{status:'completed',output,streamed_text:text,billing_usage:providerUsage,provider_request_id:providerRequestId}); } catch(error) { set(db,id,{status:'failed',error_msg:error.message,streamed_text:text}); throw error; } }
async function executeStory(db, log, id) { const run=get(db,id,true); set(db,id,{status:'processing'}); try { const output=await storyGeneration.generateStory(db,log,{...run.input,model:run.model,tenant_id:run.tenant_id || undefined}); return set(db,id,{status:'completed',output}); } catch(error) { set(db,id,{status:'failed',error_msg:error.message}); throw error; } }
async function executeReverse(db, log, id) { const run=get(db,id,true); const asset=run.assets[0]; if(!asset) throw new Error('请选择要反推的素材'); set(db,id,{status:'processing'}); try { const path=require('path'); const cfg=require('../config').loadConfig(); const root=path.resolve(process.cwd(),cfg.storage?.local_path||'./data/storage'); const abs=asset.local_path?path.resolve(root,asset.local_path):null; const question=`按${run.language==='en'?'English':run.language==='bilingual'?'中英文双语':'中文'}输出：主体、构图、镜头、色彩光影、风格、负面约束和完整提示词。`; let result;
    if(asset.type==='image') result=await aiClient.generateTextWithVision(db,log,'vision',question,'你是视觉提示词分析师。',{localAbsPath:abs||undefined,imageUrl:asset.url},{model:run.model||undefined,tenant_id:run.tenant_id || undefined,max_tokens:1200});
    else if(asset.type==='video') { if(!abs) throw new Error('视频反推需要本地视频素材'); const fs=require('fs'); const {spawnSync}=require('child_process'); const {getFfmpegPath}=require('../utils/ffmpegPath'); const dir=path.join(root,'tool-reverse'); fs.mkdirSync(dir,{recursive:true}); const frames=['first','middle','last'].map((name,index)=>{const target=path.join(dir,`run-${id}-${name}.jpg`); const seek=index===0?'0':index===1?'50%':'99%'; const args=seek.endsWith('%')?['-y','-i',abs,'-vf',`select=eq(n\\,trunc(n*${index===1?0.5:0.99}))`,'-frames:v','1',target]:['-y','-ss',seek,'-i',abs,'-frames:v','1',target]; const made=spawnSync(getFfmpegPath(),args,{encoding:'utf8'}); if(made.status!==0||!fs.existsSync(target)) throw new Error('无法提取视频代表帧'); return target;}); const analyses=[]; for(const frame of frames) analyses.push(await aiClient.generateTextWithVision(db,log,'vision','描述该视频代表帧的画面、构图、镜头与风格。','你是视觉分析师。',{localAbsPath:frame},{model:run.model||undefined,tenant_id:run.tenant_id || undefined,max_tokens:500})); result=await aiClient.generateText(db,log,'text',`综合首、中、尾帧分析，重点说明运动、运镜、转场与完整提示词。\n${analyses.join('\n---\n')}`,'你是视频提示词分析师。',{model:run.model||undefined,tenant_id:run.tenant_id || undefined,temperature:.3,max_tokens:1400}); }
    else throw new Error('仅支持图片或视频素材反推'); return set(db,id,{status:'completed',output:{prompt:result}}); } catch(error){ set(db,id,{status:'failed',error_msg:error.message}); throw error; } }
function importDrama(db, log, id, body={}) { const run=get(db,id); if(!run) throw new Error('工具运行不存在'); const output=run.output || {}; const title=body.title || run.title || output.overview?.title || 'AI 导入项目'; const drama=dramaService.createDrama(db,log,{title,description:output.overview?.summary || '',owner_user_id:run.owner_user_id || null}); if(Array.isArray(output.episodes)) dramaService.saveEpisodes(db,log,drama.id,{episodes:output.episodes.map((ep,i)=>({episode_number:ep.episode_number || ep.episode || i+1,title:ep.title || `第${i+1}集`,script_content:ep.content || ep.script || ''}))}); return drama; }
module.exports={templates,createTemplate,updateTemplate,create,get,list,set,retryWithAuthorization,softDelete,restore,executeAnalysis,executeStory,executeReverse,importDrama,linkAssets};
