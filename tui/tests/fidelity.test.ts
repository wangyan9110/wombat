import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RGBA } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { TerminalUI } from '../src/components/terminal-ui.js';
import { terminalThemes } from '../src/themes/index.js';
import type { Frame } from '../src/components/view-model.js';

for (const [width, height] of [[80, 24], [120, 32], [160, 40]]) test(`report rows have symmetric vertical insets at ${width}x${height}`, async () => {
  const setup = await createTestRenderer({ width, height });
  const ui = new TerminalUI(setup.renderer, terminalThemes.forest, true);
  try {
    void ui.choose({ title: 'Wombat', intro: [], footer: 'Q 退出', choices: Array.from({ length: 6 }, (_, i) => ({
      id: `entry-${i}`, kind: i === 0 ? 'subtotal' : 'model', reportGroup: 'day', lines: [],
      cells: [{ text: i === 2 ? 'long-model\nsecond-line' : `model-${i}`, grow: 1 }, { text: '100', width: 10 }],
    })) });
    await setup.flush(); await setup.renderOnce();
    for (let i = 0; i < 6; i++) {
      const row = setup.renderer.root.findDescendantById(`row-${i}`)!;
      const grid = setup.renderer.root.findDescendantById(`row-${i}-grid`)!;
      const above = grid.y - row.y, below = row.y + row.height - grid.y - grid.height;
      assert.equal(above, below, `row ${i}: equal space above and below text grid`);
      assert.equal(above, height < 30 ? 0 : 1);
    }
  } finally { ui.destroy(); }
});

test('outlined control fill stays inside its border; active tab shares the navigation rule', async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  const ui = new TerminalUI(setup.renderer, terminalThemes.forest, true);
  const frame: Frame = { title: 'Wombat', intro: [], footer: 'Q 退出', choices: [], nav: '1 用量 2 对话', activeTab: '1 用量', controlKind: 'group', controlOptions: ['按天', '按周', '按月'], activeControl: '按天' };
  const cell = (x: number, y: number) => {
    let offset = 0;
    for (const span of setup.captureSpans().lines[y].spans) {
      if (x >= offset && x < offset + span.width) return span;
      offset += span.width;
    }
    throw new Error(`Missing cell ${x},${y}`);
  };
  try {
    const selected = ui.choose(frame); await setup.flush(); await setup.renderOnce();
    const root = setup.renderer.root;
    const nav = root.findDescendantById('navigation')!, tab = root.findDescendantById('usage-tab')!;
    assert.equal(nav.y + nav.height, tab.y + tab.height, 'no additional row between underline and rule');
    assert(cell(tab.x, nav.y + nav.height - 1).fg.equals(RGBA.fromHex('#8bb99a')));
    for (const id of ['group:0', 'group:1']) {
      const button = root.findDescendantById(id)!;
      for (let x = button.x; x < button.x + button.width; x++) {
        assert(cell(x, button.y).bg.equals(RGBA.fromHex('#142820')));
        assert(cell(x, button.y + button.height - 1).bg.equals(RGBA.fromHex('#142820')));
      }
      assert(cell(button.x, button.y + 1).bg.equals(RGBA.fromHex('#142820')));
      assert(cell(button.x + button.width - 1, button.y + 1).bg.equals(RGBA.fromHex('#142820')));
      assert(cell(button.x + 1, button.y + 1).bg.equals(RGBA.fromHex(id === 'group:0' ? '#2b4a35' : '#142820')));
    }
    const week = root.findDescendantById('group:1')!;
    await setup.mockMouse.click(week.x + 2, week.y + 1);
    assert.equal((await selected).id, 'group:1');
    void ui.choose({ ...frame, activeControl: '按周' }); await setup.flush(); await setup.renderOnce();
    const activeWeek = root.findDescendantById('group:1')!;
    assert(cell(activeWeek.x + 1, activeWeek.y + 1).bg.equals(RGBA.fromHex('#2b4a35')));
  } finally { ui.destroy(); }
});

