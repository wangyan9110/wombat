import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputRenderable, SelectRenderable, RGBA, TextAttributes } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { TerminalUI } from '../src/components/terminal-ui.js';
import { editTerminalFilters } from '../src/state/filters.js';
import type { UsageRequest } from '@wombat/client';

for (const [width,height] of [[40,14],[80,24],[120,32]]) test(`native filter form ${width}×${height}: inline select, dates, draft, apply`, {timeout:5000}, async()=>{
  const setup=await createTestRenderer({width,height}); const ui=new TerminalUI(setup.renderer,undefined,true);
  const original:UsageRequest={action:'usage',scope:{timezone:'UTC'},offset:50};
  const running=editTerminalFilters(original,'2026-09-30T10:00:00Z',{form:ui.form.bind(ui)});
  const flush=async()=>{await setup.flush();await setup.renderOnce();await setup.flush();};
  const press=async(name:string)=>{setup.mockInput.pressKey(name);await flush();};
  try{
    await flush(); assert.match(setup.captureCharFrame(),/Wombat \/ 筛选/);
    assert.match(setup.captureCharFrame(),/其他筛选/);
    const select=setup.renderer.root.findDescendantById('input-period') as SelectRenderable;
    assert(select instanceof SelectRenderable); assert.equal(select.height,1);
    await press('RETURN'); assert.equal(select.height,6);
    assert.match(setup.captureCharFrame(),/Wombat \/ 筛选/);
    for (let i = 0; i < 5; i++) await press('ARROW_DOWN'); await press('RETURN'); // automatic -> custom, in place
    const from=setup.renderer.root.findDescendantById('input-since') as InputRenderable;
    const until=setup.renderer.root.findDescendantById('input-until') as InputRenderable;
    assert(from instanceof InputRenderable); assert(until instanceof InputRenderable);
    await press('TAB'); assert(from.focused);
    await setup.mockInput.pasteBracketedText('2026-09-29'); await press('TAB'); assert(until.focused);
    await setup.mockInput.pasteBracketedText('2026-09-30'); await flush();
    assert.equal(from.value,'2026-09-29'); assert.equal(until.value,'2026-09-30');
    const periodColumn=setup.renderer.root.findDescendantById('field-period')!;
    const fromColumn=setup.renderer.root.findDescendantById('field-since')!;
    if(width>=68){assert.equal(periodColumn.y,fromColumn.y);assert(fromColumn.x>periodColumn.x);}
    else{assert.equal(periodColumn.x,fromColumn.x);assert(fromColumn.y>periodColumn.y);}
    setup.mockInput.pressKey('s',{ctrl:true});
    const result=await running;
    assert.deepEqual(result.request,{action:'usage',scope:{timezone:'UTC',since:'2026-09-29',until:'2026-10-01'},offset:0});
    assert.deepEqual(original,{action:'usage',scope:{timezone:'UTC'},offset:50});
  }finally{ui.destroy();}
});

test('native form input keeps literal shortcut letters, survives resize, and cancels via mouse',async()=>{
  const setup=await createTestRenderer({width:80,height:24});const ui=new TerminalUI(setup.renderer,undefined,true);
  const original:UsageRequest={action:'threads',search:'old',scope:{project:'old-project'}};
  const running=editTerminalFilters(original,'2026-09-30T10:00:00Z',{form:ui.form.bind(ui)});
  try{
    await setup.flush(); const search=setup.renderer.root.findDescendantById('input-search') as InputRenderable;
    setup.mockInput.pressKey('u',{ctrl:true}); await setup.mockInput.pasteBracketedText('中文 q a t 1');await setup.flush();
    assert.equal(search.value,'中文 q a t 1');
    setup.resize(40,14);await setup.flush();await setup.renderOnce();
    assert.equal(search.value,'中文 q a t 1'); assert(search.focused);
    const a=setup.renderer.root.findDescendantById('field-search')!;const b=setup.renderer.root.findDescendantById('field-project')!;
    assert.equal(a.x,b.x);assert(b.y>a.y);
    const cancel=setup.renderer.root.findDescendantById('form-cancel')!;
    await setup.mockMouse.click(cancel.x+1,cancel.y);
    assert.equal((await running).request,original);
  }finally{ui.destroy();}
});

test('native select mouse selection and Escape revert stay in the form; fields use source colors',async()=>{
  const setup=await createTestRenderer({width:80,height:24,kittyKeyboard:true});const ui=new TerminalUI(setup.renderer,undefined,true);
  const original:UsageRequest={action:'usage',scope:{timezone:'UTC'}};
  const running=editTerminalFilters(original,'2026-09-30T10:00:00Z',{form:ui.form.bind(ui)});
  try{
    await setup.flush(); await setup.renderOnce();
    let select=setup.renderer.root.findDescendantById('input-period') as SelectRenderable;
    await setup.mockMouse.click(select.x+1,select.y);await setup.flush();await setup.renderOnce();
    assert.equal(select.height,6);
    await setup.mockMouse.click(select.x+1,select.y+1);await setup.flush();await setup.renderOnce(); // today
    select=setup.renderer.root.findDescendantById('input-period') as SelectRenderable;
    assert.equal(select.getSelectedOption()!.value,'today');assert.equal(select.height,1);
    const span=setup.captureSpans().lines.flatMap(line=>line.spans).find(span=>span.text.includes('今天'))!;
    assert(span.fg.equals(RGBA.fromHex('#d9eddf')));assert(span.bg.equals(RGBA.fromHex('#203d2c')));
    setup.mockInput.pressKey('RETURN');await setup.flush();setup.mockInput.pressArrow('down');await setup.flush();setup.mockInput.pressEscape();await setup.waitForFrame(()=>select.height===1);
    assert.equal(select.getSelectedOption()!.value,'today');assert.equal(select.height,1);
    setup.mockInput.pressEscape();assert.equal((await running).request,original);
  }finally{ui.destroy();}
});

