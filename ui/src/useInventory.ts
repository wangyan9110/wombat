import { useEffect,useRef,useState } from 'react';
import type { ConfigRequest,ConfigResult,OptimizeSuggestion,UsageClient } from '@wombat/client';
import { t } from '@wombat/client/locale';
import {followInventory} from './config/readInventory.js';
export function useInventory(client:UsageClient,request:ConfigRequest|undefined,allPages:boolean) {
  const key=JSON.stringify(request),[retry,setRetry]=useState(0),[state,setState]=useState<{key?:string;data?:ConfigResult;loading:boolean;error?:string;code?:string}>({loading:false});
  const active=useRef<AbortController|undefined>(undefined);
  useEffect(()=>{if(!key){setState({loading:false});return;}const c=new AbortController();active.current=c;setState(previous=>({...previous,key,data:previous.key===key?previous.data:undefined,loading:true,error:undefined,code:undefined}));
    void followInventory(client,JSON.parse(key),allPages,c.signal,data=>{if(!c.signal.aborted)setState({key,data,loading:false});}).catch(e=>{if(!c.signal.aborted)setState(previous=>({...previous,key,error:e.message,code:e.code,loading:false}));});return()=>c.abort();
  },[client,key,allPages,retry]);
  return {...(state.key===key?state:{loading:!!key}),retry:()=>setRetry(n=>n+1),cancel:()=>{active.current?.abort();setState(previous=>({...previous,key,loading:false,error:'CANCELLED',code:'CANCELLED'}));}};
}
export function useInventorySuggestions(client:UsageClient,readView:string|undefined,project:string|undefined,source:string|undefined,agentsBytes?:number,descriptionCharacters?:number) {
  const [state,setState]=useState<{key?:string;byItem:Map<string,OptimizeSuggestion[]>;ordered:OptimizeSuggestion[];revision?:string;error?:Error}>({byItem:new Map(),ordered:[]});
  const key=JSON.stringify([readView,project,source,agentsBytes,descriptionCharacters]);
  useEffect(()=>{if(!readView||!client.optimize)return;const c=new AbortController();
    const read=async()=>{
      const all:OptimizeSuggestion[]=[];let offset:number|null=0,revision:string|undefined;
      while(offset!=null){if(all.length>=20_000)throw new Error(t('webui.partial'));const page=await client.optimize!({action:'list',readView,project,sourceInstanceId:source,offset,limit:200,ruleOverrides:{agentsBytes,descriptionCharacters}},{signal:c.signal});all.push(...page.suggestions);if(page.page.nextOffset!=null&&page.page.nextOffset<=offset)throw new Error(t('webui.failed'));offset=page.page.nextOffset??null;revision=page.decisionRevision;}
      const byItem=new Map<string,OptimizeSuggestion[]>();for(const s of all){const list=byItem.get(s.item.id)??[];list.push(s);byItem.set(s.item.id,list);}return {key,byItem,ordered:all,revision};
    };void read().then(result=>{if(!c.signal.aborted)setState(result);},error=>{if(!c.signal.aborted)setState({key,byItem:new Map(),ordered:[],error});});return()=>c.abort();
  },[client,key,readView,project,source,agentsBytes,descriptionCharacters]);
  return state.key===key?state:{byItem:new Map<string,OptimizeSuggestion[]>(),ordered:[]};
}
