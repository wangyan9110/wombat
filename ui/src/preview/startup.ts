import {CoreError,type LiveRequest,type LiveResult,type QueryOptions,type UsageSummary} from '@wombat/client';
import {taskFixture} from './tasks.js';
/** Native metadata can precede complete metering; cancellation stops only this caller. */
export function previewStartup(scenario:string){
 let complete=false;
 return async(request:LiveRequest,options?:QueryOptions):Promise<LiveResult>=>{
  if(options?.signal?.aborted)throw new CoreError('CANCELLED','Cancelled');
  options?.onProgress?.('读取 Codex 日志');
  if(request.mode==='fresh'&&!request.query.snapshotId){
   await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,25);options?.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new CoreError('CANCELLED','Cancelled'));},{once:true});});
   if(options?.signal?.aborted)throw new CoreError('CANCELLED','Cancelled');complete=true;
  }
  if(scenario==='initial-pending'&&!complete)throw new CoreError('SYNC_PENDING','Synthetic shared read is pending');
  const fixedInitial=request.query.snapshotId==='live:preview-initial';
  const result=taskFixture(request.query,'complete');
  if(complete&&!fixedInitial){const freshness={status:'current',revision:'synthetic-complete',checkedAt:'2026-10-04T02:00:00Z'};result.freshness=freshness;return {outputVersion:1,result,freshness};}
  const unknown:UsageSummary={measurementCount:0,tokens:{total:null},price:{currency:'USD',policy:'synthetic',priceRevision:'preview',knownCost:'0',cost:null,status:'unknown',components:[],basis:[],issues:[]}};
  result.summary=unknown;result.items=request.query.action==='threads'?result.items.map(item=>item.kind==='thread'?{...item,matchedUsage:unknown,threadUsage:unknown,matchedTurnCount:null}:item):[];result.page={...result.page,total:request.query.action==='threads'?result.page.total:0,nextOffset:request.query.action==='threads'?result.page.nextOffset:null};result.snapshotRef={snapshotId:'live:preview-initial',createdAt:'2026-10-04T02:00:00Z'};result.quality.status='partial';result.quality.sources.forEach(source=>source.status='partial');const freshness={status:'syncing',revision:'synthetic-headers',initialScan:true,checkedAt:'2026-10-04T02:00:00Z'};result.freshness=freshness;return {outputVersion:1,result,freshness};
 };
}
