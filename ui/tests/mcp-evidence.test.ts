import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { locale, configEvidenceLabel, operationTypeLabel } from '@wombat/client/locale';
import { InvocationCounts } from '../src/config/InvocationCounts.js';
import type { ConfigResult } from '@wombat/client';
test('MCP resource usage stays separate from tool calls and unknown absence in both languages',()=>{
 const old=locale.getSnapshot().locale;
 const coverage={status:'partial',historyStatus:'current',issues:[],supportedEvidence:['tool_call','resource_read'],absenceObservable:false} satisfies ConfigResult['coverage'];
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);const html=renderToStaticMarkup(createElement(InvocationCounts,{counts:{fileReads:0,toolCalls:2,resourceReads:1,succeeded:1,failed:2,outcomeUnknown:0},coverage}));assert.match(html,/2 次工具调用|2 tool calls/);assert.match(html,/1 次资源读取|1 resource read/);assert.match(configEvidenceLabel('resource_read'),/资源读取|Resource read/);assert.match(operationTypeLabel('mcpResource'),/资源读取|resource read/);const empty=renderToStaticMarkup(createElement(InvocationCounts,{counts:{fileReads:0,toolCalls:0,resourceReads:0,succeeded:0,failed:0,outcomeUnknown:0},coverage}));assert.doesNotMatch(empty,/0 次|0 resource|0 tool/);}}
 finally{locale.setLocale(old);}
});
