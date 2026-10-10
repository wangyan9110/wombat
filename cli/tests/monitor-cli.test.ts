import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {parseMonitorArgs} from '../src/monitor-cli.js';
test('monitor rejects ambiguous writes and unsafe budgets before transport',()=>{
 for(const args of [ ['set','--id','x'],['set','--id','x','--tokens','9007199254740992'],['set','--id','x','--tokens','0'],['set','--id','x','--tokens','100','--warning','1.1'],['set','--id','x','--period','year','--review'],['list','--review'],['check','--snapshot','x'],['check','--snapshot','x','--id','x','--root','.'],['watch','--interval','4'],['watch','--interval','3601'],['watch','--id','a','--id','b'],['remove','--id','x','--tokens','1'],['list','--json=1']])assert.throws(()=>parseMonitorArgs([...args]),{code:'INVALID_ARGUMENT'});
 const set=parseMonitorArgs(['set','--id=x','--tokens=100','--project=.','--timezone=UTC']);assert.equal(set.request?.action,'upsert');if(set.request?.action==='upsert')assert.equal(set.request.plan.scope?.project,path.resolve('.'));
 const check=parseMonitorArgs(['check','--id=x','--root=.']);assert.deepEqual(check.ids,['x']);assert.deepEqual(check.roots,[path.resolve('.')]);
});
