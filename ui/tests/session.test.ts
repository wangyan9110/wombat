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
