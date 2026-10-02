import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionLanguage,saveLanguage } from '../src/session.js';
test('language survives reload and an explicit new link overrides the saved choice',()=>{
 const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
 assert.equal(sessionLanguage('en',storage,['zh-CN']),'en');
 assert.equal(sessionLanguage(null,storage,['zh-CN']),'en');
 saveLanguage(storage,'zh');
 assert.equal(sessionLanguage(null,storage,['en-US']),'zh');
 assert.equal(sessionLanguage('en',storage,['zh-CN']),'en');
 values.set('wombat-language','invalid');
 assert.equal(sessionLanguage(null,storage,['zh-CN']),'zh');
});
test('restricted browser storage falls back to a usable in-page language',()=>{
 const storage={getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('blocked');}};
 assert.equal(sessionLanguage('en',storage,['zh']),'en');
});

test('a delayed saved language cannot reverse a user choice or a subsequent choice back',async()=>{
 const {restoreLanguage}=await import('../src/session.js');const {LocaleRuntime}=await import('@wombat/client/locale');
 let resolve!:(value:unknown)=>void;const pending=new Promise(resolvePromise=>{resolve=resolvePromise;});
 const client={preferences:async()=>pending} as import('@wombat/client').UsageClient;
 const runtime=new LocaleRuntime('zh');const restoring=restoreLanguage(client,runtime);
 runtime.setLocale('en');runtime.setLocale('zh');resolve({outputVersion:1,language:'en'});await restoring;
 assert.equal(runtime.getSnapshot().locale,'zh');
 const normal=new LocaleRuntime('zh');await restoreLanguage({preferences:async()=>({outputVersion:1,language:'en'})} as import('@wombat/client').UsageClient,normal);
 assert.equal(normal.getSnapshot().locale,'en');
 await restoreLanguage({preferences:async()=>{throw new Error('unavailable');}} as import('@wombat/client').UsageClient,normal);
 assert.equal(normal.getSnapshot().locale,'en');
});