for (const width of [40, 80]) test(`header preserves brand/divider/title styles and one-row height at ${width}`, async () => {
  const { TextAttributes } = await import('@opentui/core');
  const setup = await createTestRenderer({ width, height: 24 });
  const ui = new TerminalUI(setup.renderer, terminalThemes.forest, true);
  try {
    void ui.choose({ title: 'Wombat / 对话标题'.repeat(18), intro: ['本机 Codex'], choices: [{ id: 'row', lines: ['正文仍可见'] }], footer: 'Q 退出' });
    await setup.flush(); await setup.renderOnce();
    const heading = setup.renderer.root.findDescendantById('title')!;
    assert.equal(heading.height, 1);
    assert(heading.x + heading.width <= width);
    const spans = setup.captureSpans().lines[heading.y].spans;
    const brand = spans.find(span => span.text.includes('Wombat'))!;
    const divider = spans.find(span => span.text.includes('/'))!;
    const title = spans.find(span => span.text.includes('对话'))!;
    assert(brand.fg.equals(RGBA.fromHex('#a9d6b3')));
    assert(divider.fg.equals(RGBA.fromHex('#65836c')));
    assert(title.fg.equals(RGBA.fromHex('#dbe9df')));
    assert(brand.attributes & TextAttributes.BOLD);
    assert.equal(divider.attributes & TextAttributes.BOLD, 0);
    assert(title.attributes & TextAttributes.BOLD);
    assert.match(setup.captureCharFrame(), /正文仍可见/);
  } finally { ui.destroy(); }
});

test('footer disclosure stays below shortcuts, retains selection, and scrolls independently', async () => {
  const { ScrollBoxRenderable } = await import('@opentui/core');
  const setup = await createTestRenderer({ width: 80, height: 24 });
  const ui = new TerminalUI(setup.renderer, terminalThemes.forest, true);
  const base: Frame = { title: 'Wombat / 日报', intro: [], selected: 1,
    choices: [{ id: 'a', lines: ['第一条'] }, { id: 'b', lines: ['第二条'] }],
    footer: '↑↓ 选择 · ? 金额依据 · Q 退出', shortcuts: { '?': 'explain' } };
  try {
    const closed = ui.choose(base); await setup.flush(); await setup.renderOnce();
    const control = setup.renderer.root.findDescendantById('footer-explain')!;
    assert.match(setup.captureCharFrame(), /› \? 金额依据/);
    await setup.mockMouse.click(control.x + 2, control.y);
    assert.equal((await closed).id, 'explain');
    const open = ui.choose({ ...base, disclosure: Array.from({ length: 20 }, (_, i) => `价格说明 ${i}`) });
    await setup.flush(); await setup.renderOnce();
    const notes = setup.renderer.root.findDescendantById('notes')! as InstanceType<typeof ScrollBoxRenderable>;
    const panel = setup.renderer.root.findDescendantById('disclosure-panel')!;
    const summary = setup.renderer.root.findDescendantById('footer-explain')!;
    assert(notes.y > summary.y);
    const spans = setup.captureSpans().lines.flatMap(line => line.spans);
    const note = spans.find(span => span.text.includes('价格说明 0'))!;
    assert(note.fg.equals(RGBA.fromHex('#9db6a6')));
    assert(note.bg.equals(RGBA.fromHex('#1a2e20')));
    const rail = setup.captureSpans().lines[panel.y].spans.find(span => span.text.includes('│'))!;
    assert(rail.fg.equals(RGBA.fromHex('#56765c')));
    assert.match(setup.captureCharFrame(), /⌄ \? 金额依据/);
    setup.mockInput.pressArrow('down'); await setup.flush(); await setup.renderOnce();
    assert(notes.scrollTop > 0);
    setup.mockInput.pressKey('?');
    const answer = await open; assert.equal(answer.id, 'explain'); assert.equal(answer.selected, 1);
    const restored = ui.choose({ ...base, selected: answer.selected, viewportStart: answer.viewportStart });
    await setup.flush(); await setup.renderOnce();
    assert.equal(setup.renderer.root.findDescendantById('notes'), undefined);
    setup.mockInput.pressKey('RETURN'); assert.equal((await restored).id, 'b');
  } finally { ui.destroy(); }
});

