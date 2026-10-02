import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {createNodeClient} from '@wombat/client/node';

test('index initialization faults return actual errors, retain legacy rows and recover in the same service',{timeout:20_000},async()=>{
 const dir=await realpath(await mkdtemp(path.join(tmpdir(),'wombat-startup-fault-'))),root=path.join(dir,'source'),data=path.join(dir,'data'),database=path.join(data,'live-v1/index.sqlite');
 await mkdir(path.join(root,'sessions'),{recursive:true});await mkdir(path.dirname(database),{recursive:true});
 const old=new DatabaseSync(database);old.exec("CREATE TABLE kv(scope TEXT NOT NULL,key TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope,key)); INSERT INTO kv VALUES('synthetic','invalid key','{}');");old.close();
 const previous={WOMBAT_DATA_HOME:process.env.WOMBAT_DATA_HOME,CODEX_HOME:process.env.CODEX_HOME,WOMBAT_AUTO_PRICES:process.env.WOMBAT_AUTO_PRICES};Object.assign(process.env,{WOMBAT_DATA_HOME:data,CODEX_HOME:root,WOMBAT_AUTO_PRICES:'0'});
 const binary=path.resolve('dist',process.platform==='win32'?'wombat-core.exe':'wombat-core'),service=spawn(binary,['--serve-usage'],{stdio:'ignore',env:process.env});await once(service,'spawn');
 const client=createNodeClient({binaryPath:binary,automaticPrices:false});
 try{
  await assert.rejects(client.live!({query:{action:'usage',roots:[root]},mode:'auto'}),{code:'INDEX_MIGRATION_FAILED'});
  const retained=new DatabaseSync(database);assert.equal(retained.prepare('SELECT count(*) AS n FROM kv').get()!.n,1);assert.equal(retained.prepare('PRAGMA user_version').get()!.user_version,0);
  retained.exec('DELETE FROM kv');retained.close();
  const restored=await client.live!({query:{action:'usage',roots:[root]},mode:'fresh'});assert.equal(restored.freshness.status,'current');assert.equal(restored.result.summary.measurementCount,0);
  const current=new DatabaseSync(database);assert.equal(current.prepare('PRAGMA user_version').get()!.user_version,2);current.close();
 }finally{service.kill('SIGTERM');await once(service,'exit').catch(()=>{});for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await rm(dir,{recursive:true,force:true});}
});
