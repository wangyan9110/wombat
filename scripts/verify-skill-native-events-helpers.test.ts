import {test} from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {tmpdir} from 'node:os';
import type {CollectionResult,SetupResult} from '@wombat/client';
import {parseNativeEventArgs,trustedCollectionRegistrations,validateNativeReceipts,receiptPageCursor} from './verify-skill-native-events-helpers.ts';
const project=path.join(tmpdir(),'native-project'),expected={session:'native-session',project,threadId:'thread',sourceInstanceId:'source'};
test('native event acceptance needs explicit paths and rejects trust bypass or implicit profile selection',()=>{
 const args=['--output-dir',path.join(tmpdir(),'native-events'),'--codex-bin',process.execPath,'--wombat-bin',process.execPath,'--project',project,'--source-root',path.join(tmpdir(),'native-profile')];assert.equal(parseNativeEventArgs(['--',...args]).project,project);
 for(const extra of [['--dangerously-bypass-hook-trust'],['--project',project],['--unknown','value'],['--source-root']])assert.throws(()=>parseNativeEventArgs([...args,...extra]));assert.throws(()=>parseNativeEventArgs([...args,'--session','nearby']));assert.equal(parseNativeEventArgs([...args,'--session','01a119ef-aba1-7c10-bf9f-df65640910d5']).session,'01a119ef-aba1-7c10-bf9f-df65640910d5');assert.throws(()=>parseNativeEventArgs([]));assert.throws(()=>parseNativeEventArgs(args.map(value=>value===project?'relative':value)));
});
test('native qualification refuses disabled, untrusted or incomplete own registration sets without trusting anything',()=>{
 const item={itemId:'hook',nativeKey:'key',contentHash:'content',registrationHash:'registration',enabled:true,trust:'trusted' as const,handler:'command' as const,source:'plugin',pluginId:'wombat-collection@wombat-local'};
 const setup:SetupResult={outputVersion:1,checkedAt:'now',discovery:{status:'available',instances:[]},runtimeCapabilities:[],errorCodes:[],hooks:{status:'partial',contexts:[{project,complete:false,registrations:Array.from({length:10},(_,i)=>({...item,nativeKey:String(i)}))}]}};
 assert.equal(trustedCollectionRegistrations(setup,project).length,10);
 for(const change of [{trust:'untrusted' as const},{enabled:false},{pluginId:'other@local'}]){const changed=structuredClone(setup);Object.assign(changed.hooks!.contexts[0].registrations[0],change);assert.throws(()=>trustedCollectionRegistrations(changed,project));}
 assert.throws(()=>trustedCollectionRegistrations(setup,path.join(tmpdir(),'different-project')));
});
test('actual receipt acceptance requires exact source, task, turn and committed epoch, never nearby identity',()=>{
 const events:CollectionResult['events']=['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse'].map((kind,i)=>({sequence:i+1,receivedAt:'now',buffered:false,observation:{id:String(i),sourceInstanceId:'source',sessionId:'native-session',project,kind:kind as CollectionResult['events'][number]['observation']['kind'],nativeIdentity:false,turnId:'native-turn'},association:{state:'linked',threadId:'thread',turnId:'turn',sourceEpoch:'epoch'}}));
 assert.equal(validateNativeReceipts(events,expected).length,4);
 assert.throws(()=>validateNativeReceipts(events.slice(1),expected));
 for(const change of [{sourceInstanceId:'other'},{sessionId:'nearby'},{project:path.join(tmpdir(),'other')},{prompt:'private'}]){const changed=structuredClone(events);Object.assign(changed[0].observation,change);assert.throws(()=>validateNativeReceipts(changed,expected));}
 for(const change of [{state:'unknown' as const},{threadId:'other'},{turnId:null},{sourceEpoch:null}]){const changed=structuredClone(events);Object.assign(changed[0].association,change);assert.throws(()=>validateNativeReceipts(changed,expected));}
});

test('receipt paging advances exactly, rejects stalled cursors and preserves end-of-history',()=>{
 const page={events:[{sequence:4},{sequence:8}],nextAfter:8} as CollectionResult;
 assert.deepEqual(receiptPageCursor(page,2),{last:8,next:8});assert.deepEqual(receiptPageCursor({...page,nextAfter:null},2),{last:8,next:null});
 for(const changed of [{...page,nextAfter:2},{...page,events:[]},{...page,events:[{sequence:4},{sequence:4}]}])assert.throws(()=>receiptPageCursor(changed as CollectionResult,2));
});
