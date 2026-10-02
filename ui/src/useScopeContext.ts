import {useEffect,useState} from 'react';
import type {ConfigResult,UsageClient,UsageResult} from '@wombat/client';

/** Reuse a pinned configuration view and committed ledger; menu reads never collect logs. */
export async function readScopeContext(client:UsageClient,readView:string,signal:AbortSignal){
 if(!client.config)return;
 const config=await client.config({action:'list',readView,scope:{allTime:true},limit:1},{signal});
 const query={action:'usage' as const,snapshotId:config.usageRevision??undefined,scope:{allTime:true},limit:1};
 const usage=config.usageRevision?(config.usageRevision.startsWith('live:')&&client.live
  ?(await client.live({query,mode:'cached'},{signal})).result
  :await client.query(query,{signal})):undefined;
 return {config,usage};
}
export function useScopeContext(client:UsageClient,readView?:string){
 const [state,setState]=useState<{key?:string;config?:ConfigResult;usage?:UsageResult;error?:string;code?:string}>({});
 useEffect(()=>{if(!readView){setState({});return;}const c=new AbortController();void readScopeContext(client,readView,c.signal).then(data=>{if(!c.signal.aborted)setState({key:readView,...data});},e=>{if(!c.signal.aborted)setState({key:readView,error:e.message,code:e.code});});return()=>c.abort();},[client,readView]);
 return state.key===readView?state:{};
}
