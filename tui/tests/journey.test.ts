import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRenderer } from '@opentui/core/testing';
import { CoreError, type UsageClient, type UsageItem, type UsageRequest, type UsageResult, type UsageSummary } from '@wombat/client';
import { runTerminalAppWithUI, screenFrame } from '../src/app.js';
import { TerminalUI } from '../src/components/terminal-ui.js';

const stamp = '2026-09-30T10:00:00Z';
const scope = { timezone: 'UTC', since: '2026-09-30', until: '2026-10-01' };
const usage: UsageSummary = { tokens: { input: 100, cacheRead: 800, cacheCreate: 0, output: 100, reasoning: 20, total: 1000 }, measurementCount: 1,
  price: { currency: 'USD', policy: 'synthetic', priceRevision: 'fixture', basis: [], issues: [], cost: '0.10', knownCost: '0.10', status: 'priced', components: [
    { category: 'input', cost: '0.02', knownCost: '0.02', status: 'priced' }, { category: 'cacheRead', cost: '0.03', knownCost: '0.03', status: 'priced' },
    { category: 'cacheCreate', cost: '0', knownCost: '0', status: 'priced' }, { category: 'output', cost: '0.05', knownCost: '0.05', status: 'priced' },
  ] } };
const baseMeasurement: Extract<UsageItem, { kind: 'measurement' }> = { kind: 'measurement', id: 'measurement-a', threadId: 'thread-a', turnId: 'turn-a', timestamp: stamp, model: 'gpt-5.4', reasoningEffort: 'high', sequence: 0, timePrecision: 'second', usage, share: 1 };
const operation: Extract<UsageItem, { kind: 'operation' }> = { kind: 'operation', id: 'operation-a', threadId: 'thread-a', turnId: 'turn-a', timestamp: stamp, name: '读取文件', status: 'completed', sequence: 1, timePrecision: 'second', operationType: 'tool' };
function response(request: UsageRequest): UsageResult {
  let items: UsageItem[];
  if (request.action === 'usage') items = [{ kind: 'usage', date: '2026-09-30', isSubtotal: true, scope, usage }];
  else if (request.action === 'threads') items = [{ kind: 'thread', id: 'thread-a', agentKind: 'codex', sourceInstanceId: 'synthetic', title: '合成对话', project: '/synthetic/project', startedAt: stamp, lastActivityAt: stamp, models: ['gpt-5.4'], reasoningEfforts: ['high'], matchedUsage: usage, threadUsage: usage }];
  else if (request.action === 'turns') items = [{ kind: 'turn', id: 'turn-a', threadId: 'thread-a', ordinal: 1, startedAt: stamp, endedAt: stamp, status: 'completed', models: ['gpt-5.4'], reasoningEfforts: ['high'], usage, matchedUsage: usage, share: 1 }];
  else items = [baseMeasurement, operation];
  return { outputVersion: 3, action: request.action, snapshotRef: { snapshotId: 'synthetic', createdAt: stamp }, scope: { ...scope, ...request.scope }, availableRange: scope, summary: usage, items, page: { offset: 0, limit: 50, total: items.length }, quality: { status: 'complete', issues: [], sources: [] } };
}

test('report switching keeps automatic dates implicit and preserves explicitly selected dates', { timeout: 15000 }, async () => {
  for (const explicit of [false, true]) {
    const setup = await createTestRenderer({ width: 100, height: 30, exitOnCtrlC: false });
    const ui = new TerminalUI(setup.renderer);
    const requests: UsageRequest[] = [];
    const client: UsageClient = { async prices() { throw new Error('unused'); }, async query(request) {
      requests.push(structuredClone(request));
      return response(request); // The core resolves an omitted range in its response.
    } };
    const running = runTerminalAppWithUI({ action: 'usage', snapshotId: 'synthetic', scope: explicit ? scope : { timezone: 'UTC' } }, client, ui);
    try {
      await setup.waitForFrame(frame => frame.includes('9月30日'));
      for (const [group, title] of [['week', '周报'], ['month', '月报'], ['day', '日报']]) {
        setup.mockInput.pressKey('g');
        await setup.waitForFrame(frame => frame.includes(title));
        const request = requests.at(-1)!;
        assert.equal(request.group, group);
        assert.equal(request.scope?.since, explicit ? scope.since : undefined);
        assert.equal(request.scope?.until, explicit ? scope.until : undefined);
        assert.equal(request.offset, 0);
        assert.equal(request.snapshotId, 'synthetic');
      }
      setup.mockInput.pressKey('q');
      assert.equal(await running, 0);
    } finally {
      if (!ui.signal.aborted) setup.mockInput.pressCtrlC();
      await running;
    }
  }
});

