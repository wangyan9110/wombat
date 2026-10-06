import type {TimingLocalResult} from '@wombat/client';
/** Two requests in one observed historical stage; independent synthetic endpoints. */
export function inputChangeFixture(delta=19900):TimingLocalResult['context']['inputChange'] {
 const first=100,last=first+delta;
 const stage={id:'input-stage:1',samples:2,firstRef:'measurement:synthetic-first',lastRef:'measurement:synthetic-last',firstInput:first,lastInput:last,delta,factor:last/first};
 return {method:'request_input_observation_change_v1',availability:{support:'supported',reason:'request_input'},statistics:{candidates:2,orderedSamples:2,nonRequestScoped:0,missingInput:0,unassociated:0,numericRange:0,comparableStages:1,increasingStages:delta>0?1:0,decreasingStages:delta<0?1:0,unchangedStages:delta===0?1:0,maximumIncrease:{value:Math.max(delta,0),status:'derived',basis:'request_input',evidenceRefs:['collection:turn']},largestIncrease:delta>0?stage:null,stages:[stage],detailsOmitted:false,partial:false}};
}