test('form entry navigation discards its draft and Ctrl+C aborts the app signal',async()=>{
  const setup=await createTestRenderer({width:80,height:24});const ui=new TerminalUI(setup.renderer);
  try{
    const original:UsageRequest={action:'usage'};
    const nav=editTerminalFilters(original,'2026-09-30T10:00:00Z',{form:ui.form.bind(ui)});
    await setup.flush();const tab=setup.renderer.root.findDescendantById('threads-tab')!;
    await setup.mockMouse.click(tab.x+1,tab.y);
    assert.deepEqual(await nav,{request:original,navigate:'threads-tab'});
    const abort=editTerminalFilters(original,'2026-09-30T10:00:00Z',{form:ui.form.bind(ui)});
    await setup.flush();setup.mockInput.pressKey('c',{ctrl:true});
    assert.equal((await abort).request,original);assert(ui.signal.aborted);
  }finally{ui.destroy();}
});

test('NO_COLOR native select uses terminal defaults and keeps its selection indicator',async()=>{
  const setup=await createTestRenderer({width:80,height:24});const ui=new TerminalUI(setup.renderer,undefined,false);
  try{
    const running=ui.form({title:'Wombat / 筛选',activeTab:'usage',values:{period:'all'},fields:[{id:'period',label:'时间',options:[{value:'today',label:'今天'},{value:'all',label:'全部日期'}]}]});
    await setup.flush();setup.mockInput.pressEnter();await setup.flush();await setup.renderOnce();
    const node=setup.renderer.root.findDescendantById('input-period') as SelectRenderable;
    assert(node.showSelectionIndicator);
    const spans=setup.captureSpans().lines.flatMap(line=>line.spans).filter(span=>span.text.includes('今天')||span.text.includes('全部日期'));
    assert.equal(spans.length,2);
    for(const span of spans){assert.equal(span.fg.intent,'default');assert.equal(span.bg.intent,'default');}
    setup.mockInput.pressTab();await setup.flush();await setup.renderOnce();
    assert(setup.captureSpans().lines.flatMap(line=>line.spans).find(span=>span.text.trim()==='应用')!.attributes & TextAttributes.INVERSE);
    setup.mockInput.pressKey('c',{ctrl:true});await running;
  }finally{ui.destroy();}
});

test('project dropdown scrolls to offscreen choices with native geometry and keeps drafts on resize', {timeout:5000}, async()=>{
  const setup=await createTestRenderer({width:80,height:24});const ui=new TerminalUI(setup.renderer,undefined,true);
  const candidates={projects:Array.from({length:80},(_,i)=>`/synthetic/project-${String(i).padStart(2,'0')}`),models:[]};
  const running=editTerminalFilters({action:'threads',scope:{project:candidates.projects[65]}},'2026-09-30T10:00:00Z',{form:ui.form.bind(ui)},candidates);
  const flush=async()=>{await setup.flush();await setup.renderOnce();await setup.flush();};
  try{
    await flush();setup.mockInput.pressTab();setup.mockInput.pressEnter();await flush();
    let node=setup.renderer.root.findDescendantById('input-project') as SelectRenderable;
    assert(node instanceof SelectRenderable);assert.match(setup.captureCharFrame(),/project-65/);
    setup.mockInput.pressArrow('down');await flush();setup.resize(40,14);await flush();
    node=setup.renderer.root.findDescendantById('input-project') as SelectRenderable;
    const y=node.y+node.getSelectedIndex();
    assert(y>=0&&y<14);assert.match(setup.captureCharFrame(),/project-66/);
    await setup.mockMouse.click(node.x+1,y);await flush();
    setup.mockInput.pressKey('s',{ctrl:true});
    assert.equal((await running).request.scope?.project,candidates.projects[66]);
  }finally{ui.destroy();}
});

test('form navigation keeps its baseline through short and tall resizes', async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  const ui = new TerminalUI(setup.renderer, undefined, true);
  try {
    void ui.form({ title: 'Wombat / 筛选', activeTab: 'usage', values: {}, fields: [{ id: 'search', label: '搜索' }] });
    for (const height of [24, 14, 32, 19, 20]) {
      setup.resize(80, height); await setup.flush(); await setup.waitForVisualIdle();
      const nav = setup.renderer.root.findDescendantById('form-navigation')!;
      const tab = setup.renderer.root.findDescendantById('usage-tab')!;
      assert.equal(nav.y + nav.height, tab.y + tab.height, `navigation baseline at ${height}`);
      const help = setup.renderer.root.findDescendantById('form-help')!;
      assert(help.y + help.height <= height);
    }
  } finally { ui.destroy(); }
});