test('actual narrow thread frame keeps a long title out of the breadcrumb and the first turn visible', async () => {
  const setup = await createTestRenderer({ width: 40, height: 24 });
  const ui = new TerminalUI(setup.renderer);
  const item = response({ action: 'threads' }).items[0];
  assert.equal(item.kind, 'thread');
  if (item.kind !== 'thread') return;
  try {
    void ui.choose(screenFrame({ request: { action: 'turns', scope }, result: response({ action: 'turns' }),
      thread: { ...item, title: '检查一段很长的中文对话标题'.repeat(20) },
      selected: 0, expanded: new Map(), details: new Set() }, 1));
    await setup.flush(); await setup.renderOnce();
    assert.equal(setup.renderer.root.findDescendantById('title')!.height, 1);
    assert.match(setup.captureCharFrame(), /9月30日/);
    assert.match(setup.captureCharFrame(), /第 1 轮/);
    assert.match(setup.captureCharFrame(), /Q 退出/);
  } finally { ui.destroy(); }
});

test('native app journey links daily usage, thread, turn, operations and fee details; sorting persists', { timeout: 15000 }, async () => {
  const setup = await createTestRenderer({ width: 120, height: 45, exitOnCtrlC: false });
  const ui = new TerminalUI(setup.renderer);
  const requests: UsageRequest[] = [];
  let failSort = false;
  const client: UsageClient = { async prices() { throw new Error('Unexpected price request'); }, async query(request) {
    requests.push(structuredClone(request));
    if (failSort && request.action === 'steps') { failSort = false; throw new CoreError('QUERY_FAILED', '合成排序失败'); }
    return response(request);
  } };
  const running = runTerminalAppWithUI({ action: 'usage', snapshotId: 'synthetic', scope }, client, ui);
  const visible = async (text: string) => setup.waitForFrame(frame => frame.includes(text), { maxPasses: 30 });
  const press = async (key: string) => { setup.mockInput.pressKey(key); await setup.flush(); await setup.flush(); };
  const lastStep = () => requests.filter(request => request.action === 'steps').at(-1)!;
  try {
    await visible('9月30日');
    await press('RETURN'); await visible('合成对话');
    assert.equal(requests.at(-1)!.action, 'threads');
    assert.equal(requests.at(-1)!.scope?.since, '2026-09-30');
    await press('RETURN'); await visible('第 1 轮');
    assert.equal(requests.at(-1)!.threadId, 'thread-a');
    await press('RETURN'); await visible('读取文件');
    assert.equal(lastStep().sort, 'time');
    await press('ARROW_DOWN'); await press('ARROW_DOWN'); await press('RETURN');
    await visible('非缓存输入');
    assert.match(setup.captureCharFrame(), /100 Token\s+\$0\.0200/);
    await press('HOME'); await press('ARROW_DOWN'); await press('RETURN');
    await setup.waitFor(() => lastStep().sort === 'tokens');
    await setup.flush(); await setup.flush();
    assert.doesNotMatch(setup.captureCharFrame(), /非缓存输入/);
    await press('HOME'); await press('RETURN');
    assert.doesNotMatch(setup.captureCharFrame(), /读取文件/);
    await press('RETURN'); await visible('读取文件');
    assert.equal(lastStep().sort, 'tokens');
    failSort = true;
    await press('ARROW_DOWN'); await press('RETURN'); await visible('合成排序失败');
    assert.equal(lastStep().sort, 'time');
    await press('HOME'); await press('RETURN'); await press('RETURN'); await visible('读取文件');
    assert.equal(lastStep().sort, 'tokens', 'a failed query must not commit its sort selection');
    setup.mockInput.pressKey('q');
    assert.equal(await running, 0);
    assert(requests.every(request => request.snapshotId === 'synthetic'));
  } finally {
    if (!ui.signal.aborted) setup.mockInput.pressCtrlC();
    await running;
  }
});

