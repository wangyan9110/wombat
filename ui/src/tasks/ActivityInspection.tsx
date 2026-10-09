import {useEffect,useState} from 'react';
import {CoreError,type UsageClient,type TimingLocalResult,type OptimizeResult} from '@wombat/client';
import {t,activityRuleTitle,activityFindingTitle,activityCheckText,activityAdviceText} from '@wombat/client/locale';
type Activity=NonNullable<OptimizeResult['activity']>;
export function ActivityFacts({activity,onEvidence,blocked=false}:{activity:Activity;onEvidence:(refs:string[])=>void;blocked?:boolean}){
 return <section className="execution-activity" aria-label={t('activity.title')}><h4>{t('activity.title')}</h4>
  {activity.advice.map(rule=>{const check=activity.checks.find(check=>check.rule===rule)!;return <article key={rule}><strong>{activityFindingTitle(check)}</strong><p>{activityAdviceText(rule)}</p>{check.partial&&<p className="compact-note">{t('activity.partial')}</p>}<button className="link" disabled={blocked||check.observed.evidenceRefs.length===0} onClick={()=>onEvidence(check.observed.evidenceRefs)}>{t('activity.records')}</button></article>;})}
  <p className="compact-note">{t('activity.note')}</p><details><summary>{t('activity.checks')}</summary>{activity.checks.map(check=><p key={check.rule}>{activityRuleTitle(check.rule)}: {activityCheckText(check)}</p>)}</details>
 </section>;
}
/** Read-only inspection is bound to the presented turn and never initiates configuration collection. */
export function ActivityInspection({client,summary,onEvidence,blocked,onExpired}:{client:UsageClient;summary:TimingLocalResult;onEvidence:(refs:string[])=>void;blocked:boolean;onExpired:()=>void}){
 const [activity,setActivity]=useState<Activity>(),[error,setError]=useState(false),[retry,setRetry]=useState(0);
 const snapshotId=summary.readView.snapshotId,{threadId,turnId,sourceInstanceId}=summary.scope;
 useEffect(()=>{
  if(blocked||!client.optimize)return;
  const controller=new AbortController();let current=true;setError(false);
  void client.optimize({action:'activity',activity:{snapshotId,threadId,turnId},sourceInstanceId},{signal:controller.signal}).then(result=>{
   if(current&&!controller.signal.aborted){if(!result.activity)throw new CoreError('PROTOCOL_ERROR','Missing activity inspection');setActivity(result.activity);}
  }).catch((error:unknown)=>{if(current&&!controller.signal.aborted){if(error instanceof CoreError&&error.code==='VIEW_EXPIRED')onExpired();else setError(true);}});
  return()=>{current=false;controller.abort();};
 },[client,snapshotId,threadId,turnId,sourceInstanceId,blocked,retry,onExpired]);
 if(!client.optimize)return null;
 return <>{activity&&<ActivityFacts activity={activity} onEvidence={onEvidence} blocked={blocked||!summary.evidence.available}/>}
  {error&&<p role="alert">{t('activity.unavailable')} <button className="link" disabled={blocked} onClick={()=>setRetry(value=>value+1)}>{t('activity.retry')}</button></p>}</>;
}
