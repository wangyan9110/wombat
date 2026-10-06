import {CoreError,type OptimizeRequest,type OptimizeResult,type TimingLocalResult} from '@wombat/client';
import {timingFixture} from './timing.js';
import type {Scenario} from './fixtures.js';
export function activityFixture(summary:TimingLocalResult,scenario:Scenario):OptimizeResult{
 const repeats=summary.time.repeatedBehavior,noOrder=['missing','running','interrupted'].includes(scenario),incomplete=noOrder||scenario==='mcp-only'||scenario==='mcp-mixed';
 const checks:NonNullable<OptimizeResult['activity']>['checks']=[
  {outcomes:null,failurePolicy:null,rule:'inspect_calls_after_failure',version:1,method:'same_operation_after_failure_v1',observed:repeats.afterFailure.count,outcome:noOrder?'insufficient':scenario==='mcp-only'||scenario==='mcp-mixed'?'insufficient':scenario==='empty'?'miss':'hit',partial:incomplete,reason:incomplete?'activityCoverageIncomplete':null},
  {outcomes:null,failurePolicy:null,rule:'inspect_repeated_reads',version:1,method:'same_target_read_v1',observed:repeats.repeatedRead.count,outcome:noOrder?'insufficient':scenario==='mcp-only'||scenario==='mcp-mixed'?'insufficient':scenario==='empty'?'miss':'hit',partial:incomplete,reason:incomplete?'activityCoverageIncomplete':null},
  {outcomes:null,failurePolicy:null,rule:'inspect_repeated_requests',version:1,method:'same_request_observation_v1',observed:repeats.sameRequestObservationCount,outcome:scenario==='empty'?'miss':scenario==='mcp-only'||scenario==='mcp-mixed'?'insufficient':'hit',partial:scenario==='mcp-only'||scenario==='mcp-mixed',reason:scenario==='mcp-only'||scenario==='mcp-mixed'?'activityCoverageIncomplete':null},
  {rule:'inspect_failure_share',version:1,method:'terminal_failure_inspection_v1',observed:summary.work.outcomes.failed,outcomes:summary.work.outcomes,failurePolicy:{minimumDeterminate:5,minimumFailures:2,minimumRatio:0.4},outcome:scenario==='failed'?'hit':'insufficient',partial:summary.work.outcomes.partial,reason:scenario==='failed'?null:'activitySampleTooSmall'},
 ];
 return {outputVersion:3,action:'activity',capabilities:{staticChecks:true,manualEditReview:true,decisions:true,inactivity:false,mcpFaults:false,spaceCleanup:false,loadingBudgetDiagnosis:false,exactInstructionBlocks:true,declaredCopyDrift:true,hookSupport:{effectiveRegistry:false,status:'no_verified_adapter'}},readView:null,configRevision:'',usageRevision:summary.readView.snapshotId,decisionRevision:'',checkedAt:summary.freshness.checkedAt??summary.readView.createdAt,suggestions:[],pending:0,history:0,page:{offset:0,limit:50,total:0},issues:[],resultStatus:scenario==='failed'?'complete':'partial',ruleParameters:{version:'static-config-v7',agentsBytesDefault:16384,descriptionCharactersDefault:500,overrides:{},bodyTokens:5000,descriptionStandardMax:1024,applicability:'authorizedCurrentConfigurationOnly'},ruleCatalog:[],checks:[],followUps:[],activity:{formatVersion:2,readView:summary.readView,scope:summary.scope,analysisMethod:summary.methodVersion,freshness:summary.freshness,sourceStatus:summary.coverage.sourceStatus,coverage:repeats.coverage,checks,advice:noOrder?['inspect_repeated_requests']:scenario==='empty'||scenario==='mcp-only'||scenario==='mcp-mixed'?[]:scenario==='failed'?['inspect_calls_after_failure','inspect_repeated_reads','inspect_failure_share']:['inspect_calls_after_failure','inspect_repeated_reads']}};
}
export function previewActivity(scenario:Scenario){
 return async(request:OptimizeRequest):Promise<OptimizeResult>=>{
  if(request.action!=='activity'||!request.activity)throw new CoreError('INVALID_ARGUMENT','Missing activity scope');
  if(scenario==='error')throw new CoreError('SOURCE_UNREADABLE','Synthetic source failure');
  return activityFixture(timingFixture(scenario,request.activity.snapshotId,request.activity.threadId,request.activity.turnId),scenario);
 };
}
