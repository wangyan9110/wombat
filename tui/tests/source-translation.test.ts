import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxRenderable, TextRenderable, type Renderable } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { locale } from '@wombat/client/locale';
import type { UsageItem, UsageResult, UsageSummary, UsageRequest } from '@wombat/client';
import { screenFrame, runTerminalAppWithUI } from '../src/app.js';
import { TerminalUI } from '../src/components/terminal-ui.js';

const scope = { timezone: 'UTC', since: '2026-09-30', until: '2026-10-01' };
const usage: UsageSummary = { measurementCount: 1, tokens: { input: 3300557, output: 589516, cacheCreate: 0, cacheRead: 146212854, total: 150102927 }, price: { status: 'priced', cost: '208.69', knownCost: '208.69', currency: 'USD', policy: 'synthetic', priceRevision: 'fixture', basis: [], components: [], issues: [] } };
const row: Extract<UsageItem, {kind:'usage'}> = { kind: 'usage', date: '2026-09-30', isSubtotal: true, scope, usage };
const result = (action: UsageResult['action'], items: UsageItem[]): UsageResult => ({ action, outputVersion: 3, snapshotRef: {snapshotId:'fixture',createdAt:'2026-09-30T00:00:00Z'}, scope, summary: usage, quality:{status:'complete',sources:[],issues:[]}, page:{offset:0,limit:6,total:items.length},items });
function contained(node: Renderable): void {
  const parent = node.parent!;
  const layout = parent.getLayoutNode();
  const left = parent.x + layout.getComputedPadding(0) + layout.getComputedBorder(0);
  const right = parent.x + parent.width - layout.getComputedPadding(2) - layout.getComputedBorder(2);
  assert(node.x >= left && node.x + node.width <= right, `${node.id}: ${node.x}..${node.x+node.width} outside content ${left}..${right}`);
}
for (const language of ['zh','en'] as const) test(`source grid content bounds and toolbar survive breakpoint resizes (${language})`, async () => {
  locale.setLocale(language);
  const setup = await createTestRenderer({width:80,height:32}), ui = new TerminalUI(setup.renderer, undefined, true);
  try {
    const data = result('usage', [row, {...row,isSubtotal:false,model:'synthetic-非常长的模型名称-version-2026',reasoningEffort:'high'}]);
    for (const width of [40,67,68,80,119,120,160,80]) {
      setup.resize(width,32);
      void ui.choose(screenFrame({request:{action:'usage',presentation:'details',scope},result:data,metric:'cost',selected:1,expanded:new Map(),details:new Set()},0));
      await setup.flush(); await setup.waitForVisualIdle();
      const root = setup.renderer.root;
      const walk = (node: Renderable) => {
        if (node instanceof TextRenderable && node.parent?.id.includes('-column-')) contained(node);
        node.getChildren().forEach(walk);
      };
      walk(root);
      for (const id of ['group:0','group:1','group:2','metric','presentation','sort']) {
        const control = root.findDescendantById(id)!;
        const content = root.findDescendantById('content')!;
        assert(control.x >= content.x && control.x + control.width <= content.x + content.width, id);
      }
      assert.equal(root.findDescendantById('group:0')!.height,3,'full control border');
      assert.match(setup.captureCharFrame(), /\$208\.69/,'amount remains intact');
      if (width >= 120) assert.match(setup.captureCharFrame(), /146,212,854/,'large numeric value remains intact');
      if (width >= 68) for (const column of [3,4]) {
        const header = root.findDescendantById(`table-header-column-${column}`)!;
        const model = root.findDescendantById(`row-1-column-${column}`)!;
        assert.equal(header.x, model.x); assert.equal(header.width, model.width);
      }
    }
  } finally { ui.destroy(); locale.setLocale('zh'); }
});

test('form fields respect border/padding after fractional-width resizes and expose focus and select affordance', async () => {
  const setup = await createTestRenderer({width:80,height:24}), ui = new TerminalUI(setup.renderer,undefined,true);
  try {
    const answer = ui.form({title:'Form',activeTab:'usage',values:{a:'one',b:'2026-09-30'},fields:[{id:'a',label:'Choice',options:[{value:'one',label:'One'}]},{id:'b',label:'Date'}]});
    for (const width of [80,119,68,67,40,120,80]) {
      setup.resize(width,24); await setup.flush(); await setup.waitForVisualIdle();
      for (const id of ['a','b']) contained(setup.renderer.root.findDescendantById(`input-${id}`)!);
      const marker = setup.renderer.root.findDescendantById('select-marker-a')!; contained(marker);
      const a = setup.renderer.root.findDescendantById('input-a')!, b = setup.renderer.root.findDescendantById('input-b')!;
      assert(!(a.parent as BoxRenderable).borderColor.equals((b.parent as BoxRenderable).borderColor),'keyboard focus differs from unfocused border');
    }
    setup.mockInput.pressEscape(); await answer;
  } finally { ui.destroy(); }
});

