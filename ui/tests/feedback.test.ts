import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UsageResult } from '@wombat/client';
import { locale } from '@wombat/client/locale';
import { EmptyUsage,QueryError } from '../src/Feedback.js';
locale.setLocale('en');
const noop=()=>{};
function empty(status:string,agents:string[],filtered=false,range?:{since:string;until:string}) {
 const result={quality:{status:status==='complete'?'complete':'partial',sources:[{status}]},facets:{agents},availableRange:range} as UsageResult;
 return renderToStaticMarkup(createElement(EmptyUsage,{result,filtered,sources:noop,clear:noop,dates:noop}));
}
test('empty source onboarding differs from unavailable sources and filtered existing history',()=>{
 const first=empty('complete',[]);
 assert.match(first,/No usage records found/);assert.match(first,/Check the source folder/);assert.doesNotMatch(first,/Clear filters/);
 const failed=empty('notFound',[]);
 assert.match(failed,/Sources could not be fully read/);assert.doesNotMatch(failed,/No usage records found/);
 const filtered=empty('complete',['codex'],true,{since:'2026-09-01',until:'2026-09-02'});
 assert.match(filtered,/Clear filters and search/);assert.match(filtered,/Show available dates/);assert.doesNotMatch(filtered,/No usage records found/);
});
test('expired credentials explain recovery without offering an ineffective retry',()=>{
 const html=renderToStaticMarkup(createElement(QueryError,{error:'HTTP 403',code:'HTTP_403',retry:noop}));
 assert.match(html,/latest full link/);assert.doesNotMatch(html,/<button|HTTP 403/);
 const ordinary=renderToStaticMarkup(createElement(QueryError,{error:'temporary failure',code:'NETWORK',retry:noop}));
 assert.match(ordinary,/Retry/);
});
