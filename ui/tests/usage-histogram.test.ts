import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UsageClient } from '@wombat/client';
import { locale, t } from '@wombat/client/locale';
import { usageFixture } from '../src/preview/fixtures.js';
import { parseRoute } from '../src/state.js';
registerHooks({ load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url); } });
const { UsageView } = await import('../src/UsageView.js');

test('trend labels keep missing Token totals distinct from observed zero in both locales', () => {
  const route = parseRoute('?page=usage&timezone=UTC');
  const overview = usageFixture({ action: 'usage', scope: {}, limit: 20 }, 'complete');
  const template = overview.items.find(item => item.kind === 'usage');
  assert.ok(template && template.kind === 'usage');
  const base = template;
  const missing = { ...base, isSubtotal: true, date: '2026-10-03', usage: { ...base.usage, tokens: { ...base.usage.tokens, total: null } } };
  const zero = { ...base, isSubtotal: true, date: '2026-10-04', usage: { ...base.usage, tokens: { ...base.usage.tokens, total: 0 } } };
  overview.items = [missing, zero];
  overview.page.total = 2;
  overview.distribution = { maxTokens: null, maxCost: null, peakTokenDates: [], peakCostDates: [], peakTokenScopes: [], peakCostScopes: [] };
  const previous = locale.getSnapshot().locale;
  try {
    for (const language of ['zh', 'en'] as const) {
      locale.setLocale(language);
      const html = renderToStaticMarkup(createElement(UsageView, {
        heading: false, empty: null, setReading() {}, client: {} as UsageClient, refresh() {},
        data: { overview, list: overview, route }, route, navigate() {}, drill() {}, usage() {}, basis() {},
      }));
      const bars = [...html.matchAll(/<button class="bar"[^>]*>/g)].map(match => match[0]);
      assert.equal(bars.length, 2);
      assert.ok(html.includes(`<div class="chart-ceiling">${t('webui.tokenTotalUnavailable')}</div>`));
      assert.doesNotMatch(html, /<div class="chart-ceiling">0 Token<\/div>/);
      assert.doesNotMatch(html, /peak-summary/);
      assert.match(bars[0]!, /height:1%/); // A small bar is only a visual anchor for an unmeasured total.
      assert.ok(bars[0]!.includes(t('webui.tokenTotalUnavailable')));
      assert.doesNotMatch(bars[0]!, /0 Token/);
      assert.match(bars[1]!, /0 Token/);
    }
  } finally {
    locale.setLocale(previous);
  }
});