for (const state of ['idle', 'error', 'loading'] as const) test(`native app Ctrl+C exits 130 from ${state}`, { timeout: 10000 }, async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, exitOnCtrlC: false });
  const ui = new TerminalUI(setup.renderer);
  let started = false, cancelled = false;
  const client: UsageClient = { async prices() { throw new Error('Unexpected price request'); }, async query(request, options) {
    started = true;
    if (state === 'error') throw new CoreError('QUERY_FAILED', '合成查询失败');
    if (state === 'loading') return new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => { cancelled = true; reject(new CoreError('CANCELLED', '已取消')); }, { once: true });
    });
    return response(request);
  } };
  const running = runTerminalAppWithUI({ action: 'usage', snapshotId: 'synthetic', scope }, client, ui);
  try {
    await setup.waitFor(() => started);
    if (state === 'idle') await setup.waitForFrame(frame => frame.includes('9月30日'));
    if (state === 'error') await setup.waitForFrame(frame => frame.includes('合成查询失败'));
    setup.mockInput.pressCtrlC();
    assert.equal(await running, 130);
    if (state === 'loading') assert.equal(cancelled, true);
  } finally {
    if (!ui.signal.aborted) setup.mockInput.pressCtrlC();
    await running;
  }
});

test('native price dialog updates through shared client and preserves current snapshot', { timeout: 15000 }, async () => {
  const setup = await createTestRenderer({ width: 100, height: 30, exitOnCtrlC: false });
  const ui = new TerminalUI(setup.renderer);
  const calls: string[] = [];
  const client: UsageClient = {
    async query(request) { calls.push(request.action); return response(request); },
    async prices(request, options) {
      calls.push(`prices:${request.action}`);
      assert.ok(options?.signal); assert.equal(options.signal.aborted, false);
      return { outputVersion: 1, action: request.action, origin: 'downloaded', updated: request.action === 'update',
        source: 'https://developers.openai.com/api/docs/pricing.md', catalogHash: 'synthetic', sourceHash: 'synthetic',
        catalog: { revision: 'synthetic-price', verifiedAt: '2026-09-30', policy: 'official-standard-api-equivalent-v1', currency: 'USD', models: [] } };
    },
  };
  const running = runTerminalAppWithUI({ action: 'usage', snapshotId: 'synthetic', scope }, client, ui);
  const visible = async (text: string) => setup.waitForFrame(frame => frame.includes(text), { maxPasses: 300 });
  const press = async (key: string) => { setup.mockInput.pressKey(key); await setup.flush(); await setup.flush(); };
  try {
    await visible('U 价表');
    await press('u'); await visible('联网更新价表');
    setup.mockInput.pressEscape();
    // The terminal parser waits to distinguish Escape from a multi-byte sequence.
    await new Promise(resolve => setTimeout(resolve, 150));
    await visible('9月30日');
    assert.deepEqual(calls, ['usage', 'prices:status']);
    await press('u'); await visible('联网更新价表');
    await press('RETURN'); await visible('价表已更新');
    assert.deepEqual(calls, ['usage', 'prices:status', 'prices:status', 'prices:update']);
    setup.mockInput.pressKey('q');
    assert.equal(await running, 0);
  } finally {
    if (!ui.signal.aborted) setup.mockInput.pressCtrlC();
    await running;
  }
});

