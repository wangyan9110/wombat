/** Explicit real-profile acceptance: native trust is a prerequisite, never bypassed or edited. */
import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync,realpathSync,renameSync,rmSync} from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {setTimeout as delay} from 'node:timers/promises';
import type {CollectionResult,SetupResult,UsageResult,UsageItem} from '@wombat/client';
import {checkBuild,sourceIdentity} from './build-identity.ts';import {assertExternalOutputDir,runBoundedCommand} from './verify-e2e-helpers.ts';import {agentMetrics,stdoutFromLog} from './verify-agent-query.ts';import {nativeSessionId} from './verify-skill-conversation-helpers.ts';import {parseNativeEventArgs,trustedCollectionRegistrations,validateNativeReceipts,receiptPageCursor} from './verify-skill-native-events-helpers.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),options=parseNativeEventArgs(process.argv.slice(2));checkBuild(root);
const output=assertExternalOutputDir(root,options.output);if(existsSync(output)&&readdirSync(output).length)throw new Error('Use a fresh empty external output directory; prior evidence is preserved');mkdirSync(output,{recursive:true,mode:0o700});
const project=realpathSync(options.project),sourceRoot=realpathSync(options.sourceRoot),env={...process.env,WOMBAT_AUTO_PRICES:'0'};
const report:Record<string,unknown>={format:1,status:'running',sourceSha256:sourceIdentity(root),platform:process.platform+'-'+process.arch,project,sourceRoot,startedAt:new Date().toISOString(),boundaries:['Explicit real Codex profile and real installed collector; no credential reads/copies or native trust mutations.','Default creates one new native model session that runs only pwd. With --session, it only rechecks that exact existing native session without model execution; source files are not edited.','Queries source facts through Wombat public CLI only, within the explicit source/project; raw source logs and databases are not read by this verifier.','Real safe receipt metadata and derived indexes remain in product storage. Other lifecycle kinds, other platforms and public distribution require separate evidence.']};
const save=()=>{const file=path.join(output,'native-events-report.json'),temp=file+'.pending';try{writeFileSync(temp,JSON.stringify(report,null,2)+'\n',{mode:0o600});renameSync(temp,file);}finally{rmSync(temp,{force:true});}};
const controller=new AbortController(),stop=()=>controller.abort();process.on('SIGINT',stop);process.on('SIGTERM',stop);
function query<T>(args:string[]):T{
 controller.signal.throwIfAborted();const result=spawnSync(options.wombatBin,[...args,'--json'],{cwd:project,env,encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024});
 if(result.error||![0,2].includes(result.status??-1)){
  let code:string|undefined;try{code=JSON.parse(result.stdout)?.error?.code;}catch{/* Native failure stays a failure. */}
  const error=new Error('Wombat query failed: '+(code??result.error?.message??String(result.status)));Object.assign(error,{code});throw error;
 }
 return JSON.parse(result.stdout) as T;
}
function receipts(after:number,session?:string){
 let cursor=after,last=after,events:CollectionResult['events']=[],result:CollectionResult;
 for(let page=0;page<500;page++){
  result=query<CollectionResult>(['collection','events',...collectionArgs,'--after',String(cursor),'--limit','200']);
  const advance=receiptPageCursor(result,cursor);last=advance.last;
  if(session)events.push(...result.events.filter(row=>row.observation.sessionId===session));
  if(advance.next===null)return {result,events,last};cursor=advance.next;
 }
 throw new Error('Receipt pagination exceeded the bounded stored history');
}
const collectionArgs=['--root',sourceRoot,'--project',project];
save();try{
 const setup=query<SetupResult>(['setup',...collectionArgs]),registrations=trustedCollectionRegistrations(setup,project);
 report.native={version:setup.nativeVersion,registrations:registrations.length,trust:'trusted'};
 const before=query<CollectionResult>(['collection','status',...collectionArgs]);assert.equal(before.mode,'hooks');assert.notEqual(before.state,'paused');report.before={received:before.received,gaps:before.gaps};save();
 let session=options.session;
 const after=options.session?0:receipts(0).last;
 if(!session){
 const log=path.join(output,'native-session.log');console.log(JSON.stringify({stage:'native-session',status:'running'}));
 const result=await runBoundedCommand({command:[options.codexBin,'--no-daemon','exec','--sandbox','read-only','--skip-git-repo-check','--cd',project,'--json','This is a native Hook collection acceptance task. Run exactly the read-only command pwd once. Do not read or modify files, invoke plugins or MCP tools, use the network, or delegate. Then answer: collection probe complete.'],cwd:project,env,logFile:log,timeoutMs:180000,maxBytes:4*1024*1024,signal:controller.signal});
 report.nativeProcess={...result,spawnError:result.spawnError?.message};save();assert.ok(result.exitCode===0&&!result.timedOut&&!result.outputLimit&&!result.interrupted&&!result.closeTimedOut&&!result.logError&&!result.spawnError,'Native collection task did not complete; inspect the bounded external log');
 const stdout=stdoutFromLog(readFileSync(log,'utf8')),observedSession=nativeSessionId(stdout),metrics=agentMetrics(stdout);session=observedSession;
 assert.equal(metrics.unsupportedToolCalls,0);assert.equal(metrics.commands.length,1);assert.ok(['pwd','/bin/zsh -lc pwd','/bin/bash -lc pwd',"/bin/zsh -lc 'pwd'",'/bin/zsh -lc "pwd"'].includes(metrics.commands[0]),'Unexpected native command');report.metrics=metrics;
 }else{report.nativeProcess={notRun:true,reason:'Exact-session receipt recheck'};}
 report.sessionId=session;save();
 console.log(JSON.stringify({stage:'log-association',status:'running'}));
 const deadline=Date.now()+300000;let thread:Extract<UsageItem,{kind:'thread'}>|undefined,view:UsageResult|undefined;
 while(Date.now()<deadline){
  try{const associated=receipts(after,session).events.find(row=>row.association.state==='linked'&&row.association.threadId)?.association.threadId;const listed=query<UsageResult>(['threads','--root',sourceRoot,'--project',project,'--all-time','--sort','recent','--limit','10',...(associated?['--thread',associated]:[])]);thread=listed.items.find((item):item is Extract<UsageItem,{kind:'thread'}>=>item.kind==='thread'&&item.upstreamId===session);view=listed;if(thread)break;if(listed.freshness?.status==='failed'){const code=listed.freshness.errorCode??'SOURCE_UNREADABLE';const codes=(report.syncErrors??=[]) as string[];if(!codes.includes(code)){codes.push(code);save();console.log(JSON.stringify({stage:'log-association',status:'retrying',code}));}}}
  catch(error){if(!['SYNC_PENDING','SYNC_TIMEOUT'].includes((error as Error&{code?:string}).code??''))throw error;}
  await delay(500,undefined,{signal:controller.signal});
 }
 assert.ok(thread&&view,'The exact new native session is not in committed Wombat log facts');
 report.logFacts={threadId:thread.id,upstreamId:thread.upstreamId,sourceInstanceId:thread.sourceInstanceId,snapshotId:view.snapshotRef.snapshotId};
 let events:CollectionResult['events']=[];let receipt:CollectionResult|undefined;
 const receiptDeadline=Date.now()+15000;
 while(Date.now()<receiptDeadline){
  const page=receipts(after,session);receipt=page.result;events=page.events;
  if(['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse'].every(kind=>events.some(row=>row.observation.kind===kind)))break;
  await delay(250,undefined,{signal:controller.signal});
 }
 const verified=validateNativeReceipts(events,{session,project,threadId:thread.id,sourceInstanceId:thread.sourceInstanceId});
 const usageArgs=['usage','--snapshot',view.snapshotRef.snapshotId,'--project',project,'--thread',thread.id,'--all-time'];const pinned=query<UsageResult>(usageArgs);
 const rechecked=receipts(after,session);validateNativeReceipts(rechecked.events,{session,project,threadId:thread.id,sourceInstanceId:thread.sourceInstanceId});
 const reread=query<UsageResult>(usageArgs);assert.deepEqual(reread.summary.tokens,pinned.summary.tokens,'Receipt reads changed the pinned Token ledger');
 report.receipts=verified;report.recheck={exactThread:true,exactNativeTurns:true,sourceEpochVerified:true,pinnedLedgerUnchanged:true,stopObserved:verified.some(row=>row.observation.kind==='Stop')};report.collection={state:receipt!.state,received:receipt!.received,buffered:receipt!.buffered,gaps:receipt!.gaps};
 checkBuild(root);report.status='passed';
}catch(error){report.status='failed';report.failure=error instanceof Error?error.message:String(error);process.exitCode=1;}
finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);report.completedAt=new Date().toISOString();save();}
console.log(JSON.stringify({status:report.status,failure:report.failure,report:path.join(output,'native-events-report.json')}));
