import {useEffect,useState} from 'react';
import type {OptimizeRequest,OptimizeResult,UsageClient} from '@wombat/client';
import {t,reviewPresentation} from '@wombat/client/locale';
import {QueryError} from './Feedback.js';
import {routeSearch,type Route} from './state.js';

/** Walk pinned pages without retaining other objects or silently truncating the lookup. */
export async function findConfigSuggestion(client:UsageClient,request:OptimizeRequest,itemId:string,signal:AbortSignal){
 if(!client.optimize)return;
 let offset=0,view=request.readView;
 while(!signal.aborted){
  const result:OptimizeResult=await client.optimize({...request,readView:view,offset,limit:200},{signal});
  view=result.readView??undefined;
  const index=result.suggestions.findIndex(s=>s.item.id===itemId);
  if(index>=0)return {suggestion:result.suggestions[index],result,offset:Math.floor((offset+index)/30)*30};
  if(result.page.nextOffset==null)return;
  if(result.page.nextOffset<=offset)throw new Error(t('webui.failed'));
  offset=result.page.nextOffset;
 }
}
export function ConfigSuggestion({client,route,itemId,readView,navigate,refresh}:{client:UsageClient;route:Route;itemId:string;readView:string;navigate:(r:Partial<Route>)=>void;refresh:()=>void}){
 const [retry,setRetry]=useState(0);
 const [state,setState]=useState<{key?:string;data?:Awaited<ReturnType<typeof findConfigSuggestion>>;error?:string;code?:string}>({});
 const request:OptimizeRequest={action:'list',readView,project:route.project,sourceInstanceId:route.source,group:'pending',ruleOverrides:{agentsBytes:route.agentsBytes,descriptionCharacters:route.descriptionCharacters}};
 const key=JSON.stringify([request,itemId]);
 useEffect(()=>{const c=new AbortController();setState({});void findConfigSuggestion(client,JSON.parse(key)[0],itemId,c.signal).then(data=>{if(!c.signal.aborted)setState({key,data});},e=>{if(!c.signal.aborted)setState({key,error:e.message,code:e.code});});return()=>c.abort();},[client,key,itemId,retry]);
 if(state.key!==key)return <p role="status">{t('webui.loading')}</p>;
 if(state.error)return <QueryError error={state.error} code={state.code} retry={state.code==='VIEW_EXPIRED'?refresh:()=>setRetry(n=>n+1)}/>;
 if(!state.data)return null;
 const {suggestion,result,offset}=state.data,presentation=reviewPresentation(suggestion);
 return <section className="config-recommendation"><h3>{t('config.relatedSuggestion')}</h3><button className="link" onClick={()=>navigate({page:'optimize',optimizeView:result.readView??undefined,decisionRevision:result.decisionRevision,suggestion:suggestion.id,suggestionRecord:suggestion.recordId??undefined,optimizeGroup:'pending',optimizeCategory:undefined,optimizeOffset:offset,detailReturn:routeSearch({...route,detailReturn:undefined})})}>{presentation.title}</button><p className="note">{presentation.value}</p></section>;
}
