import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute,routeSearch,scopeOf,shiftDate,readUsage } from '../src/state.js';
import type {UsageClient,UsageResult} from '@wombat/client';
test('URL restores selection and filters; inclusive dates convert across DST without changing periods',()=>{
 const r=parseRoute('?page=threads&since=2026-03-08&until=2026-03-09&timezone=America%2FNew_York&project=%2Fproject&thread=a%2Fb&turn=t&offset=20&group=week&model=m&sort=cost');
 assert.deepEqual(parseRoute(routeSearch(r)),r);
 assert.equal(scopeOf(r).until,'2026-03-10');assert.equal(shiftDate('2026-12-31',1),'2027-01-01');
 assert.deepEqual(scopeOf({...r,group:'month'}),scopeOf(r));
 assert.equal(parseRoute('?offset=1.5').offset,1);assert.equal(parseRoute('?timezone=bad').timezone,'UTC');
 assert.equal(parseRoute('?since=2026-02-30',new Date('2026-10-01T00:00:00Z')).since,'2026-09-02');
});
test('live views use the live transport in cached mode; fixed snapshots stay offline',async()=>{
 const calls:unknown[]=[];const result={} as UsageResult;
 const client={query:async(q:unknown)=>{calls.push(q);return result;},live:async(q:unknown)=>{calls.push(q);return {result};}} as unknown as UsageClient;
 await readUsage(client,{action:'threads',snapshotId:'live:v1'});
 assert.deepEqual(calls.pop(),{query:{action:'threads',snapshotId:'live:v1'},mode:'cached'});
 await readUsage(client,{action:'usage',snapshotId:'saved-v1'});assert.deepEqual(calls.pop(),{action:'usage',snapshotId:'saved-v1'});
 result.freshness={status:'failed',revision:'old',error:'synthetic source unavailable'};
 assert.equal((await readUsage(client,{action:'usage'})).freshness?.status,'failed');
});

test('out-of-range detail pages recover within the original version and scope',async()=>{
 const {readUsagePage}=await import('../src/state.js');
 const calls:import('@wombat/client').UsageRequest[]=[];
 const client={query:async(q:import('@wombat/client').UsageRequest)=>{calls.push(q);return {snapshotRef:{snapshotId:'saved-v1'},items:q.offset===20?[{kind:'turn'}]:[],page:{total:25,limit:20,offset:q.offset,nextOffset:null}};}} as unknown as UsageClient;
 const result=await readUsagePage(client,{action:'turns',snapshotId:'saved-v1',threadId:'thread',scope:{model:'m'},offset:1000,limit:20});
 assert.equal(result.page.offset,20);
 assert.deepEqual(calls[1],{action:'turns',snapshotId:'saved-v1',threadId:'thread',scope:{model:'m'},offset:20,limit:20});
});

test('configuration routes preserve selection, evidence paging and pinned usage versions', () => {
  const route = parseRoute('?page=extensions&extensionKind=skill&configId=item&configView=config%3Aone&configOffset=30&evidenceOffset=20&snapshot=live%3Aone&configThread=thread');
  assert.equal(route.page, 'extensions'); assert.equal(route.extensionKind, 'skill');
  assert.equal(route.configOffset, 30); assert.equal(route.evidenceOffset, 20);
  assert.equal(route.configView, 'config:one'); assert.equal(route.snapshot, 'live:one');
  assert.deepEqual(parseRoute(routeSearch(route)), route);
  const invalid = parseRoute('?page=extensions&extensionKind=arbitrary&configOffset=-1');
  assert.equal(invalid.extensionKind, undefined); assert.equal(invalid.configOffset, 0);
});

test('all dates and review routes round trip without leaking date filters into all-time scope',()=>{
 const r=parseRoute('?allTime=1&page=optimize&optimizeView=config%3Aone&decisionRevision=2&suggestion=a&optimizeGroup=history&optimizeCategory=trim&optimizeOffset=30');
 assert.equal(scopeOf(r).allTime,true);assert.equal(scopeOf(r).since,undefined);assert.equal(scopeOf(r).until,undefined);
 assert.deepEqual(parseRoute(routeSearch(r)),r);
});
test('amount display retains small positive, zero, partial and unpriced distinctions',async()=>{
 const {amount}=await import('../src/components.js');
 const summary={price:{status:'priced',cost:'0.000001',knownCost:'0.000001'}} as import('@wombat/client').UsageSummary;
 assert.equal(amount(summary,2),'<$0.01');assert.equal(amount(summary),'<$0.0001');summary.price.cost='0';assert.equal(amount(summary,2),'$0.00');
 summary.price.status='partial';assert.equal(amount(summary,2),'$0.00*');summary.price.status='unknown';assert.notEqual(amount(summary,2),'$0.00');
});

