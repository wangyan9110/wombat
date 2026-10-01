import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestRenderer } from '@opentui/core/testing';
import { RGBA, type Renderable } from '@opentui/core';
import type { UsageResult, UsageSummary } from '@wombat/client';
import { locale } from '@wombat/client/locale';
import { screenFrame, runTerminalAppWithUI } from '../src/app.js';
import { TerminalUI } from '../src/components/terminal-ui.js';
import { terminalThemes } from '../src/themes/index.js';
const summary: UsageSummary = { measurementCount: 1, tokens: { input: 500, output: 500, cacheRead: 0, cacheCreate: 0, total: 1000 }, price: { status: 'partial', knownCost: '2', cost: null, currency: 'USD', policy: 'synthetic', priceRevision: 'fixture', components: [], basis: [], issues: [] } };
const scope = { timezone: 'UTC', since: '2026-09-01', until: '2026-10-01' };
const result: UsageResult = { action: 'usage', outputVersion: 3, snapshotRef: { snapshotId: 'fixture', createdAt: '2026-09-30T00:00:00Z' }, scope, summary,
 quality: { status: 'complete', issues: [], sources: [] }, page: { offset: 0, limit: 6, total: 3 },
 distribution: { maxTokens: 600, maxCost: '2', peakTokenDates: ['2026-09-29'], peakCostDates: ['2026-09-29'], peakTokenScopes: [{ ...scope, since: '2026-09-29', until: '2026-09-30' }], peakCostScopes: [{ ...scope, since: '2026-09-29', until: '2026-09-30' }] },
 items: [600, 400, null].map((total, index) => ({ kind: 'usage', isSubtotal: true, date: `2026-09-${29-index}`, usage: { ...summary, tokens: { ...summary.tokens, total }, price: index === 2 ? { ...summary.price, status: 'unknown', knownCost: '0' } : { ...summary.price, knownCost: index === 0 ? '2' : '0' } }, scope: { ...scope, since: `2026-09-${29-index}`, until: `2026-09-${30-index}` }, share: total == null ? null : total/1000, costShare: index === 2 ? null : index === 0 ? 1 : 0 })) };