// Public component specification, using synthetic labels and values only.
// These checks inspect rendered cells; unchanged text is not sufficient evidence.
test('report hierarchy: source colors, full-width rules, inset and selection transfer', async () => {
  const setup = await createTestRenderer({ width: 120, height: 32 });
  const ui = new TerminalUI(setup.renderer, terminalThemes.forest, true);
  const frame: Frame = {
    title: 'Wombat / 日报', intro: ['本机 Codex'], footer: 'Q 退出',
    nav: '1 用量 2 对话', activeTab: '1 用量',
    controlKind: 'group', controlOptions: ['按天', '按周', '按月'], activeControl: '按天',
    choices: [
      { id: 'day', kind: 'subtotal', reportGroup: 'day1', lines: ['9月29日 ›'] },
      { id: 'model', kind: 'model', reportGroup: 'day1', lines: ['gpt-test-model'] },
      { id: 'next', kind: 'subtotal', reportGroup: 'day2', lines: ['9月28日 ›'] },
    ],
  };
  const span = (text: string) => {
    const result = setup.captureSpans().lines.flatMap(line => line.spans).find(value => value.text.includes(text));
    assert(result, `visible styled text: ${text}`);
    return result;
  };
  const color = (text: string, fg: string, bg: string) => {
    const found = span(text);
    assert(found.fg.equals(RGBA.fromHex(fg)), `${text} foreground`);
    assert(found.bg.equals(RGBA.fromHex(bg)), `${text} background`);
  };
  try {
    void ui.choose(frame); await setup.flush(); await setup.renderOnce();
    color('按天', '#e1f2e5', '#2b4a35');
    color('按周', '#9eb8a5', '#142820');
    color('1 用量', '#d7e9dc', '#142820');
    color('9月29日', '#d4e6da', '#2b4a35');
    color('gpt-test-model', '#c3d8ca', '#142820');
    color('9月28日', '#d4e6da', '#1d3628');
    for (const id of ['heading', 'navigation']) {
      const node = setup.renderer.root.findDescendantById(id)!;
      const line = setup.captureCharFrame().split('\n')[node.y + node.height - 1];
      assert.equal(line.slice(node.x, node.x + node.width), '─'.repeat(node.width));
    }
    const before = setup.captureCharFrame().split('\n');
    assert.equal(before.find(line => line.includes('gpt-test-model'))!.indexOf('gpt-test-model'), before.find(line => line.includes('9月29日'))!.indexOf('9月29日') + 1);
    const dayNode = setup.renderer.root.findDescendantById('row-0');
    setup.mockInput.pressArrow('down'); await setup.flush(); await setup.renderOnce();
    assert.equal(setup.renderer.root.findDescendantById('row-0'), dayNode, 'moving selection retains native components');
    color('9月29日', '#d4e6da', '#1d3628');
    color('gpt-test-model', '#c3d8ca', '#2b4a35');
    setup.mockInput.pressArrow('down'); await setup.flush(); await setup.renderOnce();
    color('gpt-test-model', '#c3d8ca', '#142820');
    color('9月28日', '#d4e6da', '#2b4a35');
  } finally { ui.destroy(); }
});

test('NO_COLOR keeps table selection visible inside native column components', async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  const ui = new TerminalUI(setup.renderer, terminalThemes.forest, false);
  try {
    void ui.choose({ title: 'Wombat', intro: [], footer: 'Q 退出', choices: [
      { id: 'a', reportGroup: 'day', kind: 'subtotal', lines: [], cells: [{ text: 'DATE-A', grow: 1 }] },
      { id: 'b', reportGroup: 'day', kind: 'model', lines: [], cells: [{ text: 'MODEL-B', grow: 1 }] },
    ] });
    const attributes = (label: string) => setup.captureSpans().lines.flatMap(line => line.spans).find(span => span.text.includes(label))!.attributes;
    const { TextAttributes } = await import('@opentui/core');
    await setup.flush(); await setup.renderOnce();
    assert(attributes('DATE-A') & TextAttributes.INVERSE);
    assert.equal(attributes('MODEL-B') & TextAttributes.INVERSE, 0);
    setup.mockInput.pressArrow('down'); await setup.flush(); await setup.renderOnce();
    assert.equal(attributes('DATE-A') & TextAttributes.INVERSE, 0);
    assert(attributes('MODEL-B') & TextAttributes.INVERSE);
  } finally { ui.destroy(); }
});

