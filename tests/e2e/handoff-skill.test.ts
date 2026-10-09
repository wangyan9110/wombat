import {realpathSync} from 'node:fs';
import {spawn} from 'node:child_process';import {once} from 'node:events';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createNodeClient} from '@wombat/client/node';import {nativeCodexFixture} from '../helpers/native-codex.js';
test('handoff binds the chosen enabled Skill, preserves language, and requires explicit missing-Skill fallback',{timeout:60000},async()=>{
  const root=realpathSync.native(await mkdtemp(path.join(os.tmpdir(),'wombat-handoff-skill-'))),source=path.join(root,'source'),project=path.join(root,'project');
  const old=process.env.WOMBAT_DATA_HOME;process.env.WOMBAT_DATA_HOME=path.join(root,'data');
  let service:ReturnType<typeof spawn>|undefined,native:Awaited<ReturnType<typeof nativeCodexFixture>>|undefined;
  try{
    await mkdir(path.join(source,'sessions'),{recursive:true});await mkdir(project);await writeFile(path.join(project,'AGENTS.md'),'x'.repeat(16385));
    const binary=path.resolve('dist',process.platform==='win32'?'wombat-core.exe':'wombat-core');
    service=spawn(binary,['--serve-usage'],{stdio:'ignore',env:process.env});await once(service,'spawn');
    native=await nativeCodexFixture(root);const client=createNodeClient({automaticPrices:false,codexBinaryPath:native.binary,binaryPath:binary});
    const base={roots:[source],projectRoots:[project],project},first=path.join(project,'first/SKILL.md'),second=path.join(project,'second/SKILL.md');
    await writeFile(native.mode,JSON.stringify({kind:'available',skills:[{name:'wombat',path:first,enabled:true},{name:'wombat:wombat',path:second,enabled:true}]}));
    const preview=await client.handoff!({...base,action:'preview'});assert.equal(preview.skillChecks?.[0].discovery.status,'ambiguous');
    assert.equal(service.exitCode,null);assert.equal(service.signalCode,null);
    const binding={projectId:preview.projects[0].id,path:second};
    await writeFile(native.calls,'');
    const sent=await client.handoff!({...base,action:'send',language:'en',readView:preview.readView,decisionRevision:preview.decisionRevision,selectionVersion:preview.selectionVersion,skillSelections:[binding]});
    assert.equal(sent.deliveries[0].status,'accepted');assert.equal(sent.deliveries[0].skillPath,second);
    const queue=JSON.parse((await readFile(native.calls,'utf8')).split('\n').find(row=>row.includes('thread/queue/add'))!).params;
    assert.deepEqual(queue.input[1],{type:'skill',name:'wombat:wombat',path:second});assert.match(queue.input[0].text,/\$wombat/);assert.match(queue.input[0].text,/"language":"en"/);
    for(const after of [{name:'wombat:wombat',path:second,enabled:false},{name:'wombat',path:second,enabled:true}]){
      await writeFile(native.mode,JSON.stringify({kind:'available',skills:[{name:'wombat:wombat',path:second,enabled:true}],skillsAfterStart:[after]}));
      await writeFile(native.calls,'');
      const reviewed=await client.handoff!({...base,action:'preview'});
      const changed=await client.handoff!({...base,action:'send',readView:reviewed.readView,decisionRevision:reviewed.decisionRevision,selectionVersion:reviewed.selectionVersion,skillSelections:[binding]});
      assert.equal(changed.deliveries[0].errorCode,'SKILL_SELECTION_CHANGED');
      assert.ok(!(await readFile(native.calls,'utf8')).includes('thread/queue/add'));
    }
    await writeFile(native.mode,JSON.stringify({kind:'available',skills:[{name:'wombat',path:second,enabled:true},{name:'wombat:wombat',path:second,enabled:true}]}));
    const conflicting=await client.handoff!({...base,action:'preview'});
    assert.equal(conflicting.skillChecks?.[0].discovery.status,'unavailable');
    await writeFile(native.mode,JSON.stringify({kind:'available',queueSkillMissing:true,skills:[{name:'wombat:wombat',path:second,enabled:true}]}));
    const reviewed=await client.handoff!({...base,action:'preview'});
    const uncertain=await client.handoff!({...base,action:'send',readView:reviewed.readView,decisionRevision:reviewed.decisionRevision,selectionVersion:reviewed.selectionVersion,skillSelections:[binding]});
    assert.equal(uncertain.deliveries[0].status,'unknown');assert.equal(uncertain.deliveries[0].errorCode,'HANDOFF_UNKNOWN');
    await writeFile(native.mode,JSON.stringify({kind:'available',skills:[]}));await writeFile(native.calls,'');
    const current=await client.handoff!({...base,action:'preview'});
    const request={...base,action:'send' as const,readView:current.readView,decisionRevision:current.decisionRevision,selectionVersion:current.selectionVersion};
    const missing=await client.handoff!(request);assert.equal(missing.deliveries[0].errorCode,'SKILL_REQUIRED');assert.ok(!(await readFile(native.calls,'utf8')).includes('thread/queue/add'));
    const fallback=await client.handoff!({...request,withoutSkill:true});assert.equal(fallback.deliveries[0].status,'accepted');assert.equal(fallback.deliveries[0].skillPath,null);
  }finally{
    if(service&&service.exitCode===null&&service.signalCode===null){const closed=once(service,'close');service.kill('SIGTERM');const kill=setTimeout(()=>service?.kill('SIGKILL'),2000);try{await closed;}finally{clearTimeout(kill);}}
    await native?.waitForExit();
    if(old===undefined)delete process.env.WOMBAT_DATA_HOME;else process.env.WOMBAT_DATA_HOME=old;await rm(root,{recursive:true,force:true});
  }
});
