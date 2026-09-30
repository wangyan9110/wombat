import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarDateShift, dateLabel, effort, itemContent, money, rangeLabel, summaryDetails, usageLabel, usageHeaderCells, usageTotalCells } from '../src/screens/format.js';
import type { UsageResult, UsageSummary } from '@wombat/client';
const usage: UsageSummary = { tokens: { input: 10, cacheRead: 90, cacheCreate: 0, output: 10, reasoning: 3, total: 110 }, measurementCount: 1, price: { currency: 'USD', policy: 'synthetic', priceRevision: 'synthetic', basis: [], issues: [], cost: '0.00012', knownCost: '0.00012', status: 'priced', components: [{ category: 'input', cost: '0.00001', knownCost: '0.00001', status: 'priced' }, { category: 'cacheRead', cost: '0.00001', knownCost: '0.00001', status: 'priced' }, { category: 'cacheCreate', cost: '0', knownCost: '0', status: 'priced' }, { category: 'output', cost: '0.0001', knownCost: '0.0001', status: 'priced' }] } };
const result: UsageResult = { outputVersion: 3, action: 'turns', snapshotRef: { snapshotId: 'synthetic', createdAt: '2026-09-30T01:20:31Z' }, scope: { timezone: 'Asia/Shanghai', since: '2026-09-29', until: '2026-09-30' }, availableRange: { since: '2026-09-29', until: '2026-09-30' }, summary: usage, page: { offset: 0, limit: 50, total: 1 }, quality: { status: 'complete', issues: [], sources: [] }, items: [{ kind: 'turn', id: 'turn-safe', threadId: 'thread-safe', ordinal: 1, startedAt: '2026-09-29T01:00:01Z', endedAt: '2026-09-29T01:00:20Z', models: ['gpt-5.4'], reasoningEfforts: ['high'], status: 'completed', usage, matchedUsage: usage, share: 1 }] };
test('v1 money preserves exact decimal strings, tiny nonzero and unknown meaning', () => {
  assert.equal(money('999999999999999999.995'), '$1,000,000,000,000,000,000.00');
  assert.equal(money('0.0000001', 4), '<$0.0001');
  assert.equal(money('0.009'), '<$0.01');
  assert.equal(money('0'), '$0.00');
  assert.equal(money(null), '—');
  assert.equal(money('1.23455', 4), '$1.2346');
  assert.equal(usageLabel(usage), '110 Token · <$0.01');
  assert.match(usageLabel({ ...usage, price: { ...usage.price, cost: null, status: 'unknown' } }), /费用未知$/);
  assert.match(usageLabel({ ...usage, price: { ...usage.price, cost: null, status: 'partial' } }), /\*$/);
  assert.equal(summaryDetails(usage).at(-1), '其中推理  3 Token');
});

test('v1 dates follow calendar timezone and do not invent source seconds', () => {
  const reference = '2026-09-30T00:00:00Z';
  assert.equal(rangeLabel('2026-09-23', '2026-09-30', reference), '9月23日—29日');
  assert.equal(rangeLabel('2026-09-29', '2026-09-30', reference), '9月29日');
  assert.equal(rangeLabel('2025-12-31', '2026-01-02', reference), '2025年12月31日—1月1日');
  assert.equal(dateLabel('2026-09-29T20:02:03Z', reference, 'Asia/Shanghai', true), '9月30日 04:02:03');
  assert.equal(dateLabel('2026-09-29T20:02Z', reference, 'Asia/Shanghai', true), '9月30日 04:02');
  assert.equal(calendarDateShift('2026-03-08', 1), '2026-03-09');
  assert.equal(calendarDateShift('2026-12-31', 1), '2027-01-01');
  assert.equal(effort('high'), '高');
  assert.equal(effort('custom'), 'custom');
});

test('semantic content preserves Token, cost and model without terminal width padding', () => {
  for (const width of [40, 80, 120]) {
    const content = itemContent(result.items[0], result, width);
    assert.match(content.headline!.amount, /110 Token · <\$0\.01/);
    assert.match(content.lines.join('\n'), /gpt-5\.4/);
    assert(content.lines.every(line => line === line.trim()));
    assert.doesNotMatch(content.lines.join(''), /[━─]|API估算|词元|袋熊/);
    assert.equal(content.bar, 1);
  }
});

test('v1 daily rows and whole-turn metrics remain consistent after a date drill', () => {
  const daily = { kind: 'usage' as const, date: '2026-09-29', endDate: '2026-09-29', isSubtotal: true, model: null, reasoningEffort: null, usage, scope: { since: '2026-09-29', until: '2026-09-30' } };
  assert.match(itemContent(daily, result, 80).cells!.map(cell => cell.text).join('\n'), /9月29日/);
  assert.doesNotMatch(itemContent(daily, result, 80).cells!.map(cell => cell.text).join('\n'), /9月28日/);
  const turn = result.items[0];
  assert.equal(turn.kind, 'turn');
  if (turn.kind !== 'turn') return;
  const filtered = { ...turn, matchedUsage: { ...usage, measurementCount: 0, tokens: { ...usage.tokens, total: 0 } } };
  for (const width of [36, 76, 116]) assert.match(itemContent(filtered, result, width).headline!.amount, /110 Token/);
});

test('v1 absent measurements are not presented as free use', () => {
  assert.equal(usageLabel({ ...usage, measurementCount: 0 }), '暂无用量记录');
  assert.match(usageLabel({ ...usage, tokens: { ...usage.tokens, total: 0 }, price: { ...usage.price, cost: '0', knownCost: '0' } }), /0 Token · \$0.00/);
});

test('v1 normalized timestamps retain recorded time precision', () => {
  const stamp = '2026-09-29T20:02:00.123456789Z';
  assert.equal(dateLabel(stamp, stamp, 'Asia/Shanghai', true, 'minute'), '9月30日 04:02');
  assert.equal(dateLabel(stamp, stamp, 'Asia/Shanghai', true, 'date'), '9月30日');
  assert.equal(dateLabel(stamp, stamp, 'Asia/Shanghai', true, 'microsecond'), '9月30日 04:02:00.123456');
});

test('daily cells preserve cross-year dates and full model names for native wrapping', () => {
  const daily = { kind: 'usage' as const, date: '2025-12-31', isSubtotal: true, usage, scope: { since: '2025-12-31', until: '2026-01-01' } };
  const modelName = 'gpt-5.4-extra-long-version-2026-09-30';
  for (const width of [80, 120]) {
    const cells = itemContent(daily, result, width).cells!;
    assert.equal(cells[0].text, '2025年12月31日 ›');
    assert.equal(cells.length, usageHeaderCells(width).length);
    assert.equal(cells.length, usageTotalCells(usage, width).length);
    const model = itemContent({ ...daily, isSubtotal: false, model: modelName, reasoningEffort: 'high' }, result, width).cells!;
    assert.equal(model[1].text, modelName);
    assert.ok((model[1].grow ?? 0) > 0, "model column remains flexible for full names");
    assert.equal(model.at(-1)!.align, 'right');
  }
  const compact = itemContent({ ...daily, isSubtotal: false, model: modelName, reasoningEffort: 'high' }, result, 40);
  assert.equal(compact.cells!.length, 3);
  assert(compact.cells![0].text.includes(modelName));
});
