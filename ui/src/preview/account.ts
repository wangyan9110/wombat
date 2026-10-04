import {CoreError,type AccountRequest,type AccountResult,type QueryOptions} from '@wombat/client';
export const accountScenarios=['account-current','account-low','account-blocked','account-signed-out','account-api-key','account-unsupported','account-stale','account-expired','account-partial','account-multiple','account-credits','account-refresh-failed','account-unavailable','account-loading'] as const;
export type AccountScenario=typeof accountScenarios[number];
/** Fixed synthetic observations; no native account or credentials are read. */
export function accountFixture(request:AccountRequest,scenario:AccountScenario|'empty'='account-current'):AccountResult {
 const checkedAt='2026-10-04T02:00:00Z',empty=scenario==='empty';
 const section={status:empty?'unavailable':'available',checkedAt};
 const result:AccountResult={outputVersion:1,action:request.action??'read',account:{...section},allowance:{...section},activity:{...section},identity:empty?null:{id:'synthetic-account',kind:'chatgpt',maskedEmail:'demo@example.invalid',plan:'synthetic'},windows:empty?[]:[{id:'synthetic-week',bucketId:'codex',usedPercent:72,durationMinutes:10080,resetsAt:'2099-10-11T02:00:00Z',status:'current'}],buckets:empty?[]:[{id:'codex',status:'current'}],summary:empty?null:{lifetimeTokens:1100,currentStreakDays:1,longestStreakDays:1,peakDailyTokens:1100,longestRunningTurnSeconds:100}};
 if(scenario==='account-low')result.windows[0].usedPercent=95;
 if(scenario==='account-blocked')result.windows[0].usedPercent=100;
 if(scenario==='account-signed-out'||scenario==='account-api-key'||scenario==='account-unsupported'){
  result.account.status=scenario==='account-signed-out'?'signed_out':scenario==='account-unsupported'?'unsupported':'available';result.allowance.status='unavailable';result.activity.status='unavailable';result.windows=[];result.buckets=[];result.summary=null;result.identity=scenario==='account-api-key'?{id:'synthetic-api-key',kind:'api_key'}:null;
 }
 if(scenario==='account-stale'){result.allowance.status='stale';result.allowance.errorCode='ACCOUNT_UNAVAILABLE';}
 if(scenario==='account-expired')result.windows[0].resetsAt='2000-01-01T00:00:00Z';
 if(scenario==='account-partial'){result.allowance.status='partial';result.windows=[];result.buckets[0].status='partial';result.activity.status='unavailable';result.summary=null;}
 if(scenario==='account-multiple')result.windows.push({id:'synthetic-hour',bucketId:'codex',usedPercent:0,durationMinutes:60,resetsAt:'2099-10-11T02:00:00Z',status:'current'});
 if(scenario==='account-credits'){result.buckets.push({id:'synthetic-other',name:'Synthetic quota',status:'current',credits:{balance:'0.0001',hasCredits:true,unlimited:false},individualLimit:{limit:'100.000',used:'0',remainingPercent:100,status:'current'}});result.resetCredits={availableCount:0,credits:[],detailsTruncated:false};}
 return result;
}
export function previewAccount(scenario:string){
 const kind=accountScenarios.find(value=>value===scenario)??(scenario==='empty'?'empty':scenario==='handoff-blocked'?'account-blocked':'account-current');
 return async(request:AccountRequest,options?:QueryOptions):Promise<AccountResult>=>{
  if(options?.signal?.aborted)throw new CoreError('CANCELLED','Cancelled');
  if(kind==='account-loading')return new Promise<AccountResult>((_,reject)=>options?.signal?.addEventListener('abort',()=>reject(new CoreError('CANCELLED','Cancelled')),{once:true}));
  if(kind==='account-unavailable')throw new CoreError('ACCOUNT_UNAVAILABLE','Synthetic account unavailable');
  if(kind==='account-refresh-failed'&&request.action==='refresh')throw new CoreError('ACCOUNT_UNAVAILABLE','Synthetic account refresh failed');
  return accountFixture(request,kind);
 };
}
