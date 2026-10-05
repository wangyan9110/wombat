import test from 'node:test';
import assert from 'node:assert/strict';
import { locale } from '@wombat/client/locale';
import { renderTimingResult, timingExitCode } from '../src/timing-format.js';
import { local, share, capabilityResult } from './timing-fixtures.js';
import type { TimingResult } from '@wombat/client';

test('human timing preserves explicit zero, basis-specific missing measures and concurrent interval durations', () => {
  locale.setLocale('en');
  const fixture = structuredClone(local);
  fixture.time.nativeWallClockMs = { value: 0, status: 'observed', basis: 'native_record', evidenceRefs: [] };
  fixture.time.derivedWallClockMs = { value: 40, status: 'derived', basis: 'explicit_boundary', evidenceRefs: [] };
  fixture.time.command.unionMs.value = 30; fixture.time.command.sumMs.value = 50;
  fixture.time.compaction.unionMs.value = 0;
  fixture.time.reasoning.unionMs.value = 20; fixture.time.reasoning.sumMs.value = 35;
  const text = renderTimingResult(fixture);
  assert.match(text, /Native total duration: 0 ms/); assert.match(text, /Boundary-derived total duration: 40 ms/);
  assert.match(text, /Native time to first Token: The source did not record this measure/); assert.match(text, /Commands: union 30 ms; sum 50 ms/);
  assert.match(text, /^Compaction: union 0 ms; sum The source did not record this measure$/m);
  assert.match(text, /Reasoning: union 20 ms; sum 35 ms/); assert.match(text, /category sums are not total duration/);
  assert.doesNotMatch(text, /total duration: 85/);
  assert.doesNotMatch(text, /Turn state not established/);
  locale.setLocale('zh'); const zh = renderTimingResult(fixture);
  assert.match(zh, /原生总耗时: 0 ms/); assert.match(zh, /边界推导总耗时: 40 ms/); assert.match(zh, /原生首 Token 延迟: 来源未记录此测量/);
  assert.match(zh, /并集 30 ms；相加 50 ms/);
  assert.match(zh, /^压缩：并集 0 ms；相加 来源未记录此测量$/m);
});
test('share rendering consumes only core projection aliases and strips terminal controls from display data', () => {
  locale.setLocale('en');
  const text = renderTimingResult(share);
  assert.match(text, /task-1 \/ turn-1/); assert.doesNotMatch(text, /live:scope:fixed|sourceInstanceId|Fixed snapshot/);
  const fixture = structuredClone(local); fixture.scope.threadId = '\u001b[31mthread\u001b[0m';
  assert.doesNotMatch(renderTimingResult(fixture), /\u001b/);
});
test('exit classification uses core quality without making missing optional capabilities an error', () => {
  const complete = structuredClone(local); complete.quality.partial = false; complete.quality.running = false; complete.quality.censored = false;
  assert.equal(timingExitCode(complete), 0); assert.equal(timingExitCode(capabilityResult), 0);
  for (const field of ['partial', 'running', 'censored'] as const) assert.equal(timingExitCode({ ...complete, quality: { ...complete.quality, [field]: true } }), 2);
  locale.setLocale('en'); assert.match(renderTimingResult(capabilityResult), /Total duration: Unavailable/);
});
test('Work facts preserve observed zero, unavailable counts, source failure and physical-record caveats', () => {
  const fixture = structuredClone(local);
  fixture.work.operationCandidates = { value: 0, status: 'observed', basis: 'safe_event_count', evidenceRefs: [] };
  fixture.work.closedOperations = { value: 2, status: 'observed', basis: 'safe_event_count', evidenceRefs: [] };
  fixture.work.fileChangeRecords = { value: 3, status: 'observed', basis: 'safe_event_count', evidenceRefs: [] };
  fixture.work.changedFiles = { value: 1, status: 'derived', basis: 'reported_file_paths', evidenceRefs: [] };
  fixture.work.addedLines = { value: null, status: 'unavailable', basis: 'missing_repository_baseline', evidenceRefs: [] };
  fixture.work.removedLines = { value: null, status: 'unavailable', basis: 'missing_repository_baseline', evidenceRefs: [] };
  fixture.work.labelledCommandMs = { value: null, status: 'unavailable', basis: 'unsupported_method', evidenceRefs: [] };
  fixture.work.userBoundaryRecords = { value: 4, status: 'observed', basis: 'safe_event_count', evidenceRefs: [] };
  fixture.coverage.sourceStatus = 'failed';
  fixture.quality.partial = true;

  locale.setLocale('en');
  const en = renderTimingResult(fixture);
  assert.match(en, /Operation candidates \/ closed \/ failed: 0 \/ 2 \/ The source did not record this measure/);
  assert.match(en, /Reported file paths: 1 · Derived · Basis: Source-reported file paths \(reported_file_paths\)/);
  assert.doesNotMatch(en, /Added lines|Removed lines|Command duration by label/);
  assert.match(en, /addedLines=missing_repository_baseline/);
  assert.match(en, /removedLines=missing_repository_baseline/);
  assert.match(en, /labelledCommandMs=unsupported_method/);
  assert.match(en, /User input records: 4 · Source record · Basis: Event record count \(safe_event_count\)/);
  assert.match(en, /Source coverage: Source reading failed/);
  assert.match(en, /Read quality: Partial results/);
  assert.match(en, /physical records, not requests/);
  assert.match(en, /not code defects/);

  locale.setLocale('zh');
  const zh = renderTimingResult(fixture);
  assert.match(zh, /操作候选 \/ 已闭合 \/ 失败: 0 \/ 2 \/ 来源未记录此测量/);
  assert.match(zh, /报告的文件路径数: 1 · 推导 · 依据: 来源报告的文件路径 \(reported_file_paths\)/);
  assert.doesNotMatch(zh, /新增行数|删除行数|按命令标签归类的时长/);
  assert.match(zh, /addedLines=missing_repository_baseline/);
  assert.match(zh, /removedLines=missing_repository_baseline/);
  assert.match(zh, /labelledCommandMs=unsupported_method/);
  assert.match(zh, /用户输入记录数: 4 · 源记录 · 依据: 事件记录计数 \(safe_event_count\)/);
  assert.match(zh, /来源覆盖: 来源读取失败/);
  assert.match(zh, /读取质量: 结果不完整/);
  assert.match(zh, /物理记录数，不是请求数/);
  assert.match(zh, /不代表代码缺陷/);
});
test('localized timing reasons replace bare protocol codes and running differs from censored scope', () => {
  const fixture = structuredClone(local);
  fixture.quality.partial = true; fixture.quality.running = true; fixture.quality.censored = true;
  fixture.quality.reasonCodes = ['missing_time', 'source_partial', 'boundary_conflict', 'dispatch_not_proven'];
  fixture.coverage.sourceStatus = 'partial';
  locale.setLocale('en');
  const en = renderTimingResult(fixture);
  assert.match(en, /Reasons: Usable timing records are missing for calculation or placement \(missing_time\)/);
  assert.match(en, /Some source records or required evidence are incomplete \(source_partial\)/);
  assert.match(en, /Boundary or content evidence conflicts across records \(boundary_conflict\)/);
  assert.match(en, /The records do not establish that the call was dispatched \(dispatch_not_proven\)/);
  assert.match(en, /The turn is still running; only observed records are shown/);
  assert.match(en, /Results are limited to the current observation window/);
  locale.setLocale('zh');
  const zh = renderTimingResult(fixture);
  assert.match(zh, /具体原因: 缺少可用于计算或定位的时间记录 \(missing_time\)/);
  assert.match(zh, /部分来源记录或所需依据不完整 \(source_partial\)/);
  assert.match(zh, /记录中的边界或内容依据存在冲突 \(boundary_conflict\)/);
  assert.match(zh, /记录不足以确认调用已发出 \(dispatch_not_proven\)/);
  assert.match(zh, /轮次仍在进行，当前只展示已观察到的记录/);
  assert.match(zh, /结果受当前观察范围限制，不代表完整轮次/);
});
test('object and record pages preserve missing counts, use outcomes and safe display text', () => {
  locale.setLocale('en');
  const zero = { value: 0, status: 'observed', basis: 'safe_event_count', evidenceRefs: [] } as const;
  const base = { outputVersion: 1, action: 'evidence' as const, methodVersion: local.methodVersion, profile: 'local' as const, snapshotId: local.readView.snapshotId,
    scope: local.scope, totals: local.uses.totals, total: { ...zero, value: 1, evidenceRefs: [] }, nextCursor: { token: 'next' } };
  const objects: TimingResult = { ...base, collection: 'use_objects', rows: [{
    objectRef: 'object-1', kind: 'skill', state: 'used', path: '/synthetic/\u001b[31mSKILL.md', server: null, project: null,
    associatedUseCount: { ...zero, value: 1, evidenceRefs: [] }, useCount: local.uses.totals.objectCount,
    recordCount: { ...zero, value: 1, evidenceRefs: [] }, unassignedTurnRecords: { ...zero, evidenceRefs: [] }, coverage: local.uses.totals.coverage,
  }] };
  const text = renderTimingResult(objects);
  assert.match(text, /object-1\tskill\tused/); assert.match(text, /The source did not record this measure/); assert.match(text, /1 · Source record/); assert.doesNotMatch(text, /\u001b/);
  const records: TimingResult = { ...base, collection: 'use_records', objectRef: 'object-1', rows: [{
    reference: 'use-1', objectRef: 'object-1', kind: 'skill_read', state: 'used', outcome: 'failed', timestampMs: null,
    timeBasis: 'unknown', nativeDurationMs: null, tool: 'read', exitCode: 1, identityKnown: true,
    replayOf: null, targetConflict: false, gapCodes: ['time_missing'],
  }, {
    reference: 'use-2', objectRef: 'object-1', kind: null, state: 'candidate', outcome: 'unknown', timestampMs: null,
    timeBasis: 'unknown', nativeDurationMs: null, tool: 'read', exitCode: null, identityKnown: true,
    replayOf: null, targetConflict: false, gapCodes: ['operation_result_conflict', 'time_missing'],
  }, {
    reference: 'use-3', objectRef: 'object-1', kind: 'mcp_tool', state: 'used', outcome: 'declined', timestampMs: 1,
    timeBasis: 'source_operation_time', nativeDurationMs: null, tool: null, exitCode: null, identityKnown: true,
    replayOf: null, targetConflict: false, gapCodes: [],
  }] };
  const recordText = renderTimingResult(records);
  assert.match(recordText, /use-1\tobject-1\tTargeted Skill read\tused\tFailed\t\t\tread/);
  assert.match(recordText, /use-2\tobject-1\tUse record\tcandidate\t\t\t\tread/);
  assert.match(recordText, /Result records conflict/);
  assert.match(recordText, /Declined/);
  assert.doesNotMatch(recordText, /Outcome not established|Turn state not established/);
  assert.match(recordText, /operation_result_conflict, time_missing/); assert.equal(timingExitCode(records), 0);
  locale.setLocale('zh'); assert.match(renderTimingResult(records), /已拒绝/);
});


