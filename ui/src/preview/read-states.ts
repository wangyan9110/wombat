import { withTokenAnalysis } from './token-analysis.js';
import {t} from '@wombat/client/locale';
import {CoreError,type LiveRequest,type LiveResult,type QueryOptions,type UsageRequest,type UsageResult,type UsageSummary} from '@wombat/client';
import {taskFixture} from './tasks.js';
export const readScenarios=['source-missing','source-unreadable','source-unsupported','source-stale','source-sync-failed','session-expired','view-expired','usage-partial-price','usage-unpriced','usage-unassigned'] as const;
function pricing(value:UsageSummary,unknown:boolean,knownSingle?:boolean):UsageSummary{
 const count=value.measurementCount,known=unknown?0:count===1&&knownSingle!==undefined?knownSingle?1:0:Math.floor(count/2),unpriced=count-known;
 return {...value,unpricedTokens:unpriced*1100,price:{...value.price,knownCost:(known/1000).toFixed(6),cost:unpriced?null:value.price.cost,status:unpriced?known?'partial':'unknown':'priced',issues:unpriced?['syntheticRateUnavailable']:[]}};
}
/** Native synthetic source observations use the normal fixed-view transport. */
export function previewReadState(scenario:string){
 let observations=0,revision=1,pinnedPages=0;
 const read=async(request:UsageRequest,options?:QueryOptions):Promise<UsageResult>=>{
  if(options?.signal?.aborted)throw new CoreError('CANCELLED','Cancelled');
  if(!request.snapshotId){observations++;if(scenario==='session-expired'&&observations>1)throw new CoreError('HTTP_403','Synthetic browser session expired');}
  if(scenario==='view-expired'&&request.snapshotId){pinnedPages++;if(request.snapshotId==='preview:1'&&pinnedPages>2){revision=2;throw new CoreError('VIEW_EXPIRED','Synthetic view expired');}}
  if(request.snapshotId&&request.snapshotId!==`preview:${revision}`)throw new CoreError('VIEW_EXPIRED','Synthetic view expired');
  const result=taskFixture({...request,snapshotId:undefined},scenario==='usage-unassigned'?'usage-unassigned':'complete');result.snapshotRef.snapshotId=request.snapshotId??`preview:${revision}`;result.freshness={status:request.snapshotId?'fixed':'current',revision:`synthetic-${revision}`,checkedAt:'2026-10-04T02:00:00Z'};
  const absent=scenario==='source-missing'||scenario==='source-unreadable'||scenario==='source-unsupported';
  if(absent){const status=scenario==='source-missing'?'notFound':scenario==='source-unreadable'?'failed':'unsupported';result.items=[];result.page={...result.page,total:0,nextOffset:null};result.summary=withTokenAnalysis({...result.summary,measurementCount:0,inputTotal:0,tokens:{total:null},price:{...result.summary.price,cost:null,knownCost:'0',status:'unknown'}});result.quality.status='partial';result.quality.sources.forEach(source=>{source.status=status;source.filesRead=0;source.bytesRead=0;source.issues=[{code:status==='failed'?'sourceUnreadable':status==='notFound'?'sourceNotFound':'unsupportedSource',message:t('preview.sourceObservation')}];});result.facets={directories:[],hasUnassigned:false,models:[],reasoningEfforts:[],agents:[],discoveredThreadCount:0};}
  if(scenario==='usage-partial-price'||scenario==='usage-unpriced'){
   const adjust=(value:UsageSummary,knownSingle?:boolean)=>pricing(value,scenario==='usage-unpriced',knownSingle);const knownTurn=request.turnId==='preview-turn'||request.turnId?.endsWith('-turn-1');result.summary=adjust(result.summary,request.action==='steps'?knownTurn:undefined);result.items=result.items.map(row=>row.kind==='thread'?{...row,threadUsage:adjust(row.threadUsage),matchedUsage:adjust(row.matchedUsage)}:row.kind==='turn'?{...row,usage:adjust(row.usage,row.ordinal===2),matchedUsage:adjust(row.matchedUsage,row.ordinal===2)}:'usage' in row?{...row,usage:adjust(row.usage,row.kind==='measurement'?knownTurn:undefined),...(row.kind==='usage'?{costShare:null}:{})}:row);
   if(result.distribution)result.distribution={...result.distribution,maxCost:null,unpricedTokens:result.summary.unpricedTokens,peakCostDates:[],peakCostScopes:[]};
  }
  return result;
 };
 const live=async(request:LiveRequest,options?:QueryOptions):Promise<LiveResult>=>{
  const result=await read(request.query,options);const status=request.query.snapshotId?'fixed':scenario==='source-stale'?'stale':scenario==='source-sync-failed'?'failed':'current';const freshness={status,revision:`synthetic-${revision}`,checkedAt:'2026-10-04T02:00:00Z',...(status==='failed'?{error:'Synthetic source refresh failed',errorCode:'SOURCE_UNREADABLE'}:{})};result.freshness=freshness;return {outputVersion:1,result,freshness};
 };
 return {query:read,live};
}