for (const width of [80, 120, 160]) test(`actual report cells preserve column geometry, weight and color at ${width}`, async () => {
  const { itemContent, usageHeaderCells, usageTotalCells } = await import('../src/screens/format.js');
  const { TextAttributes } = await import('@opentui/core');
  const usage = { measurementCount: 1, tokens: { input: 60000, output: 30000, cacheRead: 210000, cacheCreate: 0, reasoning: 0, total: 300000 }, price: { status: 'priced', cost: '0.40', knownCost: '0.40', currency: 'USD', policy: 'synthetic', priceRevision: 'synthetic', components: [], basis: [], issues: [] } } as const;
  const scope = { since: '2026-09-29', until: '2026-09-30', timezone: 'UTC' };
  const summary = { ...usage, price: { ...usage.price, components: [], basis: [], issues: [] } };
  const result = { outputVersion: 3 as const, action: 'usage' as const, snapshotRef: { snapshotId: 'fixture', createdAt: '2026-09-30T00:00:00Z' }, scope, availableRange: scope, summary, quality: { status: 'complete' as const, sources: [], issues: [] }, page: { offset: 0, limit: 50, total: 2 }, items: [] };
  const day = { kind: 'usage' as const, isSubtotal: true, date: scope.since, scope, usage: summary };
  const model = { ...day, isSubtotal: false, model: 'gpt-5.4', reasoningEffort: 'high' };
  const contentWidth = Math.min(width, 120);
  const setup = await createTestRenderer({ width, height: width === 80 ? 24 : 32 });
  const ui = new TerminalUI(setup.renderer, terminalThemes.forest, true);
  try {
    void ui.choose({ title: 'Wombat', intro: ['本机 Codex'], nav: '1 用量 2 对话', activeTab: '1 用量', controlKind: 'group', controlOptions: ['按天', '按周', '按月'], activeControl: '按天', actions: 'F 筛选 · R 更新', footer: 'Q 退出', tableCells: usageHeaderCells(contentWidth), totalCells: usageTotalCells(summary, contentWidth), choices: [
      { id: 'day', kind: 'subtotal', reportGroup: 'a', ...itemContent(day, result, contentWidth) },
      { id: 'model', kind: 'model', reportGroup: 'a', ...itemContent(model, result, contentWidth) },
    ] });
    await setup.flush(); await setup.renderOnce();
    const root = setup.renderer.root;
    const nativeContent = root.findDescendantById('content')!;
    assert.equal(nativeContent.x, (width - contentWidth) / 2);
    for (let i = 0; i < usageHeaderCells(contentWidth).length; i++) {
      const expected = root.findDescendantById(`table-header-column-${i}`)!;
      assert(expected.width >= 8, `column ${i} must not collapse`);
      for (const row of ['row-0', 'row-1', 'total']) {
        const actual = root.findDescendantById(`${row}-column-${i}`)!;
        assert.equal(actual.x, expected.x, `${row}/${i} x`);
        assert.equal(actual.width, expected.width, `${row}/${i} width`);
      }
    }
    const text = setup.captureCharFrame();
    assert.match(text, /9月29日 ›/); assert.match(text, /gpt-5\.4/); assert.match(text, /推理强度/); assert.match(text, /金额（美元）/);
    const modelSpan = () => setup.captureSpans().lines.flatMap(line => line.spans).find(span => span.text.includes('gpt-5.4'))!;
    assert(modelSpan().fg.equals(RGBA.fromHex('#c3d8ca')));
    assert.equal(modelSpan().attributes & TextAttributes.BOLD, 0);
    const row = root.findDescendantById('row-1')!;
    await setup.mockMouse.moveTo(row.x + 3, row.y + row.height - 1); await setup.flush();
    assert(modelSpan().bg.equals(RGBA.fromHex('#294632')), 'unselected row hover');
    setup.mockInput.pressArrow('down'); await setup.flush(); await setup.renderOnce();
    assert(modelSpan().bg.equals(RGBA.fromHex('#2b4a35')), 'selected overrides hover');
    assert(modelSpan().fg.equals(RGBA.fromHex('#c3d8ca')), 'explicit child CSS color survives selection');
    assert.equal(modelSpan().attributes & TextAttributes.BOLD, 0);
  } finally { ui.destroy(); }
});

