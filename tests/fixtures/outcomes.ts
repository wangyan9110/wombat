import type {TimingLocalResult} from '@wombat/client';
type Outcomes=TimingLocalResult['work']['outcomes'];
const count=(value:number):Outcomes['failed']=>({value,status:'derived',basis:'determinate_terminal_outcomes',evidenceRefs:['collection:canonical_operations']});
/** Fixed synthetic truth: two successes, one failure, one unresolved result, one interruption. */
export function outcomeStatistics():Outcomes{return {method:'terminal_success_failure_subset_v1',determinateOperations:count(3),succeeded:count(2),failed:count(1),interrupted:count(1),rejected:count(0),nonterminal:count(0),indeterminate:count(1),conflicting:count(0),identityGapRecords:count(0),unclassified:count(0),failureRatio:{value:1/3,status:'derived',basis:'determinate_terminal_outcomes',evidenceRefs:['collection:canonical_operations']},partial:true};}