test('same period is a no-op and metric reordering retains the selected conversation across pages', async () => {
  const setup = await createTestRenderer({width:80,height:32}), ui = new TerminalUI(setup.renderer);
  const requests: UsageRequest[] = [];
  const thread = (id:string): Extract<UsageItem,{kind:'thread'}> => ({kind:'thread',id,title:id,agentKind:'codex',sourceInstanceId:'synthetic',models:[],reasoningEfforts:[],threadUsage:usage,matchedUsage:usage});
  const running = runTerminalAppWithUI({action:'usage',snapshotId:'fixture',scope},{async prices(){throw new Error('unused');},async query(request){
    requests.push(structuredClone(request));
    if (request.action === 'threads') {
      const items = request.sort === 'cost' ? [thread('C'),thread('B')] : [thread('A'),thread('B')];
      const offset = request.offset ?? 0;
      return {...result('threads', request.sort === 'cost' ? items.slice(offset,offset+1) : items),page:{offset,limit:request.sort === 'cost'?1:6,total:2}};
    }
    return result(request.action,request.action==='usage'?[row]:[]);
  }},ui);
  try {
    await setup.waitForFrame(frame=>frame.includes('9月30日'));
    const count = requests.length, period = setup.renderer.root.findDescendantById('group:0')!;
    await setup.mockMouse.click(period.x+2,period.y+1); await setup.flush(); await setup.waitForVisualIdle();
    assert.equal(requests.length,count); assert.deepEqual(requests.at(-1)!.scope,scope);
    setup.mockInput.pressKey('2'); await setup.waitForFrame(frame=>frame.includes('$208.69'));
    await setup.waitFor(()=>requests.at(-1)?.action==='threads'); await setup.flush();
    setup.mockInput.pressArrow('down'); await setup.flush(); setup.mockInput.pressKey('m');
    await setup.waitFor(()=>requests.at(-1)?.sort==='cost'&&requests.at(-1)?.offset===1); await setup.flush();
    setup.mockInput.pressEnter(); await setup.waitFor(()=>requests.at(-1)?.action==='turns');
    assert.equal(requests.at(-1)!.threadId,'B');
    setup.mockInput.pressKey('q'); await running;
  } finally { ui.destroy(); }
});

test('price details are outside the row activation target', async () => {
  const setup = await createTestRenderer({width:80,height:24}), ui = new TerminalUI(setup.renderer,undefined,true);
  try {
    let resolved = false;
    const answer = ui.choose({title:'Prices',intro:[],footer:'Q',choices:[{id:'model:example',kind:'price',lines:['Model'],priceDetail:{lines:['Source metadata'],source:'https://example.test/prices'}}]});
    void answer.then(()=>{resolved=true;}); await setup.flush(); await setup.waitForVisualIdle();
    const detail = setup.renderer.root.findDescendantById('price-detail-0')!;
    assert.notEqual(detail.parent?.id,'row-0');
    await setup.mockMouse.click(detail.x+3,detail.y); await setup.flush();
    assert.equal(resolved,false,'reading a detail must not collapse the model');
    setup.mockInput.pressKey('q'); assert.equal((await answer).id,'quit');
  } finally { ui.destroy(); }
});

test('report arrows page by dates and resize relocates the selected date without splitting its group', async () => {
  const setup = await createTestRenderer({width:80,height:32}), ui = new TerminalUI(setup.renderer);
  const requests: UsageRequest[] = [];
  const rows = Array.from({length:7},(_,i)=>({...row,date:`2026-09-${30-i}`,scope:{...scope,since:`2026-09-${30-i}`,until:i===0?'2026-10-01':`2026-09-${31-i}`}}));
  const running = runTerminalAppWithUI({action:'usage',snapshotId:'fixture',scope},{async prices(){throw new Error('unused');},async query(request){
    requests.push(structuredClone(request));
    const offset = request.offset ?? 0, limit = request.limit ?? 6;
    return {...result('usage',rows.slice(offset,offset+limit)),page:{offset,limit,total:rows.length,nextOffset:offset+limit<rows.length?offset+limit:null}};
  }},ui);
  try {
    await setup.waitForFrame(frame=>frame.includes('9月30日'));
    for (let i=0;i<6;i++) { setup.mockInput.pressArrow('down'); await setup.flush(); await setup.waitForVisualIdle(); }
    await setup.waitFor(()=>requests.at(-1)?.offset===6); await setup.flush();
    assert.equal(setup.renderer.root.findDescendantById('row-1'),undefined,'page controls are not data records');
    setup.mockInput.pressArrow('up'); await setup.waitFor(()=>requests.at(-1)?.offset===0); await setup.flush(); await setup.waitForVisualIdle();
    setup.resize(40,14); await setup.waitFor(()=>requests.at(-1)?.limit===1&&requests.at(-1)?.offset===5); await setup.flush();
    setup.mockInput.pressEnter(); await setup.waitFor(()=>requests.at(-1)?.action==='threads');
    assert.equal(requests.at(-1)?.scope?.since,'2026-09-25','resizing retains the selected period');
    setup.mockInput.pressKey('q'); await running;
  } finally { ui.destroy(); }
});