test('turn records share one container; operation metadata is not styled as money', async () => {
  const { TextAttributes } = await import('@opentui/core');
  const setup = await createTestRenderer({ width: 120, height: 32 });
  const ui = new TerminalUI(setup.renderer, terminalThemes.forest, true);
  try {
    void ui.choose({ title: 'Wombat', intro: [], footer: 'Q 退出', choices: [
      { id: 'turn', kind: 'turn', turnGroup: 't1', lines: [], headline: { label: '第 1 轮', amount: '100 Token · $0.20' } },
      { id: 'operation', kind: 'operation', turnGroup: 't1', recordStart: true, lines: [], operation: { time: '14:26:31', name: 'read_file', result: '完成' } },
      { id: 'measurement', kind: 'measurement', turnGroup: 't1', recordStart: true, lines: [], headline: { label: '14:26:32 · gpt-5.4', amount: '100 Token · $0.20' } },
    ] });
    await setup.flush(); await setup.renderOnce();
    const group = setup.renderer.root.findDescendantById('turn-0')!;
    for (const id of ['row-0', 'row-1', 'row-2', 'record-rule-1', 'record-rule-2']) assert(group.findDescendantById(id));
    const spans = setup.captureSpans().lines.flatMap(line => line.spans);
    for (const text of ['14:26:31', 'read_file', '完成', '14:26:32 · gpt-5.4']) {
      const span = spans.find(span => span.text.includes(text))!;
      assert(span); assert.equal(span.attributes & TextAttributes.BOLD, 0, text);
    }
  } finally { ui.destroy(); }
});

test('consumption meter uses thin native strokes, preserves its surface, and handles 0/50/100 percent', async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  const ui = new TerminalUI(setup.renderer, terminalThemes.forest, true);
  try {
    void ui.choose({ title: 'Wombat', intro: [], footer: 'Q 退出', choices: [0, .5, 1].map((bar, i) => ({ id: String(i), kind: 'thread', lines: [`对话 ${i}`], bar })) });
    await setup.flush(); await setup.renderOnce();
    for (const i of [0, 1, 2]) {
      const meter = setup.renderer.root.findDescendantById(`meter-${i}`)!;
      const line = setup.captureCharFrame().split('\n')[meter.y];
      assert.equal(line.slice(meter.x, meter.x + meter.width), '─'.repeat(meter.width));
      const spans = setup.captureSpans().lines[meter.y].spans.filter(span => span.text.includes('─'));
      assert(spans.length > 0);
      for (const span of spans) assert(span.bg.equals(RGBA.fromHex(i === 0 ? '#223b2b' : '#142820')), 'meter must not paint a full-cell color block');
      const fill = setup.renderer.root.findDescendantById(`meter-${i}-fill`);
      if (i === 0) assert.equal(fill, undefined);
      else assert(Math.abs(fill!.width - meter.width * (i === 1 ? .5 : 1)) <= 1);
    }
  } finally { ui.destroy(); }
});

for (const height of [14,24,45]) test(`footer follows native content height up to 55 percent at ${height} rows`,async()=>{
  const setup=await createTestRenderer({width:80,height});const ui=new TerminalUI(setup.renderer,terminalThemes.forest,true);
  const base:Frame={title:'Wombat / 日报',intro:[],nav:'1 用量 2 对话',activeTab:'1 用量',footer:'? 金额依据 · Q 退出',choices:[{id:'data',lines:['保留正文']}]};
  try{
    void ui.choose({...base,disclosure:['简短说明']});await setup.flush();await setup.renderOnce();
    const small=setup.renderer.root.findDescendantById('footer')!.height;
    void ui.choose({...base,disclosure:Array.from({length:80},(_,i)=>`说明 ${i}`)});await setup.flush();await setup.renderOnce();
    const footer=setup.renderer.root.findDescendantById('footer')!,content=setup.renderer.root.findDescendantById('content')!;
    if(height>=24){
      assert(footer.height>small,`long content must use more space (${small} -> ${footer.height})`);
      assert(Math.abs(footer.height-Math.floor(content.height*.55))<=1,`${footer.height} / ${content.height}`);
    } else assert(footer.height<=Math.ceil(content.height*.55));
    assert(footer.y+footer.height<=height);assert.match(setup.captureCharFrame(),/保留正文/);
  }finally{ui.destroy();}
});

