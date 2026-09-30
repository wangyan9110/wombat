import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { RGBA, type Renderable } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import type { UsageItem, UsageResult, UsageSummary } from '@wombat/client';
import { locale } from '@wombat/client/locale';
import { screenFrame } from '../src/app.js';
import { itemContent } from '../src/screens/format.js';
import { TerminalUI } from '../src/components/terminal-ui.js';
import { loadingContent, OperationCancelled } from '../src/components/loading-model.js';

const summary: UsageSummary = { measurementCount: 1, tokens: { input: 60000, output: 30000, cacheRead: 210000, cacheCreate: 0, reasoning: 5000, total: 300000 }, price: { status: 'priced', cost: '0.4', knownCost: '0.4', currency: 'USD', policy: 'synthetic', priceRevision: 'fixture', components: [], basis: [], issues: [] } };
const scope = { since: '2026-09-29', until: '2026-09-30', timezone: 'UTC' };
const thread: Extract<UsageItem, { kind: 'thread' }> = { kind: 'thread', id: 'thread', agentKind: 'codex', sourceInstanceId: 'fixture', title: '合成对话', project: '/synthetic/project', startedAt: '2026-09-29T12:00:00Z', lastActivityAt: '2026-09-29T12:01:00Z', models: ['gpt-5.4'], reasoningEfforts: ['high'], threadUsage: summary, matchedUsage: summary };
const turn: Extract<UsageItem, { kind: 'turn' }> = { kind: 'turn', id: 'turn', threadId: 'thread', ordinal: 1, models: ['gpt-5.4'], reasoningEfforts: ['high'], startedAt: thread.startedAt, endedAt: thread.lastActivityAt, status: 'completed', usage: summary, matchedUsage: summary, share: .5 };
const day: Extract<UsageItem, { kind: 'usage' }> = { kind: 'usage', isSubtotal: true, date: '2026-09-29', scope, usage: summary };
function result(action: UsageResult['action'], items: UsageItem[]): UsageResult {
  return { action, outputVersion: 3, snapshotRef: { snapshotId: 'fixture', createdAt: '2026-09-30T00:00:00Z' }, scope, summary, quality: { status: 'complete', sources: [], issues: [] }, page: { offset: 0, limit: 50, total: items.length }, items };
}
const captures: unknown[] = [];
function geometry(node: Renderable): unknown[] {
  return [{ id: node.id, x: node.x, y: node.y, width: node.width, height: node.height }, ...node.getChildren().flatMap(geometry)];
}

