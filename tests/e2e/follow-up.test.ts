import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createNodeClient } from '@wombat/client/node';
import { createHttpClient } from '@wombat/client/http';
import { startWebHost } from '@wombat/web';

test('natural follow-up records remain version unknown in CLI/API without changing review time or decisions', { timeout: 40_000 }, async () => {
  const dir=realpathSync.native(await mkdtemp(path.join(tmpdir(),'wombat-follow-up-'))),root=path.join(dir,'source'),project=path.join(dir,'project');
  await mkdir(path.join(root,'sessions'),{recursive:true});await mkdir(project);
  const file=path.join(project,'AGENTS.md'),log=path.join(root,'sessions','one.jsonl');
  await writeFile(file,'Synthetic instructions. '.repeat(1000));await writeFile(path.join(root,'AGENTS.md'),'Synthetic global instructions.');
  const row=(type:string,payload:unknown,timestamp='2026-10-01T00:00:00Z')=>({type,timestamp,payload});
  const jsonl=(rows:unknown[])=>rows.map(r=>JSON.stringify(r)+'\n').join('');
  await writeFile(log,jsonl([row('session_meta',{id:'t',cwd:project}),row('turn_context',{turn_id:'u',model:'gpt-5.4',effort:'low'})]));
  const old={WOMBAT_DATA_HOME:process.env.WOMBAT_DATA_HOME,WOMBAT_AUTO_PRICES:process.env.WOMBAT_AUTO_PRICES,CODEX_HOME:process.env.CODEX_HOME};Object.assign(process.env,{WOMBAT_DATA_HOME:path.join(dir,'data'),WOMBAT_AUTO_PRICES:'0',CODEX_HOME:root});
  const binary=path.resolve('dist',process.platform==='win32'?'wombat-core.exe':'wombat-core');let service=spawn(binary,['--serve-usage'],{stdio:'ignore',env:process.env});await once(service,'spawn');
  const host=await startWebHost({client:createNodeClient({binaryPath:binary,automaticPrices:false}),roots:[root],projectRoots:[project],assets:path.resolve('dist/web'),automaticPrices:false});
  try{
    const token=new URLSearchParams(new URL(host.url).hash.slice(1)).get('token')!;const http=createHttpClient({origin:host.origin,token,fetch:(url,init)=>fetch(url,{...init,headers:{...init?.headers,Origin:host.origin}})});
    const listed=await http.optimize!({project});const suggestion=listed.suggestions.find(s=>s.item.path===file)!;assert.ok(suggestion);assert.equal(listed.followUps.length,0);
    await writeFile(file,'Short synthetic instructions.');await http.optimize!({action:'recheck',project,suggestionId:suggestion.id});
    const first=await http.optimize!({group:'history',project,suggestionId:suggestion.id});assert.equal(first.followUps.length,1);const baseline=first.followUps[0];assert.equal(baseline.status,'no_observed_records');assert.equal(baseline.observedRecords,null);assert.equal(baseline.absenceObservable,false);
    await delay(5);const at=new Date().toISOString();const request=row('response_item',{type:'function_call',call_id:'next',name:'read_file',arguments:JSON.stringify({path:file})},at),output=row('response_item',{type:'function_call_output',call_id:'next',output:'PRIVATE_SYNTHETIC_OUTPUT'},at);await appendFile(log,jsonl([request,output,request,output]));
    const next=await http.optimize!({group:'history',project,suggestionId:suggestion.id});assert.equal(next.followUps[0].status,'version_unknown');assert.equal(next.followUps[0].observedRecords,1);assert.equal(next.followUps[0].recordId,baseline.recordId);assert.equal(next.followUps[0].after,baseline.after);assert.equal(next.decisionRevision,first.decisionRevision);assert.equal(next.history,first.history);assert.equal(next.suggestions[0].decision,null);
    const pinned=await http.optimize!({group:'history',project,suggestionId:suggestion.id,readView:first.readView});assert.equal(pinned.followUps[0].status,'no_observed_records');
    const args=[path.resolve('dist/wombat.js'),'optimize','history','--root',root,'--project-root',project,'--project',project,'--suggestion',suggestion.id];
    const cli=spawnSync(process.execPath,[...args,'--json'],{env:process.env,encoding:'utf8',timeout:15_000});assert.ifError(cli.error);assert.equal(cli.status,2,cli.stderr+cli.stdout);const value=JSON.parse(cli.stdout);assert.equal(value.followUps[0].status,'version_unknown');assert.equal(value.followUps[0].observedRecords,1);assert.equal(value.followUps[0].recordId,baseline.recordId);
    for(const [lang,expected]of [['zh',/待后续任务确认/],['en',/Awaiting follow-up task verification/]]as const){const text=spawnSync(process.execPath,args,{env:{...process.env,WOMBAT_LANG:lang},encoding:'utf8',timeout:15_000});assert.equal(text.status,2,text.stderr+text.stdout);assert.match(text.stdout,expected);assert.match(text.stdout,/无法确认是否采用|adoption cannot be confirmed/);}
    service.kill('SIGTERM');await once(service,'exit');service=spawn(binary,['--serve-usage'],{stdio:'ignore',env:process.env});await once(service,'spawn');
    const restored=await http.optimize!({group:'history',project,suggestionId:suggestion.id});assert.equal(restored.followUps[0].status,'version_unknown');assert.equal(restored.followUps[0].observedRecords,1);assert.equal(restored.decisionRevision,first.decisionRevision);assert.ok(!JSON.stringify(restored).includes('PRIVATE_SYNTHETIC_OUTPUT'));
  }finally{await host.close();service.kill('SIGTERM');await once(service,'exit').catch(()=>{});for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await rm(dir,{recursive:true,force:true});}
});
