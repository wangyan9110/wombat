import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
/** Synthetic native protocol only: no login, model work, or source-file execution. */
export async function nativeCodexFixture(dir: string) {
  const binary=path.join(dir,'codex.cjs'),mode=path.join(dir,'native-mode.json'),calls=path.join(dir,'native-calls.jsonl'),lifecycle=path.join(dir,'native-lifecycle.jsonl');
  const ws=createRequire(path.resolve('client/package.json')).resolve('ws');
  await writeFile(mode,JSON.stringify({kind:'blocked'}));await writeFile(calls,'');await writeFile(lifecycle,'');
  await writeFile(binary,`const {readFileSync,appendFileSync,writeFileSync}=require('node:fs');
const mode=JSON.parse(readFileSync(${JSON.stringify(mode)},'utf8'));let accountReads=0,hookReads=0;
appendFileSync(${JSON.stringify(lifecycle)},JSON.stringify({pid:process.pid,event:'spawn',proxy:process.argv.includes('proxy')})+'\\n');
process.once('SIGTERM',()=>process.exit(0));
process.once('exit',()=>appendFileSync(${JSON.stringify(lifecycle)},JSON.stringify({pid:process.pid,event:'exit'})+'\\n'));
if(process.argv.includes('--version')){console.log('codex-cli '+(mode.version||'0.160.0'));process.exit(0);}
if(process.argv.includes('daemon'))process.exit(0);
function reply(m){if(m.id==null)return null;appendFileSync(${JSON.stringify(calls)},JSON.stringify({method:m.method})+'\\n');let result={};
if(m.method==='hooks/list'){
 hookReads++;
 if(mode.mutateOnHookList&&hookReads===2)writeFileSync(mode.mutateOnHookList,mode.mutatedHookText);
 if(mode.hooksError)return {id:m.id,error:{code:-1,message:'Synthetic private error'}};
 result=hookReads===2&&mode.hooksAfter?mode.hooksAfter:mode.hooks||{data:[]};
}
if(m.method==='config/read')result={config:{model:mode.configModel||'synthetic-model',model_provider:mode.provider||'openai'},origins:{}};
if(m.method==='account/read')result={requiresOpenaiAuth:true,account:{type:'chatgpt',email:'synthetic@example.invalid',planType:'pro'},workspaceRouting:{chatgptAccountId:mode.kind==='switched'&&++accountReads>1?'account-b':'account-a'}};
if(m.method==='account/rateLimits/read'){
 if(mode.kind==='unknown')return {id:m.id,error:{code:-1,message:'Synthetic private error'}};
 const reset=Math.floor(Date.now()/1000)+(mode.kind==='expired'?-1:mode.resetAfter??3600);
 result={accountId:'account-a',ordinaryUsageAllowed:mode.kind==='available',rateLimitUpsell:['blocked','foreign','expired','switched'].includes(mode.kind)?{banner_type:'selected_model_limit',blocked_model_slug:mode.kind==='foreign'?'other-model':'synthetic-model',reset_at:reset}:null,rateLimitsByLimitId:{[mode.kind==='foreign'?'base_model_inference':'codex']:{normalModelSlug:mode.kind==='foreign'?'synthetic-model':null,primary:{usedPercent:mode.kind==='low'?92:mode.kind==='available'?20:100,windowDurationMins:17,resetsAt:reset},rateLimitReachedType:['blocked','foreign','expired','switched'].includes(mode.kind)?'rate_limit_reached':null}}};
}
if(m.method==='thread/start'&&mode.mutateOnStart)writeFileSync(mode.mutateOnStart,'changed after review');
if(m.method==='thread/start')result={cwd:m.params.cwd,model:mode.actualModel||'synthetic-model',modelProvider:mode.provider||'openai',thread:{id:'00000000-0000-4000-8000-000000000001',cwd:m.params.cwd}};
if(m.method==='thread/queue/add'){
 if(mode.queueBehavior==='rejected')return {id:m.id,error:{code:-1,message:'Synthetic private rejection'}};
 if(mode.queueBehavior==='disconnect')process.exit(0);
 result={queuedSubmission:{clientUserMessageId:mode.queueBehavior==='mismatch'?'different-message':m.params.clientUserMessageId}};
}
return {id:m.id,result};}
function respond(m,send){const result=reply(m);if(!result)return;const delay=m.method==='thread/queue/add'?mode.queueDelayMs:m.method==='thread/start'?mode.threadStartDelayMs:0;if(delay)setTimeout(()=>{appendFileSync(${JSON.stringify(lifecycle)},JSON.stringify({pid:process.pid,event:'delayedResponse',method:m.method})+'\\n');send(result);},delay);else send(result);}
if(process.argv.includes('proxy')){
 const {WebSocketServer}=require(${JSON.stringify(ws)}),{connect}=require('node:net');const server=new WebSocketServer({host:'127.0.0.1',port:0});server.on('connection',socket=>socket.on('message',row=>respond(JSON.parse(row),result=>socket.send(JSON.stringify(result)))));server.on('listening',()=>{const pipe=connect(server.address().port,'127.0.0.1');process.stdin.pipe(pipe);pipe.pipe(process.stdout);});
}else{let buffer='';process.stdin.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\\n'))>=0){const row=buffer.slice(0,end);buffer=buffer.slice(end+1);respond(JSON.parse(row),result=>console.log(JSON.stringify(result)));}});}
`);
  const waitForExit = async () => {
    const deadline = Date.now() + 3000;
    for (;;) {
      const events = (await readFile(lifecycle, 'utf8')).trim().split('\n').filter(Boolean).map(row => JSON.parse(row));
      if (events.filter(e => e.event === 'spawn').every(e => events.some(end => end.pid === e.pid && end.event === 'exit'))) return;
      if (Date.now() >= deadline) throw new Error('Synthetic native processes did not exit after product cleanup');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  return {binary,mode,calls,lifecycle,waitForExit};
}