test('filter app loads complete choices once per snapshot and displays editable fallback after query failure', {timeout:10000}, async()=>{
  for(const fail of [false,true]){
    const setup=await createTestRenderer({width:120,height:32,kittyKeyboard:true});const ui=new TerminalUI(setup.renderer);
    let candidateCalls=0;
    const client:UsageClient={async prices(){throw new Error('unused');},async query(request){
      if(request.limit===500){candidateCalls++;if(fail)throw new CoreError('QUERY_FAILED','合成选项读取失败');}
      return response(request);
    }};
    const running=runTerminalAppWithUI({action:'usage',snapshotId:'synthetic',scope},client,ui);
    const visible=async(text:string)=>setup.waitForFrame(frame=>frame.includes(text),{maxPasses:30});
    try{
      await visible('9月30日');setup.mockInput.pressKey('f');await visible('筛选');
      if(fail)await visible('选项读取失败，可手动输入');
      const count=candidateCalls;assert(count>0);
      setup.mockInput.pressEscape();await visible('9月30日');
      setup.mockInput.pressKey('f');await visible('筛选');
      assert.equal(candidateCalls,fail?count+1:count);
      setup.mockInput.pressKey('c',{ctrl:true});assert.equal(await running,130);
    }finally{ui.destroy();}
  }
});

test('thread summary uses the prototype order and separate summary/context foregrounds',async()=>{
  const {RGBA,TextAttributes}=await import('@opentui/core');
  const setup=await createTestRenderer({width:120,height:32});const ui=new TerminalUI(setup.renderer,undefined,true);
  const thread=response({action:'threads'}).items[0];assert.equal(thread.kind,'thread');if(thread.kind!=='thread')return;
  try{
    void ui.choose(screenFrame({request:{action:'turns',scope},result:response({action:'turns'}),thread,selected:0,expanded:new Map(),details:new Set()},1));
    await setup.flush();await setup.renderOnce();
    const nodes=[0,1,2].map(index=>setup.renderer.root.findDescendantById(`context-${index}`)!);
    assert(nodes[0].y<nodes[1].y&&nodes[1].y<nodes[2].y);
    const spans=setup.captureSpans().lines[nodes[1].y].spans.filter(span=>span.text.trim());
    assert(spans.some(span=>span.text.includes('Token')));
    for(const span of spans){assert(span.fg.equals(RGBA.fromHex('#e1eee3')));assert.equal(span.attributes&TextAttributes.BOLD,0);}
    const model=setup.captureSpans().lines[nodes[2].y].spans.find(span=>span.text.includes('gpt-5.4'))!;
    assert(model.fg.equals(RGBA.fromHex('#9db6a6')));
  }finally{ui.destroy();}
});

test('price explanation on a compact fee block uses that measurement rather than the page total',async()=>{
  const setup=await createTestRenderer({width:120,height:45});const ui=new TerminalUI(setup.renderer);
  const client:UsageClient={async prices(){throw new Error('unused');},async query(request){
    const value=response(request);
    value.summary={...usage,price:{...usage.price,cost:'9',knownCost:'9',priceRevision:'aggregate-price'}};
    return value;
  }};
  const running=runTerminalAppWithUI({action:'usage',snapshotId:'synthetic',scope},client,ui);
  const visible=async(text:string)=>setup.waitForFrame(frame=>frame.includes(text),{maxPasses:30});
  const press=async(key:string)=>{setup.mockInput.pressKey(key);await setup.flush();await setup.flush();};
  try{
    await visible('9月30日');await press('TAB');await visible('合成对话');
    await press('RETURN');await visible('第 1 轮');await press('RETURN');await visible('读取文件');
    await press('ARROW_DOWN');await press('ARROW_DOWN');await press('RETURN');await visible('非缓存输入');
    await press('ARROW_DOWN');await press('?');await visible('价格版本 fixture');
    assert.doesNotMatch(setup.captureCharFrame(),/aggregate-price/);
    await press('q');assert.equal(await running,0);
  }finally{ui.destroy();}
});

test('opening a compact fee block reveals its first category in a 40 by 14 terminal',async()=>{
  const setup=await createTestRenderer({width:40,height:14});const ui=new TerminalUI(setup.renderer);
  const thread=response({action:'threads'}).items[0];assert.equal(thread.kind,'thread');if(thread.kind!=='thread')return;
  try{
    void ui.choose({...screenFrame({request:{action:'turns',scope},result:response({action:'turns'}),thread,
      selected:2,expanded:new Map([['turn-a',response({action:'steps'})]]),details:new Set(['step:turn-a:0'])},1),selected:2});
    await setup.flush();await setup.renderOnce();await setup.flush();
    assert.match(setup.captureCharFrame(),/非缓存输入/);
    assert.match(setup.captureCharFrame(),/\$0\.0200/);
  }finally{ui.destroy();}
});

