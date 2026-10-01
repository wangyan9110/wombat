import { useEffect,useRef,useState } from 'react';
import type { UsageClient,UsageRequest,UsageResult,QueryOptions } from '@wombat/client';
import { readUsage,scopeOf,type Route } from './state.js';
export interface WorkspaceData { overview:UsageResult;list:UsageResult;turns?:UsageResult;route:Route }
/** Read every period/turn, keeping the first response's fixed version and summary. */
async function allPages(client:UsageClient,request:UsageRequest,options:QueryOptions,mode:'fresh'|'auto'='auto') {
 const first=await readUsage(client,request,options,mode);
 let next=first.page.nextOffset;
 while(next!=null){const page=await readUsage(client,{...request,snapshotId:first.snapshotRef.snapshotId,offset:next},options);first.items.push(...page.items);if(page.page.nextOffset!=null&&page.page.nextOffset<=next)throw new Error('INVALID_PAGINATION');next=page.page.nextOffset;}
 return {...first,page:{...first.page,nextOffset:null}};
}
/** Only complete query bundles replace the previous view. Pagination pins the data version. */
export function useWorkspace(client:UsageClient,route:Route){
 const [data,setData]=useState<WorkspaceData>(),[loading,setLoading]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),[renewed,setRenewed]=useState(false);
 const [revision,setRevision]=useState(0),controller=useRef<AbortController>(null),fresh=useRef(false),pinned=useRef<{key:string;id:string}>(undefined);
 const queryKey=JSON.stringify({...route,turn:undefined,periodSort:undefined});
 useEffect(()=>{
  if(route.page==='prices'||route.page==='optimize'){setLoading(false);return;}
  const abort=new AbortController();controller.current=abort;const force=fresh.current;fresh.current=false;
  setLoading(true);setError('');setProgress('');setRenewed(false);
  const options={signal:abort.signal,onProgress:(stage:string)=>{if(!abort.signal.aborted)setProgress(stage);}};
  const load=async(useFixed:boolean):Promise<void>=>{
   const scope=scopeOf(route),key=JSON.stringify(scope),fixed=useFixed&&!force&&pinned.current?.key===key?pinned.current.id:undefined;
   const overview=await allPages(client,{action:'usage',scope,group:route.group,presentation:'details',sort:'time',limit:500,snapshotId:fixed},options,force?'fresh':'auto');
   const snapshotId=overview.snapshotRef.snapshotId;
   const request:UsageRequest=route.page==='threads'?{action:'threads',scope,search:route.search,sort:route.sort,offset:route.offset,limit:10,locateThreadId:route.thread,snapshotId}:{action:'usage',scope,presentation:route.dimension,sort:route.sort==='cost'?'cost':'tokens',offset:route.offset,limit:20,snapshotId};
   let list=await readUsage(client,request,options);
   if(list.page.total>0&&!list.items.length)list=await readUsage(client,{...request,offset:Math.floor((list.page.total-1)/list.page.limit)*list.page.limit},options);
   const selected=list.items.find(item=>item.kind==='thread'&&(item.id===route.thread||item.upstreamId===route.thread))??list.items.find(item=>item.kind==='thread');
   const turns=selected?.kind==='thread'?await allPages(client,{action:'turns',scope,threadId:selected.id,sort:route.turnSort,limit:500,snapshotId},options):undefined;
   if(!abort.signal.aborted){pinned.current={key,id:snapshotId};setData({overview,list,turns,route});}
  };
  void load(true).catch(async reason=>{if(!abort.signal.aborted&&reason?.code==='VIEW_EXPIRED'){setRenewed(true);await load(false);}else throw reason;}).catch(reason=>{if(!abort.signal.aborted)setError(reason instanceof Error?reason.message:String(reason));}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
  return()=>abort.abort();
 },[client,queryKey,revision]);
 return {data,loading,progress,error,renewed,refresh:()=>{fresh.current=true;setRevision(v=>v+1);},cancel:()=>{controller.current?.abort();setLoading(false);setError('CANCELLED');}};
}
