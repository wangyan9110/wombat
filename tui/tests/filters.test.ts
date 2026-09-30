import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editTerminalFilters } from '../src/state/filters.js';
import type { FormSpec, FormAnswer } from '../src/components/form-model.js';
import type { UsageRequest } from '@wombat/client';

type Event = { action: FormAnswer['action']; patch?: Record<string, string>; changed?: string[] };
function scripted(events: Event[]) {
  const forms: FormSpec[] = [];
  return { forms, ui: { async form(spec: FormSpec): Promise<FormAnswer> {
    forms.push(structuredClone(spec)); const next = events.shift(); assert(next, 'unexpected extra form');
    return { action: next.action, values: { ...spec.values, ...next.patch }, changed: next.changed ?? Object.keys(next.patch ?? {}) };
  } } };
}
const reference = '2026-09-30T06:26:00Z';
test('same-page usage fields retain local calendar presets and reset pagination', async () => {
  for (const [period,since,until] of [['today','2026-09-30','2026-10-01'],['recent','2026-09-24','2026-10-01'],['week','2026-09-28','2026-10-01'],['month','2026-09-01','2026-10-01']]) {
    const s = scripted([{action:'change',patch:{period}}, {action:'apply'}]);
    const {request} = await editTerminalFilters({ action:'usage',offset:50,scope:{timezone:'Asia/Shanghai'} },reference,s.ui);
    assert.deepEqual(s.forms[0].fields.map(field=>field.id),['period']);
    assert.equal(s.forms[0].advancedOpen,false);
    assert.equal(s.forms[0].activeTab,'usage');
    assert.deepEqual(request,{action:'usage',offset:0,scope:{timezone:'Asia/Shanghai',since,until}});
  }
});
test('custom dates include the end day, survive DST and do not mutate the original request', async () => {
  const original:UsageRequest={action:'usage',scope:{timezone:'America/New_York',since:'2026-03-07',until:'2026-03-10'},snapshotId:'fixture'};
  const before=structuredClone(original);
  const s=scripted([{action:'change',patch:{period:'custom'}},{action:'apply',patch:{since:'2026-03-08',until:'2026-03-08'}}]);
  const result=await editTerminalFilters(original,'2026-03-09T02:00:00Z',s.ui);
  assert.equal(s.forms[0].values.until,'2026-03-09');
  assert.deepEqual(s.forms[1].fields.map(field=>field.id),['period','since','until']);
  assert.deepEqual(result.request.scope,{timezone:'America/New_York',since:'2026-03-08',until:'2026-03-09'});
  assert.deepEqual(original,before);
  const local=scripted([{action:'change',patch:{period:'today'}},{action:'apply'}]);
  assert.deepEqual((await editTerminalFilters({action:'usage',scope:{timezone:'America/New_York'}},'2026-03-09T02:00:00Z',local.ui)).request.scope,{timezone:'America/New_York',since:'2026-03-08',until:'2026-03-09'});
});
test('conversation fields preserve linked usage scope while editing search and project together',async()=>{
  const original:UsageRequest={action:'threads',scope:{timezone:'UTC',since:'2026-09-29',until:'2026-09-30',model:'gpt-5.4',reasoningEffort:'high',sourceInstanceId:'fixture'},search:'old',offset:50};
  const s=scripted([{action:'apply',patch:{search:'new title',project:'/synthetic/project'}}]);
  const result=await editTerminalFilters(original,reference,s.ui);
  assert.deepEqual(s.forms[0].fields.map(field=>field.id),['search','project']);
  assert.equal(s.forms[0].advancedFields,undefined);
  assert.deepEqual(result.request,{...original,offset:0,search:'new title',scope:{...original.scope,project:'/synthetic/project'}});
});
test('folding advanced fields preserves drafts; editing model and effort clears only their unknown dimensions',async()=>{
  const s=scripted([{action:'toggle'},{action:'change',patch:{model:'gpt-5.4',reasoningEffort:'high'}},{action:'toggle',patch:{timezone:'Asia/Shanghai'}},{action:'apply'}]);
  const result=await editTerminalFilters({action:'usage',scope:{timezone:'UTC',modelUnknown:true,effortUnknown:true,threadId:'fixture'}},reference,s.ui);
  assert.equal(s.forms[1].advancedOpen,true); assert.equal(s.forms[3].advancedOpen,false);
  assert.deepEqual(result.request.scope,{timezone:'Asia/Shanghai',threadId:'fixture',model:'gpt-5.4',reasoningEffort:'high'});
});
test('cancel and entry navigation discard all edits; untouched unknown flags survive apply',async()=>{
  const original:UsageRequest={action:'usage',scope:{timezone:'UTC',modelUnknown:true,effortUnknown:true},offset:7};
  for(const action of ['cancel','threads-tab'] as const){
    const s=scripted([{action:'change',patch:{period:'today'}},{action,patch:{model:'changed'}}]);
    const result=await editTerminalFilters(original,reference,s.ui);
    assert.equal(result.request,original);
    assert.equal(result.navigate,action==='threads-tab'?'threads-tab':undefined);
  }
  assert.deepEqual((await editTerminalFilters(original,reference,scripted([{action:'apply'}]).ui)).request.scope,original.scope);
});
test('invalid dates, reversed dates and invalid timezone stay on the form with raw draft values',async()=>{
  const s=scripted([{action:'change',patch:{period:'custom'}},
    {action:'apply',patch:{since:'2026-02-30',until:'2026-09-29'}},
    {action:'apply',patch:{since:'2026-09-30'}},
    {action:'apply',patch:{until:'2026-09-30',timezone:'Bad/Zone'}},
    {action:'apply',patch:{timezone:'UTC'}}]);
  const result=await editTerminalFilters({action:'usage',scope:{timezone:'UTC'}},reference,s.ui);
  assert(s.forms.some(form=>form.error==='日期格式为 YYYY-MM-DD'&&form.values.since==='2026-02-30'));
  assert(s.forms.some(form=>form.error==='截止日期不能早于起始日期'));
  assert(s.forms.some(form=>form.error==='请输入有效时区'&&form.focusId==='timezone'&&form.advancedOpen));
  assert.deepEqual(result.request.scope,{timezone:'UTC',since:'2026-09-30',until:'2026-10-01'});
});
test('changing timezone recomputes a preset but does not shift an inclusive custom day',async()=>{
  const s=scripted([{action:'change',patch:{period:'today'}},{action:'apply',patch:{timezone:'America/Los_Angeles'}}]);
  assert.deepEqual((await editTerminalFilters({action:'usage',scope:{timezone:'UTC'}},'2026-09-30T01:00:00Z',s.ui)).request.scope,{timezone:'America/Los_Angeles',since:'2026-09-29',until:'2026-09-30'});
});
test('editing another field preserves exact timestamp scopes and unrecognized recorded effort',async()=>{
  const request:UsageRequest={action:'usage',scope:{timezone:'UTC',since:'2026-09-29T12:00:00Z',until:'2026-09-30T14:00:00Z',reasoningEffort:'custom-effort'}};
  const s=scripted([{action:'apply',patch:{project:'/synthetic/project'}}]);
  const result=await editTerminalFilters(request,reference,s.ui);
  assert.deepEqual(result.request.scope,{...request.scope,project:'/synthetic/project'});
  assert(s.forms[0].advancedFields!.find(field=>field.id==='reasoningEffort')!.options!.some(option=>option.value==='custom-effort'));
});

