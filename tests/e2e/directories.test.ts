import {test} from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import {mkdtemp,mkdir,writeFile,rm,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createNodeClient} from '@wombat/client/node';
import {createHttpClient} from '@wombat/client/http';
import {startWebHost} from '@wombat/web';

test('host-selected grants persist, cannot be forged, and revoked projects leave the reading scope',{timeout:30_000},async()=>{
  const dir=realpathSync.native(await mkdtemp(path.join(tmpdir(),'wombat-directories-'))),source=path.join(dir,'source'),project=path.join(dir,'project'),data=path.join(dir,'data');
  await mkdir(path.join(source,'sessions'),{recursive:true});await mkdir(project);await writeFile(path.join(project,'AGENTS.md'),'Preserve verified evidence.\n');
  const previous={WOMBAT_DATA_HOME:process.env.WOMBAT_DATA_HOME,CODEX_HOME:process.env.CODEX_HOME,WOMBAT_AUTO_PRICES:process.env.WOMBAT_AUTO_PRICES};
  Object.assign(process.env,{WOMBAT_DATA_HOME:data,CODEX_HOME:source,WOMBAT_AUTO_PRICES:'0'});
  const binary=path.resolve('dist',process.platform==='win32'?'wombat-core.exe':'wombat-core'),service=spawn(binary,['--serve-usage'],{stdio:'ignore'});await once(service,'spawn');
  let selected=project,picks=0;
  const node=createNodeClient({binaryPath:binary,automaticPrices:false,directoryPicker:async()=>{picks++;return selected;}});
  let host=await startWebHost({client:node,assets:path.resolve('dist/web'),roots:[source]});
  const browser=()=>createHttpClient({origin:host.origin,token:new URLSearchParams(new URL(host.url).hash.slice(1)).get('token')!,fetch:(url,init)=>fetch(url,{...init,headers:{...init?.headers,Origin:host.origin}})});
  const code=(expected:string)=>(e:unknown)=>(e as {code:string}).code===expected;
  try {
    const first=browser();assert.equal((await first.config!({action:'capabilities'})).authorizedProjects.length,0);
    await assert.rejects(first.directories!({action:'authorize',path:project,purpose:'project'}),code('INVALID_ARGUMENT'));
    await assert.rejects(first.directories!({action:'confirm',choiceToken:'forged'}),code('CHOICE_EXPIRED'));
    const choice=await first.directories!({action:'choose',purpose:'project'});assert.equal(choice.chosenPath,project);assert.equal(picks,1);
    assert.equal((await first.config!({action:'capabilities'})).authorizedProjects.length,0,'selection alone is not authorization');
    const confirmed=await first.directories!({action:'confirm',choiceToken:choice.choiceToken!});assert.equal(confirmed.grants.length,1);
    await assert.rejects(first.directories!({action:'confirm',choiceToken:choice.choiceToken!}),code('CHOICE_EXPIRED'));
    const visible=await first.config!({action:'list',kind:'rule'});assert.ok(visible.items.some(i=>i.path===path.join(project,'AGENTS.md')));
    await host.close();host=await startWebHost({client:node,assets:path.resolve('dist/web'),roots:[source]});
    const restarted=browser();assert.deepEqual((await restarted.config!({action:'capabilities'})).authorizedProjects,[project],'grants survive host restart');
    const pinned=await restarted.config!({action:'list',kind:'rule'});
    await restarted.directories!({action:'revoke',grantId:confirmed.grants[0].id});
    assert.equal((await restarted.config!({action:'capabilities'})).authorizedProjects.length,0);
    const revoked=await restarted.config!({action:'list',kind:'rule'});assert.ok(!revoked.items.some(i=>i.path===path.join(project,'AGENTS.md')),'revocation removes effective scope');
    await assert.rejects(restarted.config!({action:'list',readView:pinned.readView!}),code('INVALID_ARGUMENT'),'old browser views cannot retain revoked authority');
    selected=project;const again=await restarted.directories!({action:'choose',purpose:'project'});await restarted.directories!({action:'confirm',choiceToken:again.choiceToken!});
    await rename(project,path.join(dir,'old-project'));await mkdir(project);
    const changed=await restarted.directories!({action:'list'});assert.equal(changed.grants[0].status,'unavailable','a replacement directory cannot inherit the old identity');
    assert.equal((await restarted.config!({action:'capabilities'})).authorizedProjects.length,0);
    const newChoice=await restarted.directories!({action:'choose',purpose:'project'});const replacement=await restarted.directories!({action:'confirm',choiceToken:newChoice.choiceToken!});
    assert.deepEqual((await restarted.config!({action:'capabilities'})).authorizedProjects,[project]);
    await node.directories!({action:'revoke',grantId:replacement.grants[0].id});
    assert.equal((await restarted.config!({action:'capabilities'})).authorizedProjects.length,0,'another entry can revoke authority without restarting this host');
  }finally{await host.close();service.kill();await once(service,'exit').catch(()=>{});for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await rm(dir,{recursive:true,force:true});}
});