for(const width of [40,80,120]) test(`fee categories flow compactly without splitting amounts at ${width} columns`,async()=>{
  const setup=await createTestRenderer({width,height:32});const ui=new TerminalUI(setup.renderer,terminalThemes.forest,true);
  try{
    void ui.choose({title:'Wombat',intro:[],footer:'Q 退出',choices:[{id:'detail',kind:'detail',lines:[],metrics:[
      {label:'非缓存输入',value:'100 Token',amount:'$0.0200'},
      {label:'缓存读取',value:'800 Token',amount:'$0.0300'},
      {label:'缓存创建',value:'0 Token',amount:'$0.0000'},
      {label:'输出',value:'100 Token',amount:'费用未知'},
      {label:'其中推理',value:'20 Token'},
    ]}]});await setup.flush();await setup.renderOnce();
    for(const value of ['$0.0200','$0.0300','$0.0000','费用未知','其中推理'])assert.match(setup.captureCharFrame(),new RegExp(value.replace(/[$.]/g,'\\$&')));
    const a=setup.renderer.root.findDescendantById('breakdown-0-0')!,b=setup.renderer.root.findDescendantById('breakdown-0-1')!;
    if(width>=80){assert.equal(a.y,b.y);assert(b.x>a.x);}else assert(b.y>a.y);
    const spans=setup.captureSpans().lines.flatMap(line=>line.spans);
    assert(spans.find(span=>span.text.includes('$0.0200'))!.fg.equals(RGBA.fromHex('#b5cab9')));
  }finally{ui.destroy();}
});

for (const width of [68, 80, 110, 120]) test(`long numeric cells preserve digits and gutters at ${width}`, async () => {
  const { usageHeaderCells } = await import('../src/screens/format.js');
  const setup = await createTestRenderer({ width, height: 32 });
  const ui = new TerminalUI(setup.renderer, terminalThemes.forest, true);
  const header = usageHeaderCells(width);
  const cells = header.map((cell, index) => ({ ...cell, text: index === 0 ? '日期' : index === 1 ? 'test-model' : index === 2 ? '高' : index === header.length - 1 ? '$123,456.78' : '123,456,789' }));
  try {
    void ui.choose({ title: 'Wombat', intro: [], footer: 'Q 退出', tableCells: header, choices: [{ id: 'row', kind: 'model', reportGroup: 'day', lines: [], cells }] });
    await setup.flush(); await setup.waitForVisualIdle();
    const plain = setup.captureCharFrame().split('\n');
    for (let index = 3; index < cells.length; index++) {
      const column = setup.renderer.root.findDescendantById(`row-0-column-${index}`)!;
      const text = column.getChildren()[0];
      assert.equal(text.height, 1);
      assert(text.x + text.width <= column.x + column.width);
      assert(column.x + column.width <= width - 2, 'cell stays inside the page');
      // Numeric fields and the gap are ASCII; native geometry supplies their positions.
      const line = plain[text.y];
      assert(line.includes(cells[index].text), `complete value ${cells[index].text}`);
      const spans = setup.captureSpans().lines[text.y].spans;
      let x = 0;
      for (const span of spans) {
        const gap = column.x + column.width;
        if (gap >= x && gap < x + span.width && index < cells.length - 1) {
          // The numeric span may contain only ASCII here, so its local offset is exact.
          assert.equal(span.text[gap - x], ' ', 'one visible cell between numbers');
        }
        x += span.width;
      }
    }
  } finally { ui.destroy(); }
});
