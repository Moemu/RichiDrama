const response = require('../response');
const toolRuns = require('../services/toolRunService');
function routes(db, log) {
  const sendError=(res,err)=>response.badRequest(res,err.message);
  return {
    templates:(req,res)=>{try{response.success(res,toolRuns.templates(db,req.query.tool_type));}catch(e){sendError(res,e)}},
    createTemplate:(req,res)=>{try{response.created(res,toolRuns.createTemplate(db,req.body||{}));}catch(e){sendError(res,e)}},
    updateTemplate:(req,res)=>{try{response.success(res,toolRuns.updateTemplate(db,req.params.id,req.body||{}));}catch(e){sendError(res,e)}},
    list:(req,res)=>{try{response.success(res,toolRuns.list(db,req.query));}catch(e){sendError(res,e)}},
    get:(req,res)=>{const item=toolRuns.get(db,req.params.id,true);return item?response.success(res,item):response.notFound(res,'工具运行不存在')},
    remove:(req,res)=>{try{toolRuns.softDelete(db,req.params.id);response.success(res,{ok:true})}catch(e){sendError(res,e)}},
    restore:(req,res)=>{try{response.success(res,toolRuns.restore(db,req.params.id))}catch(e){sendError(res,e)}},
    execute:(req,res)=>{try{const body=req.body||{};const run=toolRuns.create(db,{tool_type:req.params.type,title:body.title,model:body.model,language:body.language,input:body.input||body,assets:body.assets||[]}); const fn={script_analysis:toolRuns.executeAnalysis,script_analysis_stream:toolRuns.executeAnalysis,script_writing:toolRuns.executeStory,reverse_prompt:toolRuns.executeReverse}[run.tool_type]; if(!fn) return response.badRequest(res,'此工具请使用既有图片或视频生成接口'); setImmediate(()=>fn(db,log,run.id).catch(err=>log.error('tool run failed',{id:run.id,error:err.message}))); response.created(res,run);}catch(e){sendError(res,e)}},
    retry:(req,res)=>{try{const run=toolRuns.get(db,req.params.id,true);if(!run) return response.notFound(res,'工具运行不存在'); if(run.continuation_count>=2)return response.badRequest(res,'最多允许两次显式续写'); toolRuns.set(db,run.id,{status:'pending',continuation_count:run.continuation_count+1}); const fn={script_analysis:toolRuns.executeAnalysis,script_analysis_stream:toolRuns.executeAnalysis,script_writing:toolRuns.executeStory,reverse_prompt:toolRuns.executeReverse}[run.tool_type]; if(fn)setImmediate(()=>fn(db,log,run.id).catch(()=>{})); response.success(res,toolRuns.get(db,run.id,true));}catch(e){sendError(res,e)}},
    importDrama:(req,res)=>{try{response.created(res,toolRuns.importDrama(db,log,req.params.id,req.body||{}));}catch(e){sendError(res,e)}},
    stream:(req,res)=>{const id=Number(req.params.id);res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');let previous='';const timer=setInterval(()=>{const run=toolRuns.get(db,id,true);if(!run){res.write('event: error\ndata: {"message":"not found"}\n\n');clearInterval(timer);return res.end()}const text=run.streamed_text||'';if(text.length>previous.length){res.write(`event: delta\ndata: ${JSON.stringify({offset:previous.length,delta:text.slice(previous.length)})}\n\n`);previous=text}res.write(`event: status\ndata: ${JSON.stringify({status:run.status})}\n\n`);if(['completed','failed'].includes(run.status)){clearInterval(timer);res.end()}},500);req.on('close',()=>clearInterval(timer));},
  };
}
module.exports=routes;
