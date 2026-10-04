import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNodeClient } from '@wombat/client/node';
import { nativeCodexFixture } from '../helpers/native-codex.js';

test('native handoff rechecks the actual task model and only confirmed applicable exhaustion prevents queueing', {timeout:60_000}, async()=>{
  const dir=await realpath(await mkdtemp(path.join(tmpdir(),'wombat-native-gate-'))),source=path.join(dir,'source'),project=path.join(dir,'project');
  const previous={WOMBAT_DATA_HOME:process.env.WOMBAT_DATA_HOME,CODEX_HOME:process.env.CODEX_HOME,WOMBAT_AUTO_PRICES:process.env.WOMBAT_AUTO_PRICES};
  Object.assign(process.env,{WOMBAT_DATA_HOME:path.join(dir,'data'),CODEX_HOME:source,WOMBAT_AUTO_PRICES:'0'});
  let native: Awaited<ReturnType<typeof nativeCodexFixture>> | undefined;
  try{
    await mkdir(path.join(source,'sessions'),{recursive:true});await mkdir(project);await writeFile(path.join(project,'AGENTS.md'),'x'.repeat(16_385));
    native=await nativeCodexFixture(dir);const client=createNodeClient({binaryPath:path.resolve('dist',process.platform==='win32'?'wombat-core.exe':'wombat-core'),codexBinaryPath:native.binary,automaticPrices:false});
    const base={roots:[source],projectRoots:[project]};
    for(const [kind,status,blocked] of [['blocked','blocked',true],['low','low',false],['unconfirmed','low',false],['foreign','unknown',false],['expired','unknown',false],['unknown','unknown',false],['switched','unknown',false],['available','available',false]] as const){
      await writeFile(native.mode,JSON.stringify({kind}));await writeFile(native.calls,'');
      const preview=await client.handoff!({...base,action:'preview'});assert.equal(preview.allowanceChecks[0].assessment.status,status,kind);
      const sent=await client.handoff!({...base,action:'send',selectionVersion:preview.selectionVersion,readView:preview.readView,decisionRevision:preview.decisionRevision});
      assert.equal(sent.deliveries[0].status,blocked?'failed':'accepted',kind);assert.equal(sent.deliveries[0].errorCode,blocked?'ALLOWANCE_EXHAUSTED':null,kind);
      const methods: string[]=(await readFile(native.calls,'utf8')).trim().split('\n').map(row=>JSON.parse(row).method);
      assert.equal(methods.filter(m=>m==='thread/queue/add').length,blocked?0:1,kind);assert.ok(!methods.includes('account/usage/read'),'activity is not needed for sending');
    }
    // Effective config is a preview hint. The task's returned model wins at send time.
    await writeFile(native.mode,JSON.stringify({kind:'blocked',configModel:'other-model'}));await writeFile(native.calls,'');
    const changed=await client.handoff!({...base,action:'preview'});assert.equal(changed.allowanceChecks[0].assessment.status,'low');
    const denied=await client.handoff!({...base,action:'send',selectionVersion:changed.selectionVersion,readView:changed.readView,decisionRevision:changed.decisionRevision});
    assert.equal(denied.allowanceChecks[0].assessment.model,'synthetic-model');assert.equal(denied.deliveries[0].errorCode,'ALLOWANCE_EXHAUSTED');assert.ok(!(await readFile(native.calls,'utf8')).includes('thread/queue/add'));
    await writeFile(native.mode,JSON.stringify({kind:'blocked',actualModel:'other-model'}));
    const allowed=await client.handoff!({...base,action:'send',selectionVersion:changed.selectionVersion,readView:changed.readView,decisionRevision:changed.decisionRevision});
    assert.equal(allowed.deliveries[0].status,'accepted');assert.equal(allowed.allowanceChecks[0].assessment.status,'low');
    await writeFile(native.mode,JSON.stringify({kind:'available',mutateOnStart:path.join(project,'AGENTS.md')}));await writeFile(native.calls,'');
    const stale=await client.handoff!({...base,action:'send',selectionVersion:changed.selectionVersion,readView:changed.readView,decisionRevision:changed.decisionRevision});
    assert.equal(stale.deliveries[0].errorCode,'VIEW_EXPIRED');assert.ok(!(await readFile(native.calls,'utf8')).includes('thread/queue/add'));
  }finally{await native?.waitForExit();for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await rm(dir,{recursive:true,force:true});}
});
