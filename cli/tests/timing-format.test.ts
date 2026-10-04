import test from 'node:test';
import assert from 'node:assert/strict';
import { locale } from '@wombat/client/locale';
import { renderTimingResult, timingExitCode } from '../src/timing-format.js';
import { local, share, capabilityResult } from './timing-fixtures.js';
import type { TimingResult } from '@wombat/client';

test('human timing preserves explicit zero unknown independent durations and concurrent interval measures', () => {
  locale.setLocale('en');
  const fixture = structuredClone(local);
  fixture.time.nativeWallClockMs = { value: 0, status: 'observed', basis: 'native_record', evidenceRefs: [] };
  fixture.time.derivedWallClockMs = { value: 40, status: 'derived', basis: 'explicit_boundary', evidenceRefs: [] };
  fixture.time.command.unionMs.value = 30; fixture.time.command.sumMs.value = 50;
  fixture.time.reasoning.unionMs.value = 20; fixture.time.reasoning.sumMs.value = 35;
  const text = renderTimingResult(fixture);
  assert.match(text, /Native total duration: 0 ms/); assert.match(text, /Boundary-derived total duration: 40 ms/);
  assert.match(text, /Native time to first Token: Unknown/); assert.match(text, /Commands: union 30 ms; sum 50 ms/);
  assert.match(text, /Reasoning: union 20 ms; sum 35 ms/); assert.match(text, /category sums are not total duration/);
  assert.doesNotMatch(text, /total duration: 85/);
  locale.setLocale('zh'); const zh = renderTimingResult(fixture);
  assert.match(zh, /原生总耗时: 0 ms/); assert.match(zh, /边界推导总耗时: 40 ms/); assert.match(zh, /原生首 Token 延迟: 未知/);
  assert.match(zh, /并集 30 ms；相加 50 ms/);
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
test('object and record pages preserve unknown counts, failed uses and safe display text', () => {
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
  assert.match(text, /object-1\tskill\tused/); assert.match(text, /Unknown/); assert.match(text, /1 · Source record/); assert.doesNotMatch(text, /\u001b/);
  const records: TimingResult = { ...base, collection: 'use_records', objectRef: 'object-1', rows: [{
    reference: 'use-1', objectRef: 'object-1', kind: 'skill_read', state: 'used', outcome: 'failed', timestampMs: null,
    timeBasis: 'unknown', nativeDurationMs: null, tool: 'read', exitCode: 1, identityKnown: true,
    replayOf: null, targetConflict: false, gapCodes: ['time_missing'],
  }] };
  assert.match(renderTimingResult(records), /use-1\tobject-1\tskill_read\tused\tfailed\tUnknown/);
  assert.match(renderTimingResult(records), /time_missing/); assert.equal(timingExitCode(records), 0);
});
