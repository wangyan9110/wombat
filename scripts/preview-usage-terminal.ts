/** Offline visual review of the production renderer, with synthetic data only. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { terminalThemes } from '../tui/src/themes/index.js';
import { screenFrame } from '../tui/src/app.js';
import { TerminalUI } from '../tui/src/components/terminal-ui.js';
import { createTestRenderer } from '@opentui/core/testing';
import type { UsageResult, UsageSummary, UsageItem } from '@wombat/client';
const output = process.argv[2];
if (!output) throw new Error('Specify an output directory for synthetic previews');
const dir = resolve(output);
await mkdir(dir, { recursive: true });
const summary = (total: number, cost: string): UsageSummary => {
  const [whole, fraction = ''] = cost.split('.');
  const micros = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  const input = micros * 55n / 100n, cache = micros / 10n;
  const decimal = (value: bigint) => `${value / 1000000n}.${String(value % 1000000n).padStart(6, '0')}`;
  return { measurementCount: 1, tokens: { input: total * .2, output: total * .1, cacheRead: total * .7, cacheCreate: 0, reasoning: total * .02, total }, price: { currency: 'USD', policy: 'synthetic', priceRevision: 'synthetic', status: 'priced', cost, knownCost: cost, basis: [], issues: [], components: (['input', 'cacheRead', 'cacheCreate', 'output'] as const).map((category, i) => ({ category, cost: decimal([input, cache, 0n, micros - input - cache][i]), knownCost: decimal([input, cache, 0n, micros - input - cache][i]), status: 'priced' })) } };
};
const createdAt = '2026-09-30T06:26:00Z';
const scope = { timezone: 'Asia/Shanghai', since: '2026-09-24', until: '2026-10-01' };
const base: UsageResult = { outputVersion: 3, action: 'usage', snapshotRef: { snapshotId: 'synthetic-preview', createdAt }, scope, availableRange: { since: scope.since, until: scope.until }, summary: summary(1260000, '1.51'), page: { offset: 0, limit: 50, total: 9 }, quality: { status: 'complete', issues: [], sources: [] }, items: [] };
const items: UsageItem[] = [];
for (const date of ['2026-09-29', '2026-09-28', '2026-09-27']) {
  const dayScope = { ...scope, since: date, until: '2026-09-' + (Number(date.slice(-2)) + 1) };
  const row = { kind: 'usage' as const, date, endDate: date, scope: dayScope };
  items.push({ ...row, isSubtotal: true, usage: summary(420000, '0.503333') }, { ...row, isSubtotal: false, model: 'gpt-5.4', reasoningEffort: 'high', usage: summary(300000, '0.40') }, { ...row, isSubtotal: false, model: 'gpt-5.3-codex', reasoningEffort: 'medium', usage: summary(120000, '0.103333') });
}
const thread: Extract<UsageItem, { kind: 'thread' }> = { kind: 'thread', id: 'synthetic-thread', agentKind: 'codex', sourceInstanceId: 'synthetic', title: '检查用量统计与日期筛选', project: '/synthetic/wombat', startedAt: '2026-09-27T03:14:00Z', lastActivityAt: '2026-09-29T06:26:00Z', models: ['gpt-5.4', 'gpt-5.3-codex'], reasoningEfforts: ['high', 'medium'], matchedUsage: base.summary, threadUsage: base.summary };
const turn: Extract<UsageItem, { kind: 'turn' }> = { kind: 'turn', id: 'synthetic-turn', threadId: thread.id, ordinal: 3, startedAt: '2026-09-29T06:14:20Z', endedAt: '2026-09-29T06:17:30Z', models: ['gpt-5.4'], reasoningEfforts: ['high'], status: 'completed', usage: summary(420000, '0.503333'), matchedUsage: summary(420000, '0.503333'), share: 1 / 3 };
const steps: UsageResult = { ...base, action: 'steps', summary: turn.usage, items: [
  { kind: 'operation', id: 'op', threadId: thread.id, turnId: turn.id, timestamp: '2026-09-29T06:14:23Z', timePrecision: 'second', sequence: 1, name: 'read_file', status: 'completed', operationType: 'tool', path: 'src/usage.ts' },
  { kind: 'measurement', id: 'm1', threadId: thread.id, turnId: turn.id, timestamp: '2026-09-29T06:14:25Z', timePrecision: 'second', sequence: 2, model: 'gpt-5.4', reasoningEffort: 'high', usage: summary(300000, '0.40'), share: .714 },
  { kind: 'operation', id: 'op2', threadId: thread.id, turnId: turn.id, timestamp: '2026-09-29T06:15:02Z', timePrecision: 'second', sequence: 3, name: 'exec_command', status: 'completed', operationType: 'tool', exitCode: 0, durationMs: 840 },
  { kind: 'measurement', id: 'm2', threadId: thread.id, turnId: turn.id, timestamp: '2026-09-29T06:15:04Z', timePrecision: 'second', sequence: 4, model: 'gpt-5.4', reasoningEffort: 'high', usage: summary(120000, '0.103333'), share: .286 },
], page: { offset: 0, limit: 50, total: 4 } };
const previews = [];
for (const [width, height] of [[120, 32], [80, 24], [40, 14]]) {
  for (const mode of ['usage', 'threads', 'turns', 'costs', 'basis'] as const) {
    const view = mode === 'costs' || mode === 'basis' ? 'turns' : mode;
    const result: UsageResult = view === 'usage' ? { ...base, items } : view === 'threads' ? { ...base, action: view, summary: summary(1560000, '1.91'), items: [thread, { ...thread, id: 't2', title: '整理工具调用记录', models: ['gpt-5.3-codex'], threadUsage: summary(300000, '0.40'), matchedUsage: summary(300000, '0.40') }], page: { offset: 0, limit: 50, total: 2 } } : { ...base, action: view, items: [turn, { ...turn, id: 'turn-2', ordinal: 4, startedAt: '2026-09-29T06:18:00Z', endedAt: '2026-09-29T06:26:00Z', usage: summary(840000, '1.006667'), matchedUsage: summary(840000, '1.006667'), share: 2 / 3 }], page: { offset: 0, limit: 50, total: 2 } };
    const screen = { request: { action: view, scope, sort: view === 'usage' ? undefined : view === 'threads' ? 'tokens' as const : 'time' as const }, selected: 0, expanded: view === 'turns' ? new Map([[turn.id, steps]]) : new Map(), details: new Set<string>(mode === 'costs' ? ['step:synthetic-turn:1'] : []), note: mode === 'basis' ? { lines: ['金额按官方 API 价格计算，非订阅账单。', '本图使用合成数据。'], offset: 0 } : undefined, result, thread: view === 'turns' ? thread : undefined };
    const frame = screenFrame(screen, view === 'usage' ? 0 : 1);
    const resolved = { ...frame, ...frame.layout!(width) };
    const setup = await createTestRenderer({ width, height });
    const ui = new TerminalUI(setup.renderer, terminalThemes.forest, true);
    void ui.choose({ ...resolved, selected: mode === 'costs' ? 3 : 0 });
    await setup.flush();
    await setup.renderOnce();
    const plain = setup.captureCharFrame(), spans = setup.captureSpans();
    const name = `${mode}-${width}`;
    await writeFile(resolve(dir, name + '.txt'), plain);
    const geometry: Array<{id: string; x: number; y: number; width: number; height: number}> = [];
    const collect = (node: typeof setup.renderer.root) => { geometry.push({ id: node.id, x: node.x, y: node.y, width: node.width, height: node.height }); node.getChildren().forEach(collect); };
    collect(setup.renderer.root);
    previews.push({ name, width, height, spans, plain, geometry });
    ui.destroy();
  }
}
for (const theme of Object.values(terminalThemes)) {
  const frame = screenFrame({ request: { action: 'usage', scope }, selected: 0, expanded: new Map(), details: new Set(), result: { ...base, items } }, 0);
  const setup = await createTestRenderer({ width: 120, height: 32 });
  const ui = new TerminalUI(setup.renderer, theme, true);
  void ui.choose({ ...frame, ...frame.layout!(120) });
  await setup.flush();
    await setup.renderOnce();
  previews.push({ name: `theme-${theme.id}`, width: 120, height: 32, spans: setup.captureSpans(), plain: setup.captureCharFrame() });
  ui.destroy();
}
await writeFile(resolve(dir, 'screens.json'), JSON.stringify(previews, null, 2));
console.log(dir);
