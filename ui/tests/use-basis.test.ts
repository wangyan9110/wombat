import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { locale, type PublicUseBasis } from '@wombat/client/locale';
import { UseBasis } from '../src/UseBasis.js';
import { FollowUp } from '../src/optimize/FollowUp.js';
const basis: PublicUseBasis = { methodVersion: 2, status: 'observed', unit: 'rule_read', capturedAt: '2026-10-02T00:00:00Z', snapshotId: 'live:captured', scope: { sourceInstanceIds: ['synthetic'], project: null, threadId: null, agentKind: null, window: { kind: 'follow_up', after: '2026-10-01T00:00:00Z', through: '2026-10-02T00:00:00Z' } }, timeBasis: 'source_operation_time', coverage: { dispatchGaps: 0, identityGaps: 0, targetGaps: 0, timeGaps: 0, turnGaps: 0 }, sourceCompleteness: 'complete' };
test('fixed basis displays known zero coverage separately from unavailable observations in both languages', () => {
  const saved = locale.getSnapshot().locale;
  try { for (const language of ['zh', 'en'] as const) {
    locale.setLocale(language);
    const observed = renderToStaticMarkup(createElement(UseBasis, { basis }));
    assert.match(observed, /已采集|captured fixed scope/); assert.match(observed, /不证明|does not prove absence/);
    assert.match(observed, /live:captured/); assert.match(observed, /方法版本|Method version/);
    assert.match(observed, /派发依据缺口|Dispatch evidence gaps/);
    const unknown = renderToStaticMarkup(createElement(UseBasis, { basis: { ...basis, status: 'unknown', coverage: { identityGaps: 1 } } }));
    assert.match(unknown, /次数未知|count unknown/);
    const unavailable = renderToStaticMarkup(createElement(UseBasis, { basis: null }));
    assert.match(unavailable, /没有|No fixed/); assert.doesNotMatch(unavailable, /gaps: 0|缺口：0/);
    const follow = renderToStaticMarkup(createElement(FollowUp, { observation: { recordId: 'record', suggestionId: 'suggestion', status: 'no_observed_records', after: '2026-10-01T00:00:00Z', observedAt: basis.capturedAt, observedRecords: 0, lastRecordAt: null, usageRevision: basis.snapshotId, absenceObservable: false, useBasis: basis }, timezone: 'UTC' }));
    assert.match(follow, /已采集|captured fixed scope/); assert.match(follow, /不证明|不代表|cannot|does not prove/);
    assert.doesNotMatch(follow, /dispatchGaps|sourceCompleteness|\{"/);
  } } finally { locale.setLocale(saved); }
});

test('preview inventory and follow-up examples use the same public validator and pinned scope', async () => {
  const { createUsageClient } = await import('@wombat/client');
  const { inventoryFixture } = await import('../src/preview/inventory.js');
  const { createRuleFixture } = await import('../src/preview/configuration.js');
  const { syntheticFollowUp } = await import('../src/preview/use-basis.js');
  const rules = createRuleFixture(false, 'resolved');
  const client = createUsageClient({ query: async () => { throw new Error('not used'); }, config: async request => inventoryFixture(request), optimize: async request => rules(request) });
  for (const kind of ['rule', 'skill', 'mcp'] as const) {
    const result = await client.config!({ action: 'list', kind, scope: { allTime: true, sourceInstanceId: 'preview', project: '/synthetic/wombat' } });
    const item = result.items.find(item => item.id === `preview-${kind}`)!;
    assert.equal(item.useBasis?.methodVersion, 2); assert.equal(item.useBasis?.status, 'observed');
    assert.equal(item.useBasis?.scope.project, '/synthetic/wombat'); assert.deepEqual(item.useBasis?.scope.sourceInstanceIds, ['preview']);
    assert.equal(item.useBasis?.scope.window.kind, 'all_history'); assert.equal(item.useBasis?.snapshotId, result.usageRevision);
  }
  const checked = await client.optimize!({ action: 'recheck' });
  assert.equal(checked.followUps.length, 1); assert.equal(checked.followUps[0].useBasis?.status, 'observed');
  const saved = locale.getSnapshot().locale;
  try { for(const language of ['zh','en'] as const){locale.setLocale(language);
    for(const unknown of [false,true]){
      const row = syntheticFollowUp(unknown);
      const response = { ...checked, checkedAt: row.observedAt, followUps: [row] };
      const mock = createUsageClient({ query: async () => { throw new Error('not used'); }, optimize: async () => response });
      const result = await mock.optimize!({action:'recheck'});
      assert.equal(result.followUps[0].observedRecords, unknown ? null : 1);
      const html = renderToStaticMarkup(createElement(FollowUp,{observation:result.followUps[0],timezone:'UTC'}));
      assert.match(html,unknown?/次数未知|count unknown/:/已采集|captured fixed scope/);
    }
  }}finally{locale.setLocale(saved);}
});
