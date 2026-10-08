import {realpathSync} from 'node:fs';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {createNodeClient} from '@wombat/client/node';import {startWebHost} from '@wombat/web';import {createHttpClient} from '@wombat/client/http';
test('Web context validates live source scope, preserves exact versions and converts dates without changing language',{timeout:40000},async()=>{
  const root=realpathSync.native(await mkdtemp(path.join(os.tmpdir(),'wombat-web-context-'))),source=path.join(root,'source'),foreign=path.join(root,'foreign'),project=path.join(root,'project'),old=process.env.WOMBAT_DATA_HOME;
  process.env.WOMBAT_DATA_HOME=path.join(root,'data');
  let host:Awaited<ReturnType<typeof startWebHost>>|undefined;
  try{
    await mkdir(path.join(source,'sessions'),{recursive:true});await mkdir(path.join(foreign,'sessions'),{recursive:true});await mkdir(project);
    const client=createNodeClient({automaticPrices:false,binaryPath:path.resolve('dist',process.platform==='win32'?'wombat-core.exe':'wombat-core')});
    const scope={since:'2026-10-01',until:'2026-10-04',timezone:'Asia/Shanghai'};
    const result=(await client.live!({query:{action:'usage',roots:[source],scope,limit:1},mode:'fresh'})).result;
    await assert.rejects(client.live!({query:{action:'usage',roots:[foreign],snapshotId:result.snapshotRef.snapshotId},mode:'cached'}),{code:'INVALID_ARGUMENT'});
    host=await startWebHost({client,assets:path.resolve('dist/web'),roots:[source],projectRoots:[project],automaticPrices:false,locale:'en'});
    const opened=await host.openView({page:'usage',usage:{action:'usage',snapshotId:result.snapshotRef.snapshotId,scope,limit:1}});
    const url=new URL(opened.url);assert.equal(url.searchParams.get('until'),'2026-10-03');assert.equal(url.searchParams.get('snapshot'),result.snapshotRef.snapshotId);assert.equal(new URLSearchParams(url.hash.slice(1)).get('lang'),'en');
    assert.equal(opened.context.usage?.snapshotId,result.snapshotRef.snapshotId);
    const token=new URLSearchParams(url.hash.slice(1)).get('token')!;
    const browser=createHttpClient({origin:host.origin,token,fetch:(input,init)=>fetch(input,{...init,headers:{...init?.headers,Origin:host!.origin}})});
    const reread=(await browser.live!({query:{action:'usage',snapshotId:result.snapshotRef.snapshotId,scope},mode:'cached'})).result;
    assert.equal(reread.snapshotRef.snapshotId,result.snapshotRef.snapshotId);assert.deepEqual(reread.summary,result.summary);
    await assert.rejects(host.openView({page:'usage',usage:{action:'usage',roots:[foreign]}}),{code:'INVALID_ARGUMENT'});
    await assert.rejects(host.openView({page:'optimize',optimization:{action:'keep',project}}),{code:'INVALID_ARGUMENT'});
    const config=await client.config!({roots:[source],projectRoots:[project],scope:{project},action:'list'});
    const openedConfig=await host.openView({page:'instructions',configuration:{action:'list',scope:{project},readView:config.readView}});
    assert.equal(new URL(openedConfig.url).searchParams.get('configView'),config.readView);
    assert.equal((await browser.config!({action:'list',scope:{project},readView:config.readView})).readView,config.readView);
    const threads=await host.openView({page:'threads',usage:{action:'threads'}});assert.equal(new URL(threads.url).searchParams.get('allTime'),'1');
    assert.equal(threads.context.usage?.scope?.allTime,true);
    await assert.rejects(host.openView({page:'usage',usage:{action:'usage',scope:{since:'2026-10-01'}}}),{code:'INVALID_ARGUMENT'});
    await assert.rejects(host.openView({page:'instructions',configuration:{action:'list',sort:'size'}}),{code:'INVALID_ARGUMENT'});
    const foreignView=(await client.live!({query:{action:'usage',roots:[foreign],limit:1},mode:'fresh'})).result;
    await assert.rejects(host.openView({page:'usage',usage:{action:'usage',snapshotId:foreignView.snapshotRef.snapshotId}}),{code:'INVALID_ARGUMENT'});
  }finally{await host?.close();if(old===undefined)delete process.env.WOMBAT_DATA_HOME;else process.env.WOMBAT_DATA_HOME=old;await rm(root,{recursive:true,force:true});}
});
