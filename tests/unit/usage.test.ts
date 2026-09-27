import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeRange, normalizeUsageSection, shiftDate, validateDate, validateTimezone } from '../../src/usage.js';
import { assertSnapshot } from '../../src/contracts.js';

test('日期为含起点不含终点，拒绝非法日期和时区', () => {
  assert.deepEqual(normalizeRange('2026-09-26', '2026-09-28', 'Asia/Shanghai'), { since: '2026-09-26', until: '2026-09-28' });
  assert.equal(shiftDate('2024-02-29', 1), '2024-03-01');
  assert.throws(() => validateDate('2026-02-30'), /无效日期/);
  assert.throws(() => validateTimezone('Mars/Phobos'), /无效时区/);
  assert.throws(() => normalizeRange('2026-09-28', '2026-09-28', 'UTC'), /早于/);
});

test('按 Agent 拆开 ccusage 周期行且不重复聚合缓存', () => {
  const section = normalizeUsageSection({ daily: [{
    period: '2026-09-26', totalTokens: 150, totalCost: 1,
    agents: [{ agent: 'codex', inputTokens: 30, outputTokens: 10, cacheReadTokens: 40, totalTokens: 80, totalCost: 1, modelBreakdowns: [{ modelName: 'a', missingPricing: true }] },
      { agent: 'claude', inputTokens: 20, outputTokens: 10, cacheReadTokens: 40, totalTokens: 70, totalCost: 0, modelBreakdowns: [{ modelName: 'b' }] }],
  }], totals: { totalTokens: 150, totalCost: 1, unpricedModels: ['a'] } }, 'daily');
  assert.equal(section.rows.length, 2);
  assert.deepEqual(section.rows.map(row => row.agent), ['codex', 'claude']);
  assert.equal(section.rows.reduce((sum, row) => sum + (row.totalTokens ?? 0), 0), 150);
  assert.equal(section.rows[0].pricing, 'unpriced');
  assert.equal(section.rows[1].costUSD, 0);
  assert.equal(section.totals?.totalTokens, 150);
});

test('缺失和零值不同，超大整数显式拒绝', () => {
  const section = normalizeUsageSection({ session: [{ session: 's1', inputTokens: 0, outputTokens: 0, totalTokens: 0 }] }, 'session');
  assert.equal(section.rows[0].inputTokens, 0);
  assert.equal(section.rows[0].cacheReadTokens, null);
  assert.throws(() => normalizeUsageSection({ daily: [{ totalTokens: Number.MAX_SAFE_INTEGER + 1 }] }, 'daily'), /safe integer/);
  assert.throws(() => assertSnapshot({ schemaVersion: 999, snapshotId: 'x', modules: [], resources: [], findings: [] }), /snapshot.schemaVersion/);
});
