import assert from 'node:assert/strict';
import path from 'node:path';
import type {CollectionResult,SetupResult} from '@wombat/client';
export function parseNativeEventArgs(args:string[]) {
  if(args[0]==='--')args=args.slice(1);
  const values=new Map<string,string>();
  for(let i=0;i<args.length;i++){
    const key=args[i],value=args[++i];
    if(!['--output-dir','--codex-bin','--wombat-bin','--project','--source-root','--session'].includes(key)||values.has(key)||!value||value.startsWith('--'))throw new Error('Usage: verify:skill-native-events --output-dir ABSOLUTE_EXTERNAL_PATH --codex-bin ABSOLUTE_EXECUTABLE --wombat-bin ABSOLUTE_EXECUTABLE --project ABSOLUTE_PROJECT --source-root ABSOLUTE_CODEX_HOME');
    values.set(key,value);
  }
  for(const key of ['--output-dir','--codex-bin','--wombat-bin','--project','--source-root'])if(!values.get(key)||!path.isAbsolute(values.get(key)!))throw new Error(`${key} must be an explicit absolute path`);
  const session=values.get('--session');
  if(session&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session))throw new Error('--session must be an exact native session UUID');
  return {session,output:values.get('--output-dir')!,codexBin:values.get('--codex-bin')!,wombatBin:values.get('--wombat-bin')!,project:values.get('--project')!,sourceRoot:values.get('--source-root')!};
}
export function trustedCollectionRegistrations(setup:SetupResult,project:string) {
  const contexts=setup.hooks?.contexts.filter(c=>c.project===project)??[];
  const own=contexts.flatMap(c=>c.registrations.filter(r=>r.pluginId==='wombat-collection@wombat-local'));
  assert.equal(own.length,10,'Native /hooks must contain the ten reviewed Wombat declarations');
  assert.ok(own.every(r=>r.enabled&&(r.trust==='trusted'||r.trust==='managed')),'Complete native /hooks review before running this qualification');
  return own;
}
export function validateNativeReceipts(events:CollectionResult['events'],expected:{session:string;project:string;threadId:string;sourceInstanceId:string}) {
  const own=events.filter(row=>row.observation.sessionId===expected.session);
  const required=['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse'];
  for(const kind of required)assert.ok(own.some(row=>row.observation.kind===kind),`No actual ${kind} receipt for this native session`);
  for(const row of own){
    assert.equal(row.observation.sourceInstanceId,expected.sourceInstanceId,'Receipt changed source identity');
    assert.equal(row.observation.project,expected.project,'Receipt changed project');
    assert.equal(row.association.state,'linked','Receipt has no exact committed log association');
    assert.equal(row.association.threadId,expected.threadId,'Receipt linked to another task');
    assert.ok(row.association.sourceEpoch,'Missing committed source epoch');
    if(row.observation.turnId)assert.ok(row.association.turnId,'Native turn identity was not rechecked against log facts');
    assert.deepEqual(Object.keys(row.observation).filter(k=>!['id','sourceInstanceId','sessionId','turnId','toolUseId','agentId','project','kind','occurredAt','nativeIdentity'].includes(k)),[],'Unsafe or unknown raw observation fields');
  }
  return own;
}

export function receiptPageCursor(page:CollectionResult,after:number) {
  let last=after;
  for(const row of page.events){assert.ok(Number.isSafeInteger(row.sequence)&&row.sequence>last,'Receipt sequence must advance within its page');last=row.sequence;}
  assert.ok(page.nextAfter===null||page.events.length>0&&page.nextAfter===last,'Receipt cursor must identify the last returned sequence');
  return {last,next:page.nextAfter};
}