// Optional evidence contains synthetic data only. Normal tests write no captures.
for (const [width, height] of [[40, 14], [40, 24], [80, 24], [120, 32], [160, 40]]) test(`source-aligned report and conversation hierarchy at ${width}×${height}`, async () => {
  const setup = await createTestRenderer({ width, height });
  const ui = new TerminalUI(setup.renderer, undefined, true);
  const capture = (state: string) => captures.push({ name: `${state}-${width}x${height}`, width, height, plain: setup.captureCharFrame(), spans: setup.captureSpans(), geometry: geometry(setup.renderer.root) });
  const show = async (action: 'usage' | 'threads' | 'turns', items: UsageItem[], selected = 0) => {
    void ui.choose({ ...screenFrame({ request: { action, scope }, result: result(action, items), selected, expanded: new Map(), details: new Set(), ...(action === 'turns' ? { thread } : {}) }, action === 'usage' ? 0 : 1), selected });
    await setup.flush(); await setup.waitForVisualIdle();
  };
  try {
    await show('usage', [day, { ...day, isSubtotal: false, model: 'gpt-5.4', reasoningEffort: 'high' }]);
    capture('usage');
    const root = setup.renderer.root;
    const count = width < 68 ? 3 : width < 120 ? 5 : 9;
    for (let i = 0; i < count; i++) {
      const header = root.findDescendantById(`table-header-column-${i}`)!;
      assert(header);
      for (const id of ['row-0', 'row-1', 'total']) {
        if (id === 'row-0' && width >= 68 && i < 3) {
          const date = root.findDescendantById('row-0-column-0')!;
          assert(date.x <= header.x && date.x + date.width >= header.x + header.width);
          continue;
        }
        const column = root.findDescendantById(`${id}-column-${i}`)!;
        assert.equal(column.x, header.x); assert.equal(column.width, header.width);
        assert(column.x + column.width <= width);
      }
    }
    assert.match(setup.captureCharFrame(), /\$0.40/);
    if (height >= 20) {
      const total = root.findDescendantById('total')!;
      assert.match(setup.captureCharFrame().split('\n')[total.y], /━/);
      const stroke = setup.captureSpans().lines[total.y].spans.find(span => span.text.includes('━'))!;
      assert(stroke.fg.equals(RGBA.fromHex('#71997c')));
    }
    setup.mockInput.pressArrow('down'); await setup.flush(); await setup.waitForVisualIdle();
    capture('usage-model-selected');
    const model = setup.captureSpans().lines.flatMap(line => line.spans).find(span => span.text.includes('gpt-5.4'));
    assert(model); assert(model.fg.equals(RGBA.fromHex(width < 68 ? '#91b49c' : '#c3d8ca'))); assert(model.bg.equals(RGBA.fromHex('#2b4a35')));
    await show('threads', [thread]); capture('threads');
    assert.equal(root.findDescendantById('meter-0'), undefined, 'conversation cards have no consumption meter');
    assert.match(setup.captureCharFrame(), /合成对话/);
    await show('turns', [turn]); capture('turns');
    if (height >= 20) assert(root.findDescendantById('meter-0'), 'rounds retain their consumption meter at compact widths');
  } finally { ui.destroy(); }
});

for (const width of [40, 67, 68, 80, 119, 120, 160]) test(`period controls and complete dates stay on one line at ${width}`, async () => {
  const setup = await createTestRenderer({ width, height: 32 });
  const ui = new TerminalUI(setup.renderer, undefined, true);
  try {
    for (const [since, until] of [['2026-09-29', '2026-09-30'], ['2026-09-23', '2026-09-30'], ['2026-09-01', '2026-10-01'], ['2025-12-29', '2026-01-05']]) {
      const item = { ...day, date: since, scope: { ...scope, since, until } };
      void ui.choose(screenFrame({ request: { action: 'usage', scope }, result: result('usage', [item]), selected: 0, expanded: new Map(), details: new Set() }, 0));
      await setup.flush(); await setup.waitForVisualIdle();
      const root = setup.renderer.root;
      for (const [index, caption] of ['按天', '按周', '按月'].entries()) {
        const button = root.findDescendantById(`group:${index}`)!;
        const label = root.findDescendantById(`group:${index}-label`)!;
        assert.equal(label.height, 1);
        assert(label.x >= button.x + 1 && label.x + label.width < button.x + button.width);
        assert(setup.captureCharFrame().split('\n')[label.y].includes(caption));
      }
      const date = root.findDescendantById('row-0-label') ?? root.findDescendantById('row-0-column-0')!.getChildren()[0];
      const expected = itemContent(item, result('usage', [item]), width).cells![0].text;
      assert.equal(date.height, 1, expected);
      assert(setup.captureCharFrame().split('\n')[date.y].includes(expected), `complete date: ${expected}`);
      const numericStart = width < 68 ? 1 : 3;
      for (let index = numericStart; index < (width < 68 ? 3 : width < 120 ? 5 : 9); index++) {
        const column = root.findDescendantById(`row-0-column-${index}`)!;
        const header = root.findDescendantById(`table-header-column-${index}`)!;
        assert.equal(column.x, header.x); assert.equal(column.width, header.width);
      }
      assert.match(setup.captureCharFrame(), /\$0.40/);
    }
  } finally { ui.destroy(); }
});

