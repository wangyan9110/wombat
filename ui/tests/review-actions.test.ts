import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OptimizeRequest, OptimizeResult, UsageClient } from '@wombat/client';
import { applyReview } from '../src/optimize/review-actions.js';
import { reviewStateLabel } from '../src/optimize/presentation.js';
import { locale } from '@wombat/client/locale';

test('recheck reads exact target outcome independently of category, page and other pending problems', async () => {
  for (const status of ['verified', 'stillNeedsReview', 'recheckUnavailable']) {
    const calls: OptimizeRequest[] = [];
    const result = { readView: 'config:new', decisionRevision: '9', pending: 40, suggestions: [] } as unknown as OptimizeResult;
    const client = { optimize: async (r: OptimizeRequest) => { calls.push(r); return r.action === 'detail' ? { ...result, suggestions: [{ id: 'target', status, decision: null }] } : result; } } as UsageClient;
    const { patch } = await applyReview(client, { action: 'recheck', suggestionId: 'target', readView: 'config:old', decisionRevision: '8', category: 'repair', offset: 30, project: '/a', sourceInstanceId: 's' }, new AbortController().signal);
    assert.equal(patch.optimizeGroup, status === 'verified' ? 'history' : 'pending');
    assert.equal(patch.optimizeView, 'config:new');
    assert.equal(calls[1].project, '/a'); assert.equal(calls[1].sourceInstanceId, 's');
    assert.equal(calls[1].decisionRevision, '9'); assert.equal(calls[1].suggestionId, 'target');
    assert.equal(calls[1].group, 'history'); assert.equal(calls[1].category, undefined);
    assert.equal(calls[1].offset, 0); assert.equal(calls[1].limit, 1);
  }
});

test('recheck preserves a keep decision; bulk checks stay pending until every problem is resolved', async () => {
  const base = { readView: 'v', decisionRevision: '2', pending: 1, suggestions: [] } as unknown as OptimizeResult;
  const client = { optimize: async (r: OptimizeRequest) => r.action === 'detail' ? { ...base, suggestions: [{ id: 'kept', status: 'stillNeedsReview', decision: { kind: 'keep' } }] } : base } as UsageClient;
  assert.equal((await applyReview(client, { action: 'recheck', suggestionId: 'kept' }, new AbortController().signal)).patch.optimizeGroup, 'history');
  assert.equal((await applyReview(client, { action: 'recheck' }, new AbortController().signal)).patch.optimizeGroup, 'pending');
  base.pending = 0;
  assert.equal((await applyReview(client, { action: 'recheck' }, new AbortController().signal)).patch.optimizeGroup, 'history');
});

test('aborted mutation never performs a second read or returns navigation', async () => {
  const c = new AbortController(); let calls = 0;
  const client = { optimize: async () => { calls++; c.abort(); return {} as OptimizeResult; } } as UsageClient;
  await assert.rejects(applyReview(client, { action: 'keep', suggestionId: 'a' }, c.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('failed or mismatched target reads cannot imply successful resolution', async () => {
  const result = { readView: 'v', decisionRevision: '2', pending: 0, suggestions: [] } as unknown as OptimizeResult;
  const client = { optimize: async () => result } as UsageClient;
  await assert.rejects(applyReview(client, { action: 'recheck', suggestionId: 'a' }, new AbortController().signal), /NOT_FOUND/);
  result.suggestions = [{ id: 'b', status: 'verified' }] as OptimizeResult['suggestions'];
  await assert.rejects(applyReview(client, { action: 'recheck', suggestionId: 'a' }, new AbortController().signal), /NOT_FOUND/);
});

test('handling records show user decisions independently of later check facts in both languages', () => {
  const saved = locale.getSnapshot().locale;
  try {
    for (const language of ['zh', 'en'] as const) {
      locale.setLocale(language);
      const decision = { kind: 'keep' as const, reason: 'necessary' as const, recordedAt: '2026-10-04T00:00:00Z' };
      const kept = reviewStateLabel({ status: 'pending', decision });
      assert.match(kept, /已保留|Kept/); assert.doesNotMatch(kept, /待处理|Pending/);
      const checked = reviewStateLabel({ status: 'verified', decision });
      assert.match(checked, /已保留|Kept/); assert.match(checked, /复查通过|Recheck passed/);
      assert.match(reviewStateLabel({ status: 'pending', decision: { ...decision, kind: 'not_applicable' } }), /不适用|not applicable/i);
    }
  } finally { locale.setLocale(saved); }
});