const captures: unknown[] = [];
function geometry(node: Renderable): unknown[] { return [{ id: node.id, x: node.x, y: node.y, width: node.width, height: node.height }, ...node.getChildren().flatMap(geometry)]; }
for (const language of ['zh', 'en'] as const) for (const [width, height] of [[40,14],[80,24],[120,32]]) for (const theme of Object.values(terminalThemes)) test(`distribution ${language}/${theme.id}/${width}: complete labels, shared scale, unknown and cost view`, async () => {
 locale.setLocale(language);
 const setup = await createTestRenderer({ width, height }); const ui = new TerminalUI(setup.renderer, theme, true);
 try {
  for (const metric of ['tokens','cost'] as const) {
   void ui.choose(screenFrame({ request: { action: 'usage', presentation: 'distribution', scope }, result, metric, selected: 0, expanded: new Map(), details: new Set() }, 0));
   await setup.flush(); await setup.waitForVisualIdle();
   const root = setup.renderer.root;
   for (const id of ['group:0-label','group:1-label','group:2-label','metric-label','presentation-label','sort-label']) { const label = root.findDescendantById(id)!; assert.equal(label.height, 1); assert(label.x + label.width <= width, id); }
   assert.equal(root.findDescendantById('sort-label')!.y, root.findDescendantById('group:0-label')!.y, 'toolbar labels share one baseline');
   const meter = root.findDescendantById('row-0-meter')!, fill = root.findDescendantById('row-0-fill')!;
   assert.equal(fill.width, meter.width, 'peak fills the common scale');
   assert.equal(root.findDescendantById('row-2-fill'), undefined, 'unknown has no numeric fill');
   assert.equal(root.findDescendantById('row-2-unknown-track')!.width, root.findDescendantById('row-2-meter')!.width, 'unknown values retain the complete patterned scale track');
   const stroke = setup.captureCharFrame().split('\n')[meter.y];
   assert.equal((stroke.match(/━+/g) ?? []).join(''), '━'.repeat(meter.width), 'distribution bars paint a centered stroke rather than a lower block');
   for (const span of setup.captureSpans().lines[meter.y].spans.filter(span => span.text.includes('━'))) {
    assert(span.bg.equals(RGBA.fromHex(theme.selectedBackground)), 'the meter retains the selected row surface');
   }
   if (width >= 68) {
    for (const track of ['date','meter','value','share']) {
     const header = root.findDescendantById(`distribution-header-${track}-track`)!;
     for (const index of [0,1,2]) {
      const cell = root.findDescendantById(`row-${index}-${track}-track`)!;
      assert.equal(cell.x, header.x, `${track} origins align`); assert.equal(cell.width, header.width, `${track} widths align`);
     }
     assert.equal(header.height, 1, `${track} header stays on one line in both languages`);
    }
    const date = root.findDescendantById('row-0-date-track')!, track = root.findDescendantById('row-0-meter-track')!;
    assert(Math.abs(date.width / track.width - 1.3 / 2) < .06, 'date and meter follow the proportional source tracks');
   }
   assert.match(setup.captureCharFrame(), metric === 'tokens' ? /60.0%/ : /100.0%/);
   assert.match(setup.captureCharFrame(), /Wombat v0.3.0/);
   captures.push({ name: `distribution-${language}-${theme.id}-${metric}-${width}x${height}`, width, height, plain: setup.captureCharFrame(), spans: setup.captureSpans(), geometry: geometry(root) });
   const date = root.findDescendantById('row-0-distribution-date')!;
   const selectedSurface = root.findDescendantById('row-0-separator') as import('@opentui/core').BoxRenderable;
   assert(selectedSurface.backgroundColor.equals(RGBA.fromHex(theme.selectedBackground)), 'selection covers the bottom inset, not only the text baseline');
   const dateText = language === 'zh' ? '9月29日' : '9/29';
   const dateColor = () => setup.captureSpans().lines[date.y].spans.find(span => span.text.includes(dateText))!.fg;
   assert(dateColor().equals(RGBA.fromHex(theme.accent)), 'selected date inherits accent');
   setup.mockInput.pressArrow('down'); await setup.flush(); await setup.waitForVisualIdle();
   assert(dateColor().equals(RGBA.fromHex(theme.foreground)), 'selection transfer restores normal date text');
   assert(selectedSurface.backgroundColor.equals(RGBA.fromHex(theme.background)), 'old selection clears across its full height');
   assert((root.findDescendantById('row-1-separator') as import('@opentui/core').BoxRenderable).backgroundColor.equals(RGBA.fromHex(theme.selectedBackground)), 'new selection fills its bottom inset');
   captures.push({ name: `distribution-selected-next-${language}-${theme.id}-${metric}-${width}x${height}`, width, height, plain: setup.captureCharFrame(), spans: setup.captureSpans(), geometry: geometry(root) });
  }
 } finally { ui.destroy(); locale.setLocale('zh'); }
});
test('report tools query the chosen metric and preserve drill scope, whole thread report and root state', async () => {
 const setup = await createTestRenderer({ width: 80, height: 32 }); const ui = new TerminalUI(setup.renderer);
 const requests: any[] = [];
 const running = runTerminalAppWithUI({ action: 'usage', snapshotId: 'fixture' }, { async prices() { throw new Error('unused'); }, async query(request) {
  requests.push(structuredClone(request));
  const items = request.action === 'threads' ? [{ kind: 'thread' as const, id: 'thread', agentKind: 'codex', sourceInstanceId: 'fixture', title: 'Synthetic thread', models: [], reasoningEfforts: [], threadUsage: summary, matchedUsage: summary }]
   : request.action === 'turns' ? [{ kind: 'turn' as const, id: 'turn', threadId: 'thread', ordinal: 1, models: [], reasoningEfforts: [], status: 'completed', usage: summary, matchedUsage: summary, share: 1, costShare: 1 }] : result.items;
  return { ...result, action: request.action, scope: request.scope ?? scope, items, page: { offset: 0, limit: 6, total: items.length } };
 } }, ui);
 const press = async (key: string) => { setup.mockInput.pressKey(key); await setup.flush(); await setup.flush(); };
 try {
  await setup.waitForFrame(frame => frame.includes('60.0%'));
  await press('m'); await setup.waitForFrame(frame => frame.includes('100.0%'));
  await press('s'); await setup.waitFor(() => requests.at(-1).sort === 'cost');
  await press('v'); await setup.waitFor(() => requests.at(-1).presentation === 'details');
  await press('RETURN'); await setup.waitForFrame(frame => frame.includes('Synthetic thread'));
  assert.equal(requests.at(-1).scope.since, '2026-09-29'); assert.equal(requests.at(-1).sort, 'cost');
  assert.match(setup.captureCharFrame(), /对话全部/);
  await press('RETURN'); await setup.waitForFrame(frame => frame.includes('第 1 轮'));
  await press('d'); await setup.waitFor(() => requests.at(-1).action === 'usage' && requests.at(-1).scope.threadId === 'thread');
  assert.equal(requests.at(-1).scope.since, undefined);
  await press('1'); await setup.waitFor(() => requests.at(-1).action === 'usage' && !requests.at(-1).scope.threadId);
  assert.equal(requests.at(-1).presentation, 'details'); assert.equal(requests.at(-1).sort, 'cost');
  await press('q'); assert.equal(await running, 0);
 } finally { ui.destroy(); await running; }
});
test.after(async () => { if (process.env.WOMBAT_FIDELITY_OUTPUT) { await mkdir(process.env.WOMBAT_FIDELITY_OUTPUT, { recursive: true }); await writeFile(join(process.env.WOMBAT_FIDELITY_OUTPUT, 'upgrade-screens.json'), JSON.stringify(captures,null,2)+'\n'); } });