test('loading activity survives resize, cancels locally, and never reappears after completion', async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, kittyKeyboard: true });
  const ui = new TerminalUI(setup.renderer, undefined, true);
  let progress!: (stage: string) => void;
  const running = ui.task({ kind: 'refresh' }, ({ signal, onProgress }) => new Promise((_resolve, reject) => {
    progress = onProgress;
    signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
  }));
  const cancelled = assert.rejects(running, OperationCancelled);
  try {
    await setup.flush(); await setup.waitForVisualIdle();
    captures.push({ name: 'loading-brief-80x24', width: 80, height: 24, plain: setup.captureCharFrame(), spans: setup.captureSpans(), geometry: geometry(setup.renderer.root) });
    const mark = setup.renderer.root.findDescendantById('startup-activity-mark')!;
    const left = mark.x;
    await new Promise(resolve => setTimeout(resolve, 200)); await setup.flush();
    assert(mark.x > left, 'indeterminate marker moves without assigning a completion percentage');
    await new Promise(resolve => setTimeout(resolve, 500)); await setup.flush(); await setup.waitForVisualIdle();
    assert.match(setup.captureCharFrame(), /核对本机记录/);
    captures.push({ name: 'loading-expanded-80x24', width: 80, height: 24, plain: setup.captureCharFrame(), spans: setup.captureSpans(), geometry: geometry(setup.renderer.root) });
    progress('保存用量'); await setup.flush();
    assert.match(setup.captureCharFrame(), /已完成/);
    setup.resize(40, 14); await setup.flush();
    assert.match(setup.captureCharFrame(), /取消读取/);
    setup.mockInput.pressEscape(); await cancelled;
    assert.equal(ui.signal.aborted, false);
    void ui.choose({ title: 'Wombat', intro: [], choices: [{ id: 'retry', lines: ['返回后的页面'] }], footer: 'Q 退出' });
    progress('late progress');
    await new Promise(resolve => setTimeout(resolve, 700)); await setup.flush();
    assert.match(setup.captureCharFrame(), /返回后的页面/);
    assert.equal(setup.renderer.root.findDescendantById('startup-scene'), undefined);
  } finally { ui.destroy(); await cancelled; }
});

test('saved snapshots and combined synchronization do not invent loading phases', () => {
  const saved = loadingContent({ spec: { kind: 'snapshot' }, cancelling: false });
  assert.match(saved.heading, /上次用量/); assert.equal(saved.stages.length, 1);
  const combined = loadingContent({ spec: { kind: 'refresh' }, stage: '同步本机日志并保存用量', cancelling: false });
  assert.equal(combined.stages.length, 1);
  assert.equal(combined.stages.filter(stage => stage.status === 'done').length, 0);
  try {
    locale.setLocale('en');
    assert.match(loadingContent({ spec: { kind: 'open', activeTab: 'threads' }, cancelling: false }).heading, /Conversations/);
  } finally { locale.setLocale('zh'); }
});

test.after(async () => {
  if (!process.env.WOMBAT_FIDELITY_OUTPUT) return;
  const directory = resolve(process.env.WOMBAT_FIDELITY_OUTPUT);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'screens.json'), JSON.stringify(captures, null, 2) + '\n');
});

test('End reveals the range total after a long report; Home restores its first row', async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  const ui = new TerminalUI(setup.renderer, undefined, true);
  try {
    void ui.choose({ title: 'Wombat', intro: [], choices: Array.from({ length: 40 }, (_, i) => ({ id: `row${i}`, lines: [`Record ${i}`] })), total: 'RANGE TOTAL $123.45', footer: 'Q 退出' });
    await setup.flush(); await setup.waitForVisualIdle();
    assert.doesNotMatch(setup.captureCharFrame(), /RANGE TOTAL/);
    setup.mockInput.pressKey('END'); await setup.flush(); await setup.waitForVisualIdle();
    assert.match(setup.captureCharFrame(), /Record 39/); assert.match(setup.captureCharFrame(), /RANGE TOTAL \$123.45/);
    setup.mockInput.pressKey('HOME'); await setup.flush(); await setup.waitForVisualIdle();
    assert.match(setup.captureCharFrame(), /Record 0/);
  } finally { ui.destroy(); }
});
