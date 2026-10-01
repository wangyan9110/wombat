import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRenderer } from '@opentui/core/testing';
import type { UsageClient, UsageResult, UsageSummary } from '@wombat/client';
import { locale } from '@wombat/client/locale';
import { runTerminalAppWithUI } from '../src/app.js';
import { TerminalUI } from '../src/components/terminal-ui.js';
import { effort, itemContent, usageHeaderCells, usageLabel, usageTotalCells } from '../src/screens/format.js';
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
test('weekly and monthly reports keep bilingual headers and compact model labels on single lines', async () => {
  for (const language of ['zh', 'en'] as const) for (const period of ['weekly', 'monthly'] as const) for (const [width, height] of [[40, 14], [80, 24], [120, 32]]) {
    locale.setLocale(language);
    const setup = await createTestRenderer({ width, height });
    const ui = new TerminalUI(setup.renderer);
    const scope = period === 'weekly'
      ? { since: '2025-12-29', until: '2026-01-05', timezone: 'UTC' }
      : { since: '2026-09-01', until: '2026-10-01', timezone: 'UTC' };
    const report = { ...result, scope, availableRange: scope };
    const subtotal = { kind: 'usage' as const, isSubtotal: true, date: scope.since, scope, usage };
    const model = { ...subtotal, isSubtotal: false, model: 'gpt-5.4', reasoningEffort: 'high' };
    const periodLabels = [locale.t('common.daily'), locale.t('common.weekly'), locale.t('common.monthly')];
    try {
      void ui.choose({ title: locale.t(period === 'weekly' ? 'tui.app.weekly_report' : 'tui.app.monthly_report'), intro: [],
        nav: 'usage threads', activeTab: locale.t('common.1_usage'), controlKind: 'group', controlOptions: periodLabels,
        activeControl: periodLabels[period === 'weekly' ? 1 : 2], footer: 'Q', tableCells: usageHeaderCells(width),
        totalCells: usageTotalCells(usage, width), choices: [
          { id: 'subtotal', kind: 'subtotal', reportGroup: 'period', ...itemContent(subtotal, report, width) },
          { id: 'model', kind: 'model', reportGroup: 'period', ...itemContent(model, report, width) },
        ] });
      await setup.flush(); await setup.renderOnce();
      const root = setup.renderer.root;
      assert.equal(root.findDescendantById('title')!.height, 1, `${language}/${period}/${width}: title`);
      assert.equal(root.findDescendantById('table-header-grid')!.height, language === 'en' && width === 120 ? 2 : 1, `${language}/${period}/${width}: table header`);
      if (width === 40) {
        const label = root.findDescendantById('row-1-label')!;
        const grid = root.findDescendantById('row-1-grid')!;
        assert(label, `${language}/${period}: full model label`);
        assert.equal(label.height, 1);
        assert(grid.y > label.y, 'numeric tracks follow the complete model label');
      }
      if (width === 120) assert.equal(root.findDescendantById('table-header')!.height, language === 'en' ? 3 : 2, 'header text plus one rule');
    } finally { ui.destroy(); locale.setLocale('zh'); }
  }
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
      setup.mockInput.pressKey('l'); await setup.waitForFrame(frame => frame.includes('用量'));
      setup.mockInput.pressKey('q'); assert.equal(await run, 0);
    } finally { if (!ui.signal.aborted) setup.mockInput.pressCtrlC(); await run; locale.setLocale('zh'); }
  }
});
