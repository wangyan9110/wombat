import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseMonitorArgs, runMonitorChecks } from '../src/monitor-cli.js';
import { CoreError, type UsageClient, type MonitorResult } from '@wombat/client';
import { withTokenAnalysis } from '../../tests/fixtures/token-analysis.js';
test('monitor rejects ambiguous writes and unsafe budgets before transport', () => {
  for (const args of [
    ['set', '--id', 'x'],
    ['set', '--id', 'x', '--tokens', '9007199254740992'],
    ['set', '--id', 'x', '--tokens', '0'],
    ['set', '--id', 'x', '--tokens', '100', '--warning', '1.1'],
    ['set', '--id', 'x', '--period', 'year', '--review'],
    ['list', '--review'],
    ['check', '--snapshot', 'x'],
    ['check', '--snapshot', 'x', '--id', 'x', '--root', '.'],
    ['watch', '--interval', '4'],
    ['watch', '--interval', '3601'],
    ['watch', '--id', 'a', '--id', 'b'],
    ['remove', '--id', 'x', '--tokens', '1'],
    ['list', '--json=1'],
  ])
    assert.throws(() => parseMonitorArgs([...args]), { code: 'INVALID_ARGUMENT' });
  const set = parseMonitorArgs(['set', '--id=x', '--tokens=100', '--project=.', '--timezone=UTC']);
  assert.equal(set.request?.action, 'upsert');
  if (set.request?.action === 'upsert')
    assert.equal(set.request.plan.scope?.project, path.resolve('.'));
  const check = parseMonitorArgs(['check', '--id=x', '--root=.']);
  assert.deepEqual(check.ids, ['x']);
  assert.deepEqual(check.roots, [path.resolve('.')]);
});

test('watch reloads plans after concurrent edits but exposes non-retryable failures', async () => {
  const settings: MonitorResult = {
    outputVersion: 1,
    action: 'list',
    plans: [{ id: 'budget', enabled: true, period: 'month', review: false, tokenLimit: 100 }],
    notifications: [],
    checkedAt: new Date().toISOString(),
    hostRequired: true,
  };
  const controller = new AbortController();
  let lists = 0,
    checks = 0;
  const retries: string[] = [];
  const client: UsageClient = {
    query: async () => {
      throw new Error('Unexpected historical query');
    },
    prices: async () => {
      throw new Error('Unexpected pricing query');
    },
    monitor: async (request) => {
      if (request.action === 'list') {
        lists++;
        return settings;
      }
      if (++checks === 1) throw new CoreError('MONITOR_CHANGED', 'Plan changed');
      controller.abort();
      return { ...settings, action: 'check', snapshotId: 'synthetic' };
    },
    live: async () => ({
      outputVersion: 1,
      freshness: { status: 'current', revision: 'synthetic' },
      result: {
        outputVersion: 5,
        action: 'usage',
        snapshotRef: { snapshotId: 'synthetic', createdAt: new Date().toISOString() },
        scope: {},
        availableRange: {},
        summary: withTokenAnalysis({
          tokens: {},
          measurementCount: 0,
          price: {
            currency: 'USD',
            policy: 'synthetic',
            priceRevision: 'synthetic',
            knownCost: '0',
            status: 'unpriced',
            components: [],
            basis: [],
            issues: [],
          },
        }),
        items: [],
        page: { offset: 0, limit: 1, total: 0 },
        quality: { status: 'complete', issues: [], sources: [] },
      },
    }),
  };
  assert.equal(
    await runMonitorChecks(
      client,
      { roots: [], watch: true, interval: 0 },
      controller.signal,
      () => {},
      (error) => retries.push(error.code),
    ),
    130,
  );
  assert.equal(lists, 2);
  assert.equal(checks, 2);
  assert.deepEqual(retries, ['MONITOR_CHANGED']);
  const failing = {
    ...client,
    monitor: async () => {
      throw new CoreError('INVALID_ARGUMENT', 'Invalid plan');
    },
  };
  await assert.rejects(
    runMonitorChecks(
      failing,
      { roots: [], watch: true, interval: 0 },
      new AbortController().signal,
      () => {},
      () => assert.fail('Permanent errors must not retry'),
    ),
    { code: 'INVALID_ARGUMENT' },
  );
  await assert.rejects(
    runMonitorChecks(
      {
        ...client,
        monitor: async () => {
          throw new CoreError('MONITOR_CHANGED', 'Plan changed');
        },
      },
      { roots: [], watch: false, interval: 0 },
      new AbortController().signal,
      () => {},
      () => assert.fail('A single check must not loop'),
    ),
    { code: 'MONITOR_CHANGED' },
  );
});
