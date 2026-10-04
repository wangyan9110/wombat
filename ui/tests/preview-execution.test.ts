import{test}from'node:test';
import assert from'node:assert/strict';
import{registerHooks}from'node:module';
import{createElement}from'react';
import{renderToStaticMarkup}from'react-dom/server';
import{locale}from'@wombat/client/locale';
registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'',shortCircuit:true}:next(url,context)}});
const{executionFixture}=await import('../src/preview/execution.js');
const{Execution}=await import('../src/tasks/Execution.js');
test('missing timestamps preserve observed use counts and switch to evidence list',()=>{
 const view=executionFixture('missing');assert.equal(view.duration,null);assert.equal(view.observedWindow,false);assert.equal(view.uses[0].count,3);assert.equal(view.uses[0].records.length,3);
 const html=renderToStaticMarkup(createElement(Execution,{view,refresh(){}}));assert.match(html,/execution-no-window/);assert.doesNotMatch(html,/<strong>100 s<\/strong>/);
});
test('running turns keep total duration unknown; dense fixture refresh updates evidence and share together',()=>{
 assert.equal(executionFixture('running').duration,null);
 const dense=executionFixture('dense',1);assert.equal(dense.uses[0].count,54);assert.equal(dense.uses[0].records.length,54);assert.match(dense.shareText,/Skill: 54/);assert.doesNotMatch(dense.shareText,/query-review|SKILL\.md|synthetic\/wombat/);
});
test('execution component resolves both locales without changing metric inputs',()=>{
 const previous=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);const view=executionFixture('complete');const html=renderToStaticMarkup(createElement(Execution,{view,refresh(){}}));assert.match(html,/100 s/);assert.match(html,language==='zh'?/执行过程/:/Execution/);assert.match(html,language==='zh'?/3 次/:/3 uses/);}}finally{locale.setLocale(previous)}
});
