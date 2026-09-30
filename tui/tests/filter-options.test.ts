import test from 'node:test';
import assert from 'node:assert/strict';
import { CoreError, type UsageClient, type UsageItem, type UsageRequest, type UsageResult, type UsageSummary } from '@wombat/client';
import { loadFilterOptions } from '../src/state/filter-options.js';
const summary: UsageSummary = { tokens: {}, measurementCount: 0, price: { currency: 'USD', policy: 'synthetic', priceRevision: 'fixture', knownCost: '0', status: 'unknown', components: [], basis: [], issues: [] } };
function result(request: UsageRequest, items: UsageItem[], total = items.length, nextOffset?: number): UsageResult {
  return { outputVersion: 3, action: request.action, snapshotRef: { snapshotId: 'fixed-generation', selector: '/synthetic/legacy.json', createdAt: '2026-09-30T00:00:00Z' }, scope: request.scope ?? {}, availableRange: { since: '2020-01-01', until: '2026-10-01' }, summary, items, page: { offset: request.offset ?? 0, limit: 500, total, nextOffset }, quality: { status: 'complete', issues: [], sources: [] } };
}
const thread = (project: string): UsageItem => ({ kind: 'thread', id: project, project, models: ['thread-only-metadata'], agentKind: 'codex', sourceInstanceId: 'root-a', reasoningEfforts: [], matchedUsage: summary, threadUsage: summary });
const usage = (model?: string, isSubtotal = false): UsageItem => ({ kind: 'usage', model, isSubtotal, scope: {}, usage: summary });
test('choices span all pages and unlinked usage; filters do not narrow candidates or change source identity', async () => {
  const requests: UsageRequest[] = [];
  const query: UsageClient['query'] = async request => {
    requests.push(request);
    if (request.action === 'threads') return request.offset === 0
      ? result(request, Array.from({ length: 500 }, (_, i) => thread(`/synthetic/project-${i}`)), 501, 500)
      : result(request, [thread('/synthetic/last-page')], 501);
    if (request.scope?.undated) return result(request, [usage('undated-model')]);
    return request.offset === 0 ? result(request, [usage(undefined, true), usage('gpt-a')], 4, 2)
      : result(request, [usage('gpt-a'), usage('unlinked-model')], 4);
  };
  const choices = await loadFilterOptions(query, { action: 'usage', snapshotId: 'fixed-generation', search: 'narrow', offset: 50, scope: { agentKind: 'codex', sourceInstanceId: 'root-a', threadId: 'thread-a', since: '2026-09-30', until: '2026-10-01', project: '/filter', model: 'filter', modelUnknown: true, reasoningEffort: 'high', timezone: 'Asia/Shanghai' } });
  assert.equal(choices.projects.length, 501); assert(choices.projects.includes('/synthetic/last-page'));
  assert.deepEqual(choices.models, ['gpt-a', 'undated-model', 'unlinked-model']);
  assert.equal(requests[0].snapshotId, 'fixed-generation');
  for (const request of requests) {
    assert.deepEqual(request.scope, { agentKind: 'codex', sourceInstanceId: 'root-a', threadId: 'thread-a', timezone: 'UTC', ...(request.action === 'usage' ? request.scope?.undated ? { undated: true } : { since: '2020-01-01', until: '2026-10-01' } : {}) });
    assert.equal(request.search, undefined);
  }
  assert(requests.slice(1).every(request => request.snapshotId === '/synthetic/legacy.json'));
});
test('project choices on the conversation entry do not request the usage ledger', async () => {
  const actions: string[] = [];
  const choices = await loadFilterOptions(async request => { actions.push(request.action); return result(request, [thread('/synthetic/project'), thread('/synthetic/project')]); }, { action: 'threads' });
  assert.deepEqual(actions, ['threads']); assert.deepEqual(choices.projects, ['/synthetic/project']);
});
test('failed or inconsistent pages never become a complete dropdown', async () => {
  for (const mode of ['stalled', 'short', 'changed', 'failure', 'cancelled']) {
    let calls = 0;
    await assert.rejects(loadFilterOptions(async request => {
      calls++;
      if (mode === 'failure' || mode === 'cancelled') throw new CoreError(mode === 'cancelled' ? 'CANCELLED' : 'QUERY_FAILED', mode);
      const response = result(request, [thread('/synthetic/one')], 2, calls === 1 ? 1 : undefined);
      if (mode === 'stalled') response.page.nextOffset = 0;
      if (mode === 'short') response.page.nextOffset = undefined;
      if (mode === 'changed' && calls === 2) response.snapshotRef.snapshotId = 'another-generation';
      return response;
    }, { action: 'threads' }), CoreError);
    assert(calls <= 2);
  }
});