for(const [width,height] of [[80,24],[120,32]]) test(`full report footer remains within ${width} by ${height}`,async()=>{
  const setup=await createTestRenderer({width,height});const ui=new TerminalUI(setup.renderer);
  try{
    void ui.choose(screenFrame({request:{action:'usage',scope},result:response({action:'usage'}),selected:0,
      expanded:new Map(),details:new Set(),note:{lines:Array.from({length:40},(_,i)=>`说明 ${i}`)}},0));
    await setup.flush();await setup.renderOnce();await setup.flush();
    const footer=setup.renderer.root.findDescendantById('footer')!;
    assert(footer.y+footer.height<=height,`footer ${footer.y}+${footer.height} > ${height}`);
    assert.match(setup.captureCharFrame(),/说明 0/);
  }finally{ui.destroy();}
});

test('live home updates automatically and keeps filter drafts isolated', { timeout: 15_000 }, async () => {
  const setup = await createTestRenderer({ width: 100, height: 32, exitOnCtrlC: false });
  const ui = new TerminalUI(setup.renderer);
  let epoch = 1, calls = 0, refreshFails = false;
  const reads: Array<{ action: string; mode: string | undefined }> = [];
  const client: UsageClient = {
    async prices() { throw new Error('unused'); },
    async query() { throw new Error('live home should use the live client'); },
    async live(request) {
      calls++;
      reads.push({ action: request.query.action, mode: request.mode });
      if (request.query.action === 'refresh' && refreshFails) throw new CoreError('SOURCE_UNREADABLE', '合成同步失败');
      const result = structuredClone(response(request.query));
      result.snapshotRef.snapshotId = `live:fixture:${epoch}`;
      result.summary.price.cost = epoch === 1 ? '0.10' : '9.99';
      for (const item of result.items) if ('usage' in item) item.usage = result.summary;
      const freshness = { status: 'current', checkedAt: stamp, revision: result.snapshotRef.snapshotId, error: null };
      result.freshness = freshness;
      return {outputVersion:1,result,freshness};
    },
  };
  const running = runTerminalAppWithUI({action:'usage'},client,ui);
  try {
    await setup.waitForFrame(frame=>frame.includes('自动更新中'));
    assert.deepEqual(reads[0], { action: 'usage', mode: 'cached' });
    setup.mockInput.pressKey('2');
    await setup.waitForFrame(frame=>frame.includes('Wombat / 对话') && frame.includes('自动更新中'));
    assert.ok(reads.some(read => read.action === 'threads' && read.mode === undefined));
    setup.mockInput.pressKey('1');
    await setup.waitForFrame(frame=>frame.includes('Wombat / 日报') && frame.includes('自动更新中'));
    assert.equal(reads.filter(read => read.action === 'usage' && read.mode === 'cached').length, 1);
    epoch=2;
    await new Promise(resolve=>setTimeout(resolve,1_100));
    await setup.waitForFrame(frame=>frame.includes('9.99'));
    assert.ok(calls>=2);
    setup.mockInput.pressKey('f');
    await setup.waitForFrame(frame=>frame.includes('时间'));
    const afterOpen=calls;
    await new Promise(resolve=>setTimeout(resolve,1_100));
    assert.equal(calls,afterOpen,'editing a filter must pause list refresh');
    setup.mockInput.pressKey('escape');
    await setup.waitForFrame(frame => frame.includes('自动更新中'));
    refreshFails = true;
    setup.mockInput.pressKey('r');
    const failed = await setup.waitForFrame(frame => frame.includes('合成同步失败'));
    assert.match(failed, /9\.99/, 'failed refresh keeps the last result together with the error notice');
    await setup.flush(); setup.mockInput.pressKey('q');
    assert.equal(await running,0);
  } finally { if(!ui.signal.aborted) setup.mockInput.pressCtrlC(); await running; }
});
