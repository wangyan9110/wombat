import {useEffect,useState} from 'react';
import type {OptimizeResult,UsageClient} from '@wombat/client';
import {t,reviewFindingLabel} from '@wombat/client/locale';
import type {Route} from './state.js';
import {QueryError} from './Feedback.js';

/** Checks are requested only when expanded, and always use the inventory's fixed view. */
export function RuleChecks({client,route,readView,itemId}:{client:UsageClient;route:Route;readView:string;itemId:string}) {
  const [open,setOpen]=useState(false),[retry,setRetry]=useState(0);
  const request={action:'checks' as const,readView,itemId,project:route.project,sourceInstanceId:route.source,limit:1,ruleOverrides:{agentsBytes:route.agentsBytes,descriptionCharacters:route.descriptionCharacters}};
  const key=JSON.stringify(request);
  const [state,setState]=useState<{key?:string;data?:OptimizeResult;error?:Error;loading:boolean}>({loading:false});
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();setState({key,loading:true});
    void (client.optimize?client.optimize(JSON.parse(key),{signal:controller.signal}):Promise.reject(new Error(t('webui.unsupported')))).then(data=>{if(!controller.signal.aborted)setState({key,data,loading:false});},error=>{if(!controller.signal.aborted)setState({key,error,loading:false});});
    return()=>controller.abort();
  },[client,key,open,retry]);
  const current=state.key===key?state:undefined;
  const reason=(code?:string|null)=>{
    switch(code){case 'verifiedHostAdapterUnavailable':return t('optimize.hostEvidenceMissing');case 'continuousCoverageUnavailable':return t('optimize.coverageMissing');case 'runtimeInjectionUnavailable':return t('optimize.injectionMissing');case 'copyRelationNotDeclared':return t('optimize.copyUndeclared');default:return t('optimize.evidenceIncomplete');}
  };
  return <details className="provenance" onToggle={event=>setOpen(event.currentTarget.open)}><summary>{t('optimize.checks')}</summary>
    <p className="note">{t('optimize.checkNote')}</p>
    {open&&(!current||current.loading)&&<p role="status">{t('webui.loading')}</p>}
    {current?.error&&<QueryError error={current.error.message} retry={()=>setRetry(n=>n+1)}/>}
    {current?.data?.checks?.map(check=><article key={check.rule}><strong>{reviewFindingLabel(check.rule)}</strong><p>{t(`optimize.check.${check.outcome}`)}</p>{check.reason&&<p>{reason(check.reason)}</p>}</article>)}
  </details>;
}