test('partial object counts retain observed associations including zero without presenting a full total', () => {
 const saved=locale.getSnapshot().locale;
 try {for(const language of ['zh','en'] as const){locale.setLocale(language);
  for(const count of [0,2]){
   const metric={value:count,status:'observed' as const,basis:'canonical_use_identity' as const,evidenceRefs:[]};
   const missing={value:null,status:'unavailable' as const,basis:'missing_target' as const,evidenceRefs:[]};
   const result:TimingResult={outputVersion:1,action:'evidence',profile:'local',methodVersion:local.methodVersion,snapshotId:local.readView.snapshotId,scope:local.scope,totals:local.uses.totals,total:{...metric,value:1},nextCursor:null,collection:'use_objects',rows:[{objectRef:'synthetic-object',kind:'mcp',state:'used',path:null,server:'synthetic-server',project:null,useCount:missing,associatedUseCount:metric,recordCount:{...metric,value:3},unassignedTurnRecords:{...metric,value:0},coverage:local.uses.totals.coverage}]};
   const text=renderTimingResult(result);
   assert.match(text,new RegExp(`已关联次数: ${count}|Associated uses: ${count}`));
   assert.match(text,/完整使用次数|Full use count/);
   assert.match(text,/证据缺口|evidence gaps/);
   assert.match(text,/0 不证明未使用|0 does not prove absence of use/);
   assert.doesNotMatch(text,/使用次数: 0|\tUses: 0/);
  }
 }}finally{locale.setLocale(saved);}
});
