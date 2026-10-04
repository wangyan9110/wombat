import{test}from'node:test';
import assert from'node:assert/strict';
import{createElement}from'react';
import{renderToStaticMarkup}from'react-dom/server';
import{Preparation}from'../src/Preparation.js';
import{locale}from'@wombat/client/locale';
test('reading announces stage only and keeps elapsed time in closed details',()=>{
 const previous=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);const html=renderToStaticMarkup(createElement(Preparation,{since:0,pending:true,progress:'',initial:true}));const announcement=html.match(/role="status">([^]*?)<\/p>/)?.[1];assert(announcement);assert.doesNotMatch(announcement,/seconds|秒/);assert.match(html,/<details class="provenance">/);assert.doesNotMatch(html,/<details[^>]*open/);assert.match(html,language==='zh'?/读取详情/:/Read details/);}}finally{locale.setLocale(previous)}
});
