import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {createUsageClient,type HandoffRequest} from '@wombat/client';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {locale} from '@wombat/client/locale';
import {createPreviewClient} from '../src/preview/fixtures.js';
import {accountScenarios} from '../src/preview/account.js';
import {handoffScenarios} from '../src/preview/handoff.js';
import {summarizeAllowance,AccountSummaryCard} from '../src/account/Summary.js';
import {AllowanceDetails} from '../src/account/Allowance.js';
import {parseRoute} from '../src/state.js';
registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'',shortCircuit:true}:next(url,context);}});
const {HandoffButton}=await import('../src/optimize/Handoff.js');
const {DirectoryAuthorization}=await import('../src/DirectoryAuthorization.js');
function client(scenario:Parameters<typeof createPreviewClient>[0]){
 const raw=createPreviewClient(scenario);return createUsageClient({query:raw.query,account:raw.account,handoff:raw.handoff,directories:raw.directories});
}
test('all account scenarios use the generated contract and preserve known zero unknown stale and multiple states',async()=>{
 for(const scenario of accountScenarios.filter(value=>value!=='account-unavailable'&&value!=='account-loading')){const response=await client(scenario).account!({action:'read'});assert.equal(response.outputVersion,1);assert.equal(response.action,'read');}
 const at=Date.parse('2026-10-05T00:00:00Z');
 assert.equal(summarizeAllowance(await client('account-blocked').account!({}),at).kind,'current');
 const blocked=summarizeAllowance(await client('account-blocked').account!({}),at);assert.ok(blocked.kind==='current');assert.equal(blocked.remainingPercent,0);
 assert.equal(summarizeAllowance(await client('account-stale').account!({}),at).kind,'stale');assert.equal(summarizeAllowance(await client('account-expired').account!({}),at).kind,'stale');assert.equal(summarizeAllowance(await client('account-partial').account!({}),at).kind,'unknown');assert.equal(summarizeAllowance(await client('account-multiple').account!({}),at).kind,'multiple');
 const api=await client('account-api-key').account!({});assert.equal(api.identity?.kind,'api_key');assert.deepEqual(api.windows,[]);assert.equal(api.summary,null);
});
test('account refresh failure leaves the prior observation immutable and cancellation starts no simulated mutation',async()=>{
 const c=client('account-refresh-failed'),original=await c.account!({});const before=structuredClone(original);await assert.rejects(c.account!({action:'refresh'}),{code:'ACCOUNT_UNAVAILABLE'});assert.deepEqual(original,before);
 const controller=new AbortController();controller.abort();await assert.rejects(c.account!({action:'read'},{signal:controller.signal}),{code:'CANCELLED'});
});
test('production account presentation renders account-wide low multiple expired and read-only credits in both languages',async()=>{
 const saved=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);for(const scenario of ['account-low','account-multiple','account-expired','account-credits'] as const){const data=await client(scenario).account!({});const html=renderToStaticMarkup(createElement(AccountSummaryCard,{state:{data,busy:false,refresh(){}},timezone:'UTC',open(){}}));assert.match(html,language==='zh'?/账户级/:/Account-wide/);if(scenario==='account-low')assert.match(html,/5%/);if(scenario==='account-multiple'||scenario==='account-expired')assert.doesNotMatch(html,/<meter/);if(scenario==='account-credits'){const details=renderToStaticMarkup(createElement(AllowanceDetails,{data,timezone:'UTC'}));assert.match(details,/0\.0001/);assert.match(details,/100\.000/);assert.doesNotMatch(details,/<button/);}}}}finally{locale.setLocale(saved);}
});
test('directory choices are bounded synthetic authority tokens consumed once and revoke preserves other grants',async()=>{
 const c=client('directories-ready');assert.deepEqual((await c.directories!({action:'list'})).grants,[]);
 await assert.rejects(c.directories!({action:'authorize',purpose:'source',path:'/arbitrary/path'}),{code:'INVALID_ARGUMENT'});
 const first=await c.directories!({action:'choose',purpose:'source'});assert.ok(first.choiceToken);assert.equal(first.chosenPath,'/synthetic/codex-home');assert.equal(first.grants.length,0);
 const confirmed=await c.directories!({action:'confirm',choiceToken:first.choiceToken});assert.equal(confirmed.grants.length,1);await assert.rejects(c.directories!({action:'confirm',choiceToken:first.choiceToken}),{code:'INVALID_ARGUMENT'});
 const second=await c.directories!({action:'choose',purpose:'project'});const two=await c.directories!({action:'confirm',choiceToken:second.choiceToken});assert.equal(two.grants.length,2);
 const revoked=await c.directories!({action:'revoke',grantId:confirmed.grants[0].id});assert.equal(revoked.grants.length,1);assert.equal(revoked.grants[0].purpose,'project');
});
test('new directory choices expire the old token and unsupported picker or aborted calls grant nothing',async()=>{
 const c=client('directories-ready'),first=await c.directories!({action:'choose',purpose:'source'});await c.directories!({action:'choose',purpose:'project'});await assert.rejects(c.directories!({action:'confirm',choiceToken:first.choiceToken}),{code:'INVALID_ARGUMENT'});
 const controller=new AbortController();controller.abort();await assert.rejects(c.directories!({action:'choose',purpose:'source'},{signal:controller.signal}),{code:'CANCELLED'});assert.equal((await c.directories!({action:'list'})).grants.length,0);
 await assert.rejects(client('directories-unavailable').directories!({action:'choose',purpose:'project'}),{code:'DIRECTORY_PICKER_UNAVAILABLE'});
});
function sendRequest(preview:Awaited<ReturnType<NonNullable<ReturnType<typeof client>['handoff']>>>):HandoffRequest{
 return {action:'send',selectionVersion:preview.selectionVersion,readView:preview.readView,decisionRevision:preview.decisionRevision,suggestionIds:preview.projects.flatMap(project=>project.targets.flatMap(target=>target.suggestionIds))};
}
test('all delivery outcomes pass generated contracts without manufacturing execution usage or resolution',async()=>{
 for(const scenario of handoffScenarios){const c=client(scenario);if(scenario==='handoff-unavailable'){await assert.rejects(c.handoff!({action:'preview'}),{code:'CODEX_UNAVAILABLE'});continue;}
  const preview=await c.handoff!({action:'preview'});assert.equal(preview.projects.length,2);assert.deepEqual(preview.deliveries,[]);const sent=await c.handoff!(sendRequest(preview));
  assert.deepEqual(sent.deliveries.map(delivery=>delivery.status),scenario==='handoff-partial'?['accepted','failed']:Array(2).fill(scenario==='handoff-blocked'||scenario==='handoff-failed'?'failed':scenario==='handoff-unknown'?'unknown':'accepted'));
  assert.doesNotMatch(JSON.stringify(sent),/executionReceipt|resolved|savedTokens|cost|tokensTotal/);assert.equal(sent.projects[0].targets[0].findings[0].status,'failed');
 }
});
test('handoff requires the reviewed fixed selection and source scope, and cancellation never accepts a delivery',async()=>{
 const c=client('handoff-accepted');await assert.rejects(c.handoff!({action:'preview',sourceInstanceId:'other'}),{code:'NOT_FOUND'});
 const first=await c.handoff!({action:'preview',project:'/synthetic/wombat',suggestionIds:['preview-suggestion']});assert.equal(first.projects.length,1);const request={...sendRequest(first),project:'/synthetic/wombat'};
 await assert.rejects(c.handoff!({...request,project:'/synthetic/reporter'}),{code:'VIEW_EXPIRED'});await assert.rejects(c.handoff!({...request,suggestionIds:['different']}),{code:'INVALID_ARGUMENT'});const next=await c.handoff!({action:'preview'});await assert.rejects(c.handoff!(request),{code:'VIEW_EXPIRED'});
 const controller=new AbortController();controller.abort();await assert.rejects(c.handoff!(sendRequest(next),{signal:controller.signal}),{code:'CANCELLED'});assert.equal((await c.handoff!(sendRequest(next))).deliveries[0].status,'accepted');
});
test('account-specific loading and failures leave source queries independent and remain cancellable',async()=>{
 const raw=createPreviewClient('account-loading'),c=client('account-loading');const controller=new AbortController();const pending=c.account!({},{signal:controller.signal});controller.abort();await assert.rejects(pending,{code:'CANCELLED'});assert.equal((await raw.query({action:'threads'})).items.length,1);
 await assert.rejects(client('account-unavailable').account!({}),{code:'ACCOUNT_UNAVAILABLE'});assert.equal((await createPreviewClient('account-unavailable').query({action:'usage'})).summary.tokens.total,1100);
});
test('preview host transports enable the production handoff and directory authorization entries in both languages',()=>{
 const saved=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);
  const c=client('handoff-accepted');
  const handoff=renderToStaticMarkup(createElement(HandoffButton,{client:c,route:parseRoute('?page=optimize'),suggestionId:'preview-suggestion'}));assert.doesNotMatch(handoff,/disabled/);assert.match(handoff,language==='zh'?/交给 Codex/:/Send to Codex/);
  const directories=renderToStaticMarkup(createElement(DirectoryAuthorization,{client:c,onChanged(){}}));assert.equal((directories.match(/<button/g)??[]).length,2);assert.doesNotMatch(directories,/disabled/);assert.match(directories,language==='zh'?/选择 Agent 记录目录/:/Choose Agent records/);assert.match(directories,language==='zh'?/添加项目目录/:/Add a project directory/);
 }}finally{locale.setLocale(saved);}
});
