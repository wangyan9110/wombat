import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import type {SetupResult} from '@wombat/client';
import {setupRegistrationLabel} from '../src/setup-state.js';
const project=path.join(tmpdir(),'wombat-setup-project');
const item={itemId:'hook',nativeKey:'key',contentHash:'content',registrationHash:'registration',enabled:true,trust:'trusted' as const,handler:'command' as const,source:'plugin',pluginId:'wombat-collection@wombat-local'};
function registry(status:'partial'|'observed'='observed',complete=true):NonNullable<SetupResult['hooks']>{return {status,contexts:[{project,complete,registrations:[{...item}]}]};}
test('observed collection blockers stay actionable despite unrelated registry warnings',()=>{
  for(const trust of ['untrusted','modified'] as const){const hooks=registry('partial',false);hooks.contexts[0].registrations[0].trust=trust;assert.equal(setupRegistrationLabel(project,hooks),'setup.trustNeeded');}
  const disabled=registry('partial',false);disabled.contexts[0].registrations[0].enabled=false;assert.equal(setupRegistrationLabel(project,disabled),'setup.trustNeeded');
});
test('partial or absent selected-project coverage never claims readiness or absence',()=>{
  assert.equal(setupRegistrationLabel(project,registry('partial',false)),'setup.unchecked');
  assert.equal(setupRegistrationLabel(project,registry('observed',false)),'setup.unchecked');
  const unrelated=registry('partial',false);unrelated.contexts[0].registrations[0].pluginId='other@local';unrelated.contexts[0].registrations[0].trust='untrusted';assert.equal(setupRegistrationLabel(project,unrelated),'setup.unchecked');
  const otherProject=registry();otherProject.contexts[0].project=path.join(tmpdir(),'other-project');otherProject.contexts[0].registrations[0].trust='untrusted';assert.equal(setupRegistrationLabel(project,otherProject),'setup.unchecked');
});
test('complete selected-project observations distinguish registration, absence and missing inspection',()=>{
  for(const trust of ['trusted','managed'] as const){const hooks=registry();hooks.contexts[0].registrations[0].trust=trust;assert.equal(setupRegistrationLabel(project,hooks),'setup.registered');}
  const empty=registry();empty.contexts[0].registrations=[];assert.equal(setupRegistrationLabel(project,empty),'setup.unwired');
  assert.equal(setupRegistrationLabel(undefined,registry()),'setup.chooseProject');
  assert.equal(setupRegistrationLabel(project,undefined),'setup.unchecked');
  assert.equal(setupRegistrationLabel(project,{status:'unavailable',contexts:[]}),'setup.unchecked');
});
