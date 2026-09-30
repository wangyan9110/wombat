import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRenderer } from '@opentui/core/testing';
import type { UsageClient, UsageResult, UsageSummary } from '@wombat/client';
import { locale } from '@wombat/client/locale';
import { runTerminalAppWithUI } from '../src/app.js';
import { TerminalUI } from '../src/components/terminal-ui.js';
import { effort, usageLabel } from '../src/screens/format.js';
import { loadingContent } from '../src/components/loading-model.js';
const usage: UsageSummary = { tokens: { input: 10000, output: 2000, cacheRead: 0, cacheCreate: 0, reasoning: 0, total: 12000 }, measurementCount: 1,
  price: { currency: 'USD', policy: 'synthetic', priceRevision: 'fixture', basis: [], issues: [], components: [], status: 'priced', cost: '0.1', knownCost: '0.1' } };
const result: UsageResult = { outputVersion: 3, action: 'usage', snapshotRef: { snapshotId: 'synthetic', createdAt: '2026-09-30T00:00:00Z' }, scope: { timezone: 'UTC', since: '2026-09-30', until: '2026-10-01' }, summary: usage,
  items: [], page: { offset: 0, limit: 50, total: 0 }, quality: { status: 'complete', issues: [], sources: [] } };
test('English quantity magnitude and progress signals survive runtime switches', () => {
  try {
    locale.setLocale('en'); assert.match(usageLabel(usage, false, true), /12K/); assert.equal(effort('high'), 'High');
    const content = loadingContent({ spec: { kind: 'refresh' }, stage: '保存用量', cancelling: false });
    assert.ok(content.detail === 'Save usage' || content.stages.some(stage => stage.name === 'Save usage'), 'known progress is translated');
    locale.setLocale('zh'); assert.match(usageLabel(usage, false, true), /1.2万/);
  } finally { locale.setLocale('zh'); }
});
test('native terminal switches languages and preserves source titles and query scope', { timeout: 20000 }, async () => {
  for (const width of [40, 80, 120]) {
    locale.setLocale('zh');
    const setup = await createTestRenderer({ width, height: 30, exitOnCtrlC: false });
    const ui = new TerminalUI(setup.renderer);
    let queries = 0;
    const client: UsageClient = { async prices() { throw new Error('unused'); }, async query(request) {
      queries++;
      assert.equal(request.snapshotId, 'synthetic');
      return { ...result, action: request.action, page: { offset: 0, limit: 50, total: request.action === 'threads' ? 1 : 0 }, items: request.action === 'threads' ? [{ kind: 'thread', id: 'thread', agentKind: 'codex', sourceInstanceId: 'fixture', title: '原始中文标题', models: [], reasoningEfforts: [], threadUsage: usage, matchedUsage: usage }] : [] };
    } };
    const run = runTerminalAppWithUI({ action: 'usage', snapshotId: 'synthetic' }, client, ui);
    try {
      await setup.waitForFrame(frame => frame.includes('日报'));
      const count = queries;
      setup.mockInput.pressKey('l'); await setup.waitForFrame(frame => frame.includes('Daily report'));
      assert.equal(queries, count, 'changing language must not query or rescan data');
      setup.mockInput.pressKey('g'); await setup.waitForFrame(frame => frame.includes('Weekly report'));
      setup.mockInput.pressKey('2'); await setup.waitForFrame(frame => frame.includes('原始中文标题'));
      setup.mockInput.pressKey('f'); await setup.waitForFrame(frame => frame.includes('Filters'));
      setup.mockInput.pressEscape(); await new Promise(resolve => setTimeout(resolve, 80)); await setup.waitForFrame(frame => frame.includes('原始中文标题'));
      setup.mockInput.pressKey('l'); await setup.waitForFrame(frame => frame.includes('1 用量'));
      setup.mockInput.pressKey('q'); assert.equal(await run, 0);
    } finally { if (!ui.signal.aborted) setup.mockInput.pressCtrlC(); await run; locale.setLocale('zh'); }
  }
});
