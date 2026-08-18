const response = require('../response');
const toolRuns = require('../services/toolRunService');
function routes(db, log) {
  const sendError=(res,err)=>response.badRequest(res,err.message);
  return {
    templates:(req,res)=>{try{response.success(res,toolRuns.templates(db,req.query.tool_type));}catch(e){sendError(res,e)}},
    createTemplate:(req,res)=>{try{response.created(res,toolRuns.createTemplate(db,req.body||{}));}catch(e){sendError(res,e)}},
    updateTemplate:(req,res)=>{try{response.success(res,toolRuns.updateTemplate(db,req.params.id,req.body||{}));}catch(e){sendError(res,e)}},
    list:(req,res)=>{try{response.success(res,toolRuns.list(db,{...req.query,owner_user_id:req.auth.role==='admin'?undefined:req.auth.id}));}catch(e){sendError(res,e)}},
    get:(req,res)=>{const item=toolRuns.get(db,req.params.id,true);return item?response.success(res,item):response.notFound(res,'工具运行不存在')},
    remove:(req,res)=>{try{toolRuns.softDelete(db,req.params.id);response.success(res,{ok:true})}catch(e){sendError(res,e)}},
    restore:(req,res)=>{try{response.success(res,toolRuns.restore(db,req.params.id))}catch(e){sendError(res,e)}},
    execute:(req,res)=>{
      try {
        const body=req.body||{};
        const idempotencyKey=String(body.idempotency_key||'').trim();
        if(!idempotencyKey) return response.badRequest(res,'工具运行请求缺少幂等键，请刷新后重试');
        const fn={script_analysis:toolRuns.executeAnalysis,script_analysis_stream:toolRuns.executeAnalysis,script_writing:toolRuns.executeStory,reverse_prompt:toolRuns.executeReverse}[req.params.type];
        if(!fn) return response.badRequest(res,'此工具请使用既有图片或视频生成接口');
        const assetIds=(body.assets||[]).map(item=>Number(item.asset_id||item.id)).filter(Boolean);
        if(req.auth.role!=='admin'&&assetIds.length){
          const owned=db.prepare(`SELECT COUNT(*) total FROM assets a LEFT JOIN dramas d ON d.id=a.drama_id WHERE a.id IN (${assetIds.map(()=>'?').join(',')}) AND a.deleted_at IS NULL AND COALESCE(d.owner_user_id,a.owner_user_id)=?`).get(...assetIds,req.auth.id);
          if(Number(owned.total)!==assetIds.length)return response.notFound(res,'素材不存在或无权访问');
        }
        const aiConfigs=require('../services/aiConfigService');
        const tenant=require('../services/tenantService').tenantForUser(db,req.auth.id);
        const scope=tenant ? {tenant_id:tenant.id} : {};
        const cfg=aiConfigs.listConfigs(db,'text',scope)[0];
        const model=body.model||cfg?.default_model||cfg?.model?.[0];
        if(!model) return response.badRequest(res,'请先在 AI 配置中启用文本模型');
        const billingTarget=aiConfigs.resolveBillingTarget(db,'text',model,null,scope);
        const billing=require('../services/billingService');
        const meters=billing.activeMeters(db,req.auth,'text',billingTarget.billing_key);
        const reserve=require('../services/billingUsageService').textReservation(JSON.stringify(body.input||body),8192);
        const usage={};
        if(meters.includes('request'))usage.request=1;
        if(meters.includes('input_token'))usage.input_token=reserve.input_token;
        if(meters.includes('output_token'))usage.output_token=reserve.output_token;
        if(!Object.keys(usage).length)return response.badRequest(res,'该文本模型未配置可用计费项');
        const authorization=billing.createAuthorization(db,req.auth,{idempotency_key:idempotencyKey,service_type:'text',model:billingTarget.billing_key,usage,reference_type:'tool_run'});
        const run=toolRuns.create(db,{tool_type:req.params.type,title:body.title,model,language:body.language,input:body.input||body,assets:body.assets||[],owner_user_id:req.auth.id,tenant_id:tenant?.id || null,billing_authorization_id:authorization.authorization_id});
        setImmediate(()=>fn(db,log,run.id).catch(err=>log.error('tool run failed',{id:run.id,error:err.message})));
        response.created(res,run);
      }catch(e){sendError(res,e)}
    },
    retry:(req,res)=>{try{const run=toolRuns.get(db,req.params.id,true);if(!run || (req.auth.role!=='admin'&&run.owner_user_id!==req.auth.id)) return response.notFound(res,'工具运行不存在'); if(run.continuation_count>=2)return response.badRequest(res,'最多允许两次显式续写'); const billing=require('../services/billingService'); const aiConfigs=require('../services/aiConfigService'); const scope=run.tenant_id ? {tenant_id:run.tenant_id} : {}; const billingTarget=aiConfigs.resolveBillingTarget(db,'text',run.model,null,scope); const meters=billing.activeMeters(db,req.auth,'text',billingTarget.billing_key); const reserve=require('../services/billingUsageService').textReservation(JSON.stringify(run.input||{}),8192); const usage={};if(meters.includes('request'))usage.request=1;if(meters.includes('input_token'))usage.input_token=reserve.input_token;if(meters.includes('output_token'))usage.output_token=reserve.output_token;if(!Object.keys(usage).length)return response.badRequest(res,'该文本模型未配置可用计费项'); const authorization=billing.createAuthorization(db,req.auth,{idempotency_key:`tool-retry:${req.auth.id}:${run.id}:${run.continuation_count+1}:${require('crypto').randomUUID()}`,service_type:'text',model:billingTarget.billing_key,usage,reference_type:'tool_run',reference_id:run.id}); const retried=toolRuns.retryWithAuthorization(db,run.id,authorization.authorization_id); const fn={script_analysis:toolRuns.executeAnalysis,script_analysis_stream:toolRuns.executeAnalysis,script_writing:toolRuns.executeStory,reverse_prompt:toolRuns.executeReverse}[run.tool_type]; if(fn)setImmediate(()=>fn(db,log,retried.id).catch(()=>{})); response.success(res,retried);}catch(e){sendError(res,e)}},
    importDrama:(req,res)=>{try{response.created(res,toolRuns.importDrama(db,log,req.params.id,req.body||{}));}catch(e){sendError(res,e)}},
    stream:(req,res)=>{const id=Number(req.params.id);res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');let previous='';const timer=setInterval(()=>{const run=toolRuns.get(db,id,true);if(!run){res.write('event: error\ndata: {"message":"not found"}\n\n');clearInterval(timer);return res.end()}const text=run.streamed_text||'';if(text.length>previous.length){res.write(`event: delta\ndata: ${JSON.stringify({offset:previous.length,delta:text.slice(previous.length)})}\n\n`);previous=text}res.write(`event: status\ndata: ${JSON.stringify({status:run.status})}\n\n`);if(['completed','failed'].includes(run.status)){clearInterval(timer);res.end()}},500);req.on('close',()=>clearInterval(timer));},
  };
}
module.exports=routes;
