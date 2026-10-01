import test from 'node:test';
import assert from 'node:assert/strict';
import { RGBA, TextAttributes, TextRenderable } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { CoreError, type PricingResult, type UsageClient } from '@wombat/client';
import { TerminalUI } from '../src/components/terminal-ui.js';
import { priceFrame } from '../src/screens/prices.js';
import { browsePrices } from '../src/state/prices.js';
const fixture:PricingResult={outputVersion:1,action:'status',origin:'builtin',updated:false,source:'https://example.test/pricing',catalogHash:'synthetic',catalog:{revision:'synthetic',verifiedAt:'2026-09-30',policy:'synthetic',currency:'USD',models:Array.from({length:12},(_,i)=>({id:`model-${i}`,aliases:[`alias-${i}`],source:`https://example.test/models/${i}`,rates:{input:'0.125',cacheRead:'0',cacheCreate:null,output:'1.5001'},...(i===0?{longContext:{inputAbove:200000,rates:{input:'0.25',cacheRead:'0.025',cacheCreate:null,output:'3.0002'}}}:{})}))}};
for(const [width,height] of [[40,14],[80,24],[120,32]])test(`price table/cards preserve exact rates, columns and selection at ${width}`,async()=>{
 const setup=await createTestRenderer({width,height});const ui=new TerminalUI(setup.renderer,undefined,true);
 try{
  void ui.choose(priceFrame(fixture,{tier:'standard',cursor:0}));await setup.flush();await setup.renderOnce();
  assert.match(setup.captureCharFrame(),/model-0/);assert.match(setup.captureCharFrame(),/\$0\.125/);assert.match(setup.captureCharFrame(),/\$0/);
  assert.match(setup.captureCharFrame(),/\$1\.5001/);assert.match(setup.captureCharFrame(),/未单列/);
  if(width>=68){
   for(let i=0;i<5;i++){const a=setup.renderer.root.findDescendantById(`table-header-column-${i}`)!,b=setup.renderer.root.findDescendantById(`row-0-column-${i}`)!;assert.equal(a.x,b.x);assert.equal(a.width,b.width);}
  }else{
   const pair=(i:number)=>setup.renderer.root.findDescendantById(`price-pair-0-${i}`)!;
   assert.equal(pair(0).x,pair(2).x);assert.equal(pair(1).x,pair(3).x);
   assert.equal(pair(0).y,pair(1).y);assert.equal(pair(2).y,pair(3).y);
   assert(Math.abs(pair(0).width-pair(1).width)<=1);
   assert(pair(1).x+pair(1).width<=width);
  }
  const span=setup.captureSpans().lines.flatMap(line=>line.spans).find(span=>span.text.includes('model-0'))!;
  assert(span.fg.equals(RGBA.fromHex('#e5f1e8')));assert(span.attributes&TextAttributes.BOLD);assert(span.bg.equals(RGBA.fromHex('#2b4a35')));
 }finally{ui.destroy();}
});
test('price browser supports cross-page arrows, resize, tiers, expansion, exact model thresholds and return',async()=>{
 const setup=await createTestRenderer({width:120,height:40,kittyKeyboard:true});const ui=new TerminalUI(setup.renderer,undefined,true);
 let reads=0;
 const client:UsageClient={async query(){throw new Error('No usage query from price browser');},async prices(request){reads++;return {...fixture,action:request.action};}};
 const running=browsePrices(client,ui,'threads');
 const visible=async(text:string)=>setup.waitForFrame(frame=>frame.includes(text),{maxPasses:50});
 const press=async(key:string)=>{setup.mockInput.pressKey(key);await setup.flush();await setup.flush();};
 try{
  await visible('model-0');
  const activeTab=setup.renderer.root.findDescendantById('threads-tab')!;
  const tabSpan=setup.captureSpans().lines[activeTab.y].spans.find(span=>span.text.includes('对话'))!;
  assert(tabSpan.fg.equals(RGBA.fromHex('#e5f1e8')), 'price page retains its originating entry');
  await press('RETURN');await visible('200,000 Token');assert.doesNotMatch(setup.captureCharFrame(),/272,000/);
  assert.match(setup.captureCharFrame(),/查看官方模型价格/);
  assert.doesNotMatch(setup.captureCharFrame(),/https:\/\/example/);
  const source=setup.renderer.root.findDescendantById('price-source-0') as TextRenderable;
  assert.equal(source.chunks[0]?.link?.url,'https://example.test/models/0');
  const tier=setup.renderer.root.findDescendantById('sort:1')!;await setup.mockMouse.click(tier.x+1,tier.y);await visible('$0.25');
  await press('s');await visible('$0.125');await press('s');await visible('$0.25');
  await press('ARROW_DOWN');await press('RETURN');await visible('此模型未列长上下文档');
  await press('END');await visible('model-11');setup.resize(40,20);await setup.flush();await setup.renderOnce();assert.match(setup.captureCharFrame(),/model-11/);
  await press('HOME');await visible('model-0');await press('ARROW_DOWN');await press('ARROW_DOWN');await visible('model-2');
  assert.equal(reads,1);await press('ESCAPE');assert.equal(await running,'back');
 }finally{ui.destroy();}
});
test('update failure retains the readable catalog; Ctrl+C retains cancellation semantics',async()=>{
 const setup=await createTestRenderer({width:80,height:32});const ui=new TerminalUI(setup.renderer);
 let calls=0;
 const client:UsageClient={async query(){throw new Error('unused');},async prices(request,options){assert.ok(options?.signal);assert.equal(options.signal.aborted,false);calls++;if(request.action==='update')throw new CoreError('NETWORK_ERROR','合成更新失败');return fixture;}};
 const running=browsePrices(client,ui);
 try{
  await setup.waitForFrame(frame=>frame.includes('model-0'));setup.mockInput.pressKey('u');await setup.waitForFrame(frame=>frame.includes('合成更新失败'));
  assert.match(setup.captureCharFrame(),/model-0/);assert.equal(calls,2);
  setup.mockInput.pressKey('c',{ctrl:true});assert.equal(await running,'quit');assert(ui.signal.aborted);
 }finally{ui.destroy();}
});
