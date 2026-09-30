import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRenderer } from '@opentui/core/testing';
import { TerminalUI } from '../src/components/terminal-ui.js';
import { terminalThemes } from '../src/themes/index.js';
import type { Frame } from '../src/components/view-model.js';
const frame: Frame = { title: 'Wombat / 日报', intro: ['9月24日—30日'], nav: '1 用量      2 对话', activeTab: '1 用量', controlKind: 'group', controlOptions: ['按天', '按周', '按月'], activeControl: '按天', footer: 'Q 退出', choices: [
  { id: 'day', reportGroup: 'a', kind: 'subtotal', lines: ['9月29日 ›   110 Token · $0.20'] },
  { id: 'model', reportGroup: 'a', kind: 'model', lines: ['gpt-5.4 · 高 · 110 Token · $0.20'] },
  { id: 'next-day', reportGroup: 'b', kind: 'subtotal', lines: ['9月28日 ›   200 Token · $0.30'] },
] };
for (const [width, height] of [[40, 14], [80, 24], [120, 32]]) test(`OpenTUI ${width}×${height}: borders, date rail, keyboard and mouse`, async () => {
  const setup = await createTestRenderer({ width, height });
  const ui = new TerminalUI(setup.renderer, terminalThemes.forest, true);
  try {
    const answer = ui.choose(frame);
    await setup.flush(); await setup.flush();
    const text = setup.captureCharFrame();
    assert.match(text, /╭──────╮ ╭──────╮ ╭──────╮/);
    assert.match(text, /按天/); assert.match(text, /9月29日/); assert.match(text, /110 Token/);
    setup.mockInput.pressArrow('down'); await setup.flush();
    setup.mockInput.pressKey('RETURN');
    assert.equal((await answer).id, 'model');
    const mouseAnswer = ui.choose(frame); await setup.flush();
    const week = setup.renderer.root.findDescendantById('group:1')!;
    assert(week); await setup.mockMouse.click(week.x + 2, week.y + 1);
    assert.equal((await mouseAnswer).id, 'group:1');
  } finally { ui.destroy(); }
});
test('OpenTUI scroll, resize, theme and Ctrl+C retain valid state', async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  const ui = new TerminalUI(setup.renderer, terminalThemes.forest, true);
  try {
    const result = ui.choose({ ...frame, choices: Array.from({ length: 30 }, (_, i) => ({ id: String(i), lines: [`记录 ${i} · 110 Token · $0.20`] })) });
    await setup.flush(); setup.mockInput.pressKey('END'); await setup.flush(); await setup.flush();
    setup.resize(40, 14); await setup.flush(); await setup.flush();
    setup.mockInput.pressKey('t'); await setup.flush();
    setup.mockInput.pressKey('RETURN');
    assert.equal((await result).id, '29');
    assert.match(setup.captureCharFrame(), /记录 29/);
    const exit = ui.choose(frame); await setup.flush();
    setup.mockInput.pressKey('c', { ctrl: true });
    assert.equal((await exit).id, 'quit'); assert.equal(ui.signal.aborted, true);
  } finally { ui.destroy(); }
});
test('themes produce identical text with distinct native cell styles', async () => {
  const texts: string[] = [], colors: string[] = [];
  for (const theme of Object.values(terminalThemes)) {
    const setup = await createTestRenderer({ width: 80, height: 24 }); const ui = new TerminalUI(setup.renderer, theme, true);
    try { void ui.choose(frame); await setup.flush(); texts.push(setup.captureCharFrame()); colors.push(JSON.stringify(setup.captureSpans())); }
    finally { ui.destroy(); }
  }
  assert.equal(new Set(texts).size, 1); assert.equal(new Set(colors).size, 3);
});
test('native input handles Chinese paste and cancel; narrow errors remain visible', async () => {
  const setup = await createTestRenderer({ width: 40, height: 14 });
  const ui = new TerminalUI(setup.renderer, terminalThemes.forest, true);
  try {
    const entered = ui.input({ title: '搜索对话', value: '' });
    await setup.flush(); await setup.mockInput.pasteBracketedText('日期筛选 gpt-5.4');
    setup.mockInput.pressEnter(); assert.equal(await entered, '日期筛选 gpt-5.4');
    const cancelled = ui.input({ title: '项目', value: '原项目' });
    await setup.flush(); setup.mockInput.pressEscape(); assert.equal(await cancelled, null);
    const choice = ui.choose({ title: 'Wombat', intro: ['读取失败：快照损坏'], choices: [{ id: 'retry', lines: ['重试'] }], footer: 'Esc 返回' });
    await setup.flush(); assert.match(setup.captureCharFrame(), /读取失败：快照损坏/);
    setup.mockInput.pressEscape(); assert.equal((await choice).id, 'back');
  } finally { ui.destroy(); }
});
test('narrow fee detail keeps the decimal amount whole in native flex layout', async () => {
  const setup = await createTestRenderer({ width: 40, height: 14 });
  const ui = new TerminalUI(setup.renderer, terminalThemes.forest, true);
  try {
    void ui.choose({ ...frame, choices: [{ id: 'fee', kind: 'detail', depth: 2, lines: [], metrics: [{ label: '非缓存输入', value: '123,456,789 Token', amount: '$123,456.7890' }] }] });
    await setup.flush(); await setup.renderOnce();
    const output = setup.captureCharFrame();
    assert.match(output, /123,456,789 Token/); assert.match(output, /\$123,456\.7890/);
  } finally { ui.destroy(); }
});