test('adjustable reminders round-trip independently of immutable specification limits',()=>{
 const route=parseRoute('?page=optimize&agentsBytes=20000&descriptionCharacters=0');
 assert.equal(route.agentsBytes,20000);assert.equal(parseRoute(routeSearch(route)).descriptionCharacters,0);
 assert.equal(parseRoute('?agentsBytes=0&descriptionCharacters=1025').agentsBytes,undefined);assert.equal(parseRoute('?descriptionCharacters=1025').descriptionCharacters,undefined);
});

test('related record dates preserve static checks, and exact-turn return restores every original filter',async()=>{
 const {patchRoute,relatedTurnRoute,returnRoute}=await import('../src/state.js');
 const original=parseRoute('?page=optimize&since=2026-09-25&until=2026-10-01&timezone=Asia%2FShanghai&project=%2Fproject&source=source&model=m&effort=high&search=query&optimizeView=config%3Aone&decisionRevision=7&suggestion=a&suggestionRecord=record&optimizeGroup=history&optimizeCategory=trim&optimizeOffset=30&agentsBytes=20000&descriptionCharacters=700');
 const dated=patchRoute(original,{since:'2026-09-20',timezone:'UTC'});
 assert.equal(dated.optimizeView,original.optimizeView);assert.equal(dated.suggestion,original.suggestion);assert.equal(dated.decisionRevision,'7');
 const target=patchRoute(original,relatedTurnRoute(original,'live:pinned','thread-exact','turn-exact'));
 assert.equal(target.turn,'turn-exact');assert.equal(target.thread,'thread-exact');assert.equal(target.snapshot,'live:pinned');assert.equal(target.turnView,'all');assert.equal(target.model,undefined);
 assert.deepEqual(returnRoute(parseRoute(routeSearch(target))),original);
 const changed=patchRoute(original,{project:'/other'});assert.equal(changed.optimizeView,undefined);assert.equal(changed.suggestion,undefined);
 assert.equal(returnRoute({...target,returnTo:'https://example.com'}),undefined);assert.equal(returnRoute({...target,returnTo:'?page=invalid&suggestion=a'}),undefined);
});

test('relative dates advance across a local day while explicit and fixed dates stay unchanged',async()=>{
 const {advanceRelativeRoute,patchRoute}=await import('../src/state.js');
 const first=parseRoute('?timezone=Asia%2FShanghai&relativeDays=7',new Date('2026-10-01T15:59:59Z'));
 assert.equal(first.until,'2026-10-01');assert.equal(first.since,'2026-09-25');
 const next=advanceRelativeRoute(first,new Date('2026-10-01T16:00:01Z'));
 assert.equal(next.until,'2026-10-02');assert.equal(next.since,'2026-09-26');
 assert.equal(parseRoute(routeSearch(next),new Date('2026-10-01T16:00:01Z')).relativeDays,7);
 const manual=patchRoute(first,{since:'2026-09-25',until:'2026-10-01'});
 assert.equal(manual.relativeDays,undefined);assert.equal(advanceRelativeRoute(manual,new Date('2026-10-02')),manual);
 const fixed={...first,snapshot:'live:one'};assert.equal(advanceRelativeRoute(fixed,new Date('2026-10-02')),fixed);
});

test('five surfaces retain independent inventory filters and manual expansion through URL navigation',async()=>{
  const {patchRoute}=await import('../src/state.js');
  const expansion=JSON.stringify(['directory:/synthetic/project']);
  const first=parseRoute('?page=instructions&instructionSearch=rules&extensionSearch=review&instructionExpansion='+encodeURIComponent(expansion));
  const extensions=patchRoute(first,{page:'extensions'}),instructions=patchRoute(extensions,{page:'instructions'});
  assert.equal(instructions.instructionSearch,'rules');assert.equal(instructions.extensionSearch,'review');assert.equal(instructions.instructionExpansion,expansion);
  assert.deepEqual(parseRoute(routeSearch(instructions)),instructions);
  assert.equal(parseRoute('?instructionExpansion='+encodeURIComponent('["invalid"]')).instructionExpansion,undefined);
});
