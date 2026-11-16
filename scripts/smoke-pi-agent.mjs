import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'sd-pi-smoke-'));
let requests = [];
let mode = 'tool';
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); requests.push(body);
  if (mode === 'error') { res.writeHead(429, {'content-type':'application/json'}); res.end(JSON.stringify({error:{type:'rate_limit_error',message:'offline rate limit'}})); return; }
  if (req.url === '/v1/chat/completions') {
    res.writeHead(200, {'content-type':'text/event-stream'});
    for (const delta of [{role:'assistant',content:'offline chat complete'}, {}]) res.write(`data: ${JSON.stringify({id:'chat_mock',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta,finish_reason:delta.content?null:'stop'}]})}\n\n`);
    res.end('data: [DONE]\n\n'); return;
  }
  if (req.url === '/v1/responses') {
    res.writeHead(200, {'content-type':'text/event-stream'});
    const item={id:'msg_response',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'offline response complete',annotations:[]}]};
    const output=[
      {type:'response.created',response:{id:'resp_mock',object:'response',status:'in_progress',output:[]}},
      {type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},
      {type:'response.content_part.added',item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},
      {type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:'offline response complete'},
      {type:'response.output_item.done',output_index:0,item},
      {type:'response.completed',response:{id:'resp_mock',object:'response',status:'completed',output:[item],usage:{input_tokens:32,output_tokens:12,total_tokens:44,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}},
    ];
    for(const data of output) res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
    res.end(); return;
  }
  const tool = mode === 'tool' && !body.messages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'tool_result'));
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({type, ...data})}\n\n`);
  event('message_start', {message:{id:'msg_mock',type:'message',role:'assistant',model:'mock',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:32,output_tokens:0}}});
  const content = tool ? {type:'tool_use',id:'tool_smoke_1',name:'render_stills',input:{}} : {type:'text',text:''};
  event('content_block_start',{index:0,content_block:content});
  event('content_block_delta',{index:0,delta:tool ? {type:'input_json_delta',partial_json:'{"times":[0]}'} : {type:'text_delta',text: mode === 'compact' ? 'Offline compaction summary: rendered preview successfully.' : 'offline complete'}});
  event('content_block_stop',{index:0});
  event('message_delta',{delta:{stop_reason:tool ? 'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:12}});
  event('message_stop',{}); res.end();
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const config = {cwd:directory,sessionDir:path.join(directory,'session'),gatewayBaseUrl:`http://127.0.0.1:${server.address().port}`,gatewayToken:'offline-only',modelId:'mock',images:true,tools:[{name:'render_stills',description:'Offline preview',parameters:{type:'object',properties:{times:{type:'array',items:{type:'number'}}},required:['times']}}]};
const children = [];
function launch() {
  const child = fork(path.join(root,'services/pi-agent-worker/dist/worker.mjs'),[],{execPath:process.execPath,execArgv:[],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','inherit','inherit','ipc']});
  children.push(child);
  let sequence=0;
  const waiting=new Map(); const events=[]; let toolCalls=0;
  child.on('message',message=>{
    if(message.type==='tool') { toolCalls++; child.send({type:'tool_result',toolCallId:message.toolCallId,result:{content:[{type:'text',text:'preview ready'},{type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6nWQAAAAASUVORK5CYII='}]}}); }
    if(message.type==='event') events.push(message.event);
    if(message.id && waiting.has(message.id)){ const {resolve,reject,timer}=waiting.get(message.id); clearTimeout(timer); waiting.delete(message.id); message.type==='error'?reject(new Error(message.error)):resolve(message); }
  });
  return {child,events,get toolCalls(){return toolCalls;},request(type,extra={}){return new Promise((resolve,reject)=>{const id=String(++sequence);const timer=setTimeout(()=>reject(new Error(`timeout ${type}`)),30000);waiting.set(id,{resolve,reject,timer});child.send({id,type,...extra});});}};
}
try {
  const coldStartAt=performance.now();
  const first=launch(); const started=await first.request('start',{config});
  const coldStartMs=Math.round(performance.now()-coldStartAt);
  await first.request('prompt',{text:'Render one frame. ' + 'Offline scene context with timing and composition details. '.repeat(4000)});
  assert.equal(first.toolCalls,1); assert.equal(requests.length,2,'tool roundtrip uses two requests');
  assert.ok(requests[1].messages.some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type==='tool_result' && c.content.some(x=>x.type==='image'))),'image tool result reaches provider');
  assert.ok(first.events.some(e=>e.type==='tool_execution_end'));
  await first.request('shutdown');
  const second=launch(); await second.request('start',{config:{...config,sessionFile:started.sessionFile},restore:true});
  mode='text'; await second.request('prompt',{text:'Continue after restart. ' + 'Recent scene details remain in context. '.repeat(4000)});
  assert.equal(requests.length,3); assert.equal(second.toolCalls,0,'restore does not replay tools');
  assert.ok(requests[2].messages.length>=4,'restored conversation reaches provider');
  mode='compact'; await second.request('compact'); assert.equal(requests.length,4,'compaction makes one gateway request');
  mode='error'; await second.request('prompt',{text:'Test rate limit without retry.'});
  assert.equal(requests.length,5,'rate limit is not retried');
  assert.ok(!second.events.some(e=>e.type==='auto_retry_start'));
  await second.request('shutdown');
  mode='text';
  for(const api of ['openai-completions','openai-responses']) {
    const adapter=launch();
    await adapter.request('start',{config:{...config,api,gatewayBaseUrl:config.gatewayBaseUrl+'/v1',sessionDir:path.join(directory,api)}});
    const before=requests.length;
    await adapter.request('prompt',{text:'Hello offline adapter.'});
    assert.equal(requests.length,before+1,`${api} single request`);
    assert.ok(adapter.events.some(e=>e.type==='message_end' && e.message?.role==='assistant' && e.message.stopReason==='stop'),`${api} successful response`);
    await adapter.request('shutdown');
  }
  console.log(JSON.stringify({ok:true,sdk:'@earendil-works/pi-coding-agent@1.5.2',node:process.version,coldStartMs,requests:requests.length,checks:['real SDK session','host tool roundtrip','image result','session restore without replay','manual compaction','429 no retry','openai chat adapter','openai responses adapter']},null,2));
} finally {
  for(const child of children) if(child.exitCode===null) child.kill();
  await new Promise(resolve=>server.close(resolve));
  await rm(directory,{recursive:true,force:true});
}
