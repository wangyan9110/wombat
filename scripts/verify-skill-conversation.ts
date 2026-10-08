/** Selected real native Codex conversations over independent synthetic truth; no trust mutation. */
import assert from 'node:assert/strict';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,cpSync,readdirSync,rmSync,realpathSync,existsSync,statSync} from 'node:fs';
import path from 'node:path';import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import type {UsageResult,OptimizeResult,AccountResult} from '@wombat/client';
import {parseConversationArgs,validateConversationAnswer,nativeSessionId} from './verify-skill-conversation-helpers.ts';
import {createNodeClient} from '@wombat/client/node';
import {startWebHost} from '@wombat/web';
import {createHttpClient} from '@wombat/client/http';
import {nativeCodexFixture} from '../tests/helpers/native-codex.ts';
import {assertExternalOutputDir,runBoundedCommand,terminateTree} from './verify-e2e-helpers.ts';
import {agentMetrics,stdoutFromLog} from './verify-agent-query.ts';
import {checkBuild,sourceIdentity} from './build-identity.ts';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),options=parseConversationArgs(process.argv.slice(2)),agentEnv={...process.env};
if(process.platform==='win32')throw new Error('POSIX conversation qualification is not accepted on Windows');
checkBuild(repo);
if(!statSync(options.agentBin).isFile())throw new Error('--agent-bin must identify an executable file');
const output=assertExternalOutputDir(repo,options.output);
if(existsSync(output)&&readdirSync(output).length)throw new Error('Choose a fresh empty external --output-dir; previous evidence is preserved');
mkdirSync(output,{recursive:true,mode:0o700});
interface CaseReport {language:string;status:string;[key:string]:unknown}
const report:{format:number;status:string;sourceSha256:string;platform:string;cases:CaseReport[];boundaries:string[];failure?:string;completedAt?:string}={format:1,status:'running',sourceSha256:sourceIdentity(repo),platform:process.platform+'-'+process.arch,cases:[],boundaries:['Synthetic usage, allowance protocol, configuration and edits only; real native model sessions use the unchanged user authentication profile without credential reads or copies. New sessions resume only by their returned IDs.','Web uses the real core and authenticated HTTP host; separate browser acceptance covers rendering.','No Hook trust changes or public publication; bilingual explanation checks establish selected synthetic tasks, not all real-project journeys.']};
const save=()=>writeFileSync(path.join(output,'conversations-report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});save();
const cancellation=new AbortController();
const cancel=()=>cancellation.abort();process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
const quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
try {for(const lang of options.languages){
 cancellation.signal.throwIfAborted();console.log(JSON.stringify({stage:'conversation',language:lang,status:'running'}));
 const temp=realpathSync(mkdtempSync(path.join(tmpdir(),`wombat-conversation-${lang}-`))),source=path.join(temp,'source'),project=path.join(temp,'project'),data=path.join(temp,'data'),runtime=path.join(temp,'runtime'),skill=path.join(project,'.agents/skills/wombat'),sample=path.join(project,'.agents/skills/sample/SKILL.md'),contextFile=path.join(project,'web-context.json');
 const saved=['CODEX_HOME','WOMBAT_DATA_HOME','WOMBAT_AUTO_PRICES'].map(k=>[k,process.env[k]] as const);let service:ChildProcess|undefined,host:Awaited<ReturnType<typeof startWebHost>>|undefined;let native:Awaited<ReturnType<typeof nativeCodexFixture>>|undefined;
 const result:CaseReport={language:lang,status:'running'};report.cases.push(result);save();
 try {
 mkdirSync(path.join(source,'sessions'),{recursive:true});mkdirSync(path.dirname(sample),{recursive:true});mkdirSync(runtime);
 cpSync(path.join(repo,'dist/skill/wombat'),skill,{recursive:true});
 for(const name of readdirSync(path.join(repo,'dist')).filter(n=>/^wombat(?:-.*)?\.js$/.test(n)))cpSync(path.join(repo,'dist',name),path.join(runtime,name));
 for(const name of ['wombat-core','web','skill'])cpSync(path.join(repo,'dist',name),path.join(runtime,name),{recursive:true});
 const original=`---\nname: sample\ndescription: ${'x'.repeat(501)}\n---\nUse the synthetic sample only.\n`,expected='---\nname: sample\ndescription: Synthetic review helper for this fixture.\n---\nUse the synthetic sample only.\n';writeFileSync(sample,original);
 const rows=[{type:'session_meta',payload:{id:'qualification',cwd:project}},{type:'turn_context',payload:{turn_id:'turn',model:'gpt-5.4'}},{type:'event_msg',payload:{type:'token_usage_record',thread_id:'qualification',turn_id:'turn',response_id:'response',usage:{input_tokens:1000000,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:100000,reasoning_output_tokens:0,total_tokens:1100000}}}].map(r=>({...r,timestamp:'2026-09-02T00:00:00Z'}));
 const sourceFile=path.join(source,'sessions/fixture.jsonl'),sourceBody=rows.map(r=>JSON.stringify(r)).join('\n')+'\n';writeFileSync(sourceFile,sourceBody);
 native=await nativeCodexFixture(temp);writeFileSync(native.mode,JSON.stringify({kind:'available',version:'0.160.1'}));
 Object.assign(process.env,{CODEX_HOME:source,WOMBAT_DATA_HOME:data,WOMBAT_AUTO_PRICES:'0'});
 const env={...agentEnv,CODEX_HOME:source,WOMBAT_DATA_HOME:data,WOMBAT_AUTO_PRICES:'0',WOMBAT_CODEX_BIN:native.binary,WOMBAT_CORE_BIN:''};
 service=spawn(path.join(runtime,'wombat-core'),['--serve-usage'],{cwd:project,env,stdio:'ignore',detached:true});await once(service,'spawn');
 const cli=path.join(runtime,'wombat.js');
 const query=<T extends UsageResult|OptimizeResult|AccountResult>(args:string[]):T=>{const r=spawnSync(process.execPath,[cli,...args,'--json'],{cwd:project,env,timeout:15000,maxBuffer:2*1024*1024,encoding:'utf8'});assert.ok([0,2].includes(r.status??-1),r.stderr+r.stdout);const v=JSON.parse(r.stdout);assert.ok(!(v&&typeof v==='object'&&'error' in v),r.stdout);return v as T;};
 const snapshot=query<UsageResult>(['refresh','--root',source]).snapshotRef.snapshotId,threads=query<UsageResult>(['threads','--snapshot',snapshot,'--all-time']),thread=threads.items.find(v=>v.kind==='thread'&&v.upstreamId==='qualification');assert.ok(thread&&thread.kind==='thread');
 const configArgs=['--root',source,'--project-root',project,'--project',project],suggestions=query<OptimizeResult>(['optimize',...configArgs]),suggestion=suggestions.suggestions.find(s=>s.item.path===sample);assert.ok(suggestion);assert.ok(suggestion.findings.some(f=>f.rule==='descriptionSize'));
 const account=query<AccountResult>(['account']);writeFileSync(path.join(output,lang+'-synthetic-account.json'),JSON.stringify(account,null,2),{mode:0o600});assert.ok(account.windows.some(w=>w.usedPercent===20&&w.durationMinutes===17));
 const prefix=`CODEX_HOME=${quote(source)} WOMBAT_DATA_HOME=${quote(data)} WOMBAT_AUTO_PRICES=0 WOMBAT_CODEX_BIN=${quote(native.binary)} node ${quote(cli)}`;
 const schema=(name:string,properties:Record<string,unknown>)=>{const file=path.join(temp,name+'.schema.json');writeFileSync(file,JSON.stringify({type:'object',additionalProperties:false,required:Object.keys(properties),properties}));return file;};
 const firstSchema=schema('first',{completeTokens:{type:'integer'},topTaskId:{type:'string'},remainingPercent:{type:'number'},windowMinutes:{type:'integer'},suggestionId:{type:'string'},contextFile:{type:'string'},explanation:{type:'string'}}),firstAnswer=path.join(temp,'first.answer.json');
 const question=lang==='zh'?'请用中文回答：全部日期用了多少 Token，哪项任务最高？额度还剩多少，窗口有多长？这个项目有什么配置问题？准备最高任务的 Web 详情上下文。先只读，不修改配置。':'Answer in English: Across all dates, how many Tokens and which task is highest? What allowance remains and what is its window length? What configuration needs attention in this project? Prepare Web detail context for the top task. Read only; do not modify configuration yet.';
 const boundary=` Use the Wombat Skill at ${skill}/SKILL.md and only its references, the runtime CLI and synthetic project files. Every runtime command MUST start with ${prefix}. Only query source ${source}, project ${project}, fixed snapshot ${snapshot}. Use actual returned IDs. Write the generated-contract Web context to ${contextFile}; do not start a Web listener yourself. Read no raw source logs, database, credentials or other user data. No other plugins, MCP, network tools or delegation. Return the required schema, describing limitations and configuration evidence without claiming financial savings.`;
 const run=async(stage:string,args:string[],answer:string)=>{console.log(JSON.stringify({stage,language:lang,status:'running'}));const log=path.join(output,`${lang}-${stage}.log`),r=await runBoundedCommand({command:[options.agentBin,...args],cwd:project,env:agentEnv,logFile:log,timeoutMs:360000,maxBytes:4*1024*1024,signal:cancellation.signal});assert.equal(r.exitCode,0,`${stage} did not complete`);assert.ok(!r.timedOut&&!r.outputLimit&&!r.interrupted&&!r.closeTimedOut&&!r.spawnError&&!r.logError);const events=stdoutFromLog(readFileSync(log,'utf8')),metrics=agentMetrics(events);assert.equal(metrics.unsupportedToolCalls,0);assert.ok(metrics.commands.some(c=>c.includes(cli)));return {answer:JSON.parse(readFileSync(answer,'utf8')),events,metrics};};
 const first=await run('read',['exec','--config','mcp_servers={}','--sandbox','workspace-write','--skip-git-repo-check','--cd',project,'--json','--output-schema',firstSchema,'--output-last-message',firstAnswer,question+boundary],firstAnswer);
 const expectedAnswer={threadId:thread.id,suggestionId:suggestion.id,contextFile};
 validateConversationAnswer(first.answer,'read',expectedAnswer,lang);assert.equal(readFileSync(sample,'utf8'),original);
 const session=nativeSessionId(first.events);
 const client=createNodeClient({binaryPath:path.join(runtime,'wombat-core'),codexBinaryPath:native.binary,automaticPrices:false});
 host=await startWebHost({client,roots:[source],projectRoots:[project],assets:path.join(runtime,'web'),automaticPrices:false,locale:lang as 'zh'|'en'});
 const opened=await host.openView(JSON.parse(readFileSync(contextFile,'utf8')));assert.equal(opened.context.usage?.snapshotId,snapshot);assert.equal(opened.context.usage?.threadId,thread.id);assert.equal(opened.context.usage?.scope?.project,project);assert.equal(opened.context.usage?.scope?.allTime,true);
 const token=new URLSearchParams(new URL(opened.url).hash.slice(1)).get('token')!;const browser=createHttpClient({origin:host.origin,token,fetch:(u,i)=>fetch(u,{...i,headers:{...i?.headers,Origin:host!.origin}})});
 const reread=await browser.query({action:'usage',snapshotId:snapshot,scope:{allTime:true,project}});assert.equal(reread.summary.tokens.total,1100000);
 await host.close();host=undefined;
 const secondSchema=schema('second',{completeTokens:{type:'integer'},topTaskId:{type:'string'},suggestionId:{type:'string'},recheckStatus:{type:'string'},decision:{type:['string','null']},explanation:{type:'string'}}),secondAnswer=path.join(temp,'second.answer.json');
 const follow=lang==='zh'?'继续刚才那项任务。Web 已核对同一版本与项目，Token 总量仍为 1100000。现在授权你只把指定合成 Skill 的 description 改为 Synthetic review helper for this fixture.，保留 name、正文和其他文件，随后用原建议 ID 复查。不要设置保留或不适用决定。中文说明实际修改、复查结果和限制。':'Continue the same task. Web confirmed the same version and project, with 1100000 Tokens. You are now authorized to change ONLY the specified synthetic Skill description to Synthetic review helper for this fixture., preserving its name, body and all other files, then recheck the original suggestion ID. Do not set keep/not-applicable decisions. Explain the actual edit, recheck and limits in English.';
 const second=await run('continue',['exec','resume',session,'--config','mcp_servers={}','--skip-git-repo-check','--json','--output-schema',secondSchema,'--output-last-message',secondAnswer,follow+` Target ${sample}; suggestion ${suggestion.id}; snapshot ${snapshot}; thread ${thread.id}.`+boundary],secondAnswer);
 validateConversationAnswer(second.answer,'continue',expectedAnswer,lang);assert.equal(readFileSync(sample,'utf8'),expected);assert.equal(readFileSync(sourceFile,'utf8'),sourceBody);
 const history=query<OptimizeResult>(['optimize','history','--suggestion',suggestion.id,...configArgs]),checked=history.suggestions.find(s=>s.id===suggestion.id);assert.ok(checked);assert.equal(checked.status,'verified');assert.equal(checked.decision,null);assert.equal(query<UsageResult>(['usage','--snapshot',snapshot,'--all-time']).summary.tokens.total,1100000);
 result.status='passed';result.sessionId=session;result.read={answer:first.answer,metrics:first.metrics};result.followup={answer:second.answer,metrics:second.metrics};result.web={sameSnapshot:true,sameThread:true,sameProject:true,language:lang};result.checks={sourceUnchanged:true,descriptionOnly:true,userDecisionUnchanged:true,independentRecheck:'verified'};save();
 }catch(e){result.status='failed';result.failure=e instanceof Error?e.message:String(e);save();throw e;}
 finally {try {await host?.close();if(service&&service.exitCode===null&&service.signalCode===null&&!await terminateTree(service)){report.status='failed';report.failure='Conversation service cleanup failed';process.exitCode=1;}await native?.waitForExit();}finally{for(const [k,v]of saved){if(v===undefined)delete process.env[k];else process.env[k]=v;}rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});}}
}
checkBuild(repo);report.status='passed';}catch(e){report.status='failed';report.failure=e instanceof Error?e.message:String(e);process.exitCode=1;}finally{process.off('SIGINT',cancel);process.off('SIGTERM',cancel);if(report.failure)report.status='failed';report.completedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,failure:report.failure,report:path.join(output,'conversations-report.json')}));}
