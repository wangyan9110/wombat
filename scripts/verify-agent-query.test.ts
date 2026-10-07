import {test} from 'node:test';
import assert from 'node:assert/strict';
import {agentMetrics,stdoutFromLog} from './verify-agent-query.ts';
test('Agent qualification preserves missing native usage fields and command-result byte units',()=>{
 const a=JSON.stringify({type:'item.completed',item:{type:'command_execution',command:'node /synthetic/wombat.js investigate',aggregated_output:'观测'}})+'\n';
 const b=JSON.stringify({type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:20,output_tokens:30}})+'\n';
 const log='metadata\n[stdout] '+a.slice(0,20)+'\n[stderr] unrelated\n[stdout] '+a.slice(20)+b;
 const metric=agentMetrics(stdoutFromLog(log));assert.equal(metric.toolCalls,1);assert.equal(metric.toolResultBytes,6);assert.equal(metric.inputTokens,100);assert.equal(metric.cachedInputTokens,20);assert.equal(metric.outputTokens,30);assert.equal(metric.reasoningTokens,null);
 assert.equal(agentMetrics(JSON.stringify({type:'turn.completed',usage:{}})).inputTokens,null);
 assert.throws(()=>agentMetrics('{invalid'));assert.throws(()=>agentMetrics(JSON.stringify({type:'turn.completed'})));
});
