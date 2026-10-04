import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowanceStatus,type AllowanceAssessment} from '../src/allowance.js';
test('expired, future and missing allowance observations become unknown, not permission or denial',()=>{
 const check:AllowanceAssessment={status:'blocked',checkedAt:'2026-10-04T00:00:00Z',validUntil:'2026-10-04T00:01:00Z',model:'synthetic',provider:'openai',bucketId:'synthetic',windowId:null,reason:'native_window_limit'};
 assert.equal(allowanceStatus(check,Date.parse('2026-10-04T00:00:30Z')),'blocked');
 for(const now of ['2026-10-04T00:01:00Z','2026-10-03T23:59:59Z'])assert.equal(allowanceStatus(check,Date.parse(now)),'unknown');
 assert.equal(allowanceStatus({...check,validUntil:null}),'unknown');
});