test('dropdowns retain exact project paths and current values; unknown model differs from all', async () => {
  const candidates = { projects: ['/work/a/project', '/work/b/project'], models: ['gpt-a', 'gpt-b'] };
  const s = scripted([{ action: 'apply' }]);
  const original: UsageRequest = { action: 'usage', scope: { project: '/no-longer-listed', modelUnknown: true } };
  assert.deepEqual((await editTerminalFilters(original, reference, s.ui, candidates)).request.scope, original.scope);
  const project = s.forms[0].advancedFields!.find(field => field.id === 'project')!;
  assert.deepEqual(project.options!.map(option => option.value), ['', '/no-longer-listed', '/work/a/project', '/work/b/project']);
  const model = s.forms[0].advancedFields!.find(field => field.id === 'model')!;
  assert.equal(model.options!.find(option => option.value === s.forms[0].values.model)!.label, '模型未知');
  assert.equal(model.options![0].label, '全部');
  const clear = scripted([{ action: 'apply', patch: { model: '' } }]);
  assert.equal((await editTerminalFilters(original, reference, clear.ui, candidates)).request.scope?.modelUnknown, undefined);
  const failed = scripted([{ action: 'toggle' }, { action: 'apply', patch: { model: 'manual-model' } }]);
  const manual = await editTerminalFilters({ action: 'usage' }, reference, failed.ui, undefined, '选项读取失败，可手动输入');
  assert.equal(manual.request.scope?.model, 'manual-model');
  assert(failed.forms.every(form => form.error === '选项读取失败，可手动输入'));
  assert.equal(failed.forms[1].advancedFields!.find(field => field.id === 'model')!.options, undefined);
});

test('calendar choices match supported presets; empty custom dates cannot silently revert to seven days', async()=>{
  const s=scripted([{action:'change',patch:{period:'custom'}},{action:'apply'},{action:'apply',patch:{since:'2020-01-01'}}]);
  const result=await editTerminalFilters({action:'usage'},reference,s.ui);
  assert.deepEqual(s.forms[0].fields[0].options!.map(option=>option.value),['auto','today','recent','week','month','custom']);
  assert.equal(s.forms[0].values.period,'auto');
  assert.equal(s.forms[2].error,'请填写起始或截止日期');
  assert.equal(result.request.scope?.since,'2020-01-01');assert.equal(result.request.scope?.until,undefined);
});

test('automatic report range survives dimension edits and can replace explicit dates', async () => {
  const automatic: UsageRequest = { action: 'usage', group: 'month', scope: { timezone: 'UTC' } };
  const keep = scripted([{ action: 'apply', patch: { timezone: 'America/New_York', model: 'gpt-5.4' } }]);
  const kept = await editTerminalFilters(automatic, reference, keep.ui);
  assert.equal(keep.forms[0].values.period, 'auto');
  assert.deepEqual(kept.request.scope, { timezone: 'America/New_York', model: 'gpt-5.4' });
  const reset = scripted([{ action: 'apply', patch: { period: 'auto' } }]);
  const result = await editTerminalFilters({ ...automatic, scope: { timezone: 'UTC', since: '2026-09-24', until: '2026-10-01', project: '/synthetic' } }, reference, reset.ui);
  assert.deepEqual(result.request.scope, { timezone: 'UTC', project: '/synthetic' });
  assert.equal(result.request.group, 'month');
});
