import {UsageInspection} from './UsageInspection.js';
import {SessionComparison,PublicationChanges} from './UsageComparison.js';
import { useEffect,useRef,useState,type ReactNode } from 'react';
import { QueryError } from './Feedback.js';
import type { UsageClient,UsageItem,UsageSummary } from '@wombat/client';
import { t, eventStatusLabel, operationTypeLabel } from '@wombat/client/locale';
import { CostComposition,type UsageSelection } from './UsageDrawer.js';
import { Composition,CostNote,Heading,Pair,Pagination,SummaryToken, Token,amount,timestamp } from './components.js';
import { scopeOf,returnRoute,linkedReturn,type Route } from './state.js';
import { TaskListSummary,TaskRow } from './tasks/TaskList.js';
import { TaskShortcuts } from './tasks/TaskShortcuts.js';
import { useTaskSuggestions } from './tasks/useTaskSuggestions.js';
import { useUsageQuery } from './useUsageQuery.js';
import { useTiming } from './useTiming.js';
import { TurnExecution } from './tasks/TurnExecution.js';
import type { WorkspaceData } from './useWorkspace.js';
type Turn=Extract<UsageItem,{kind:'turn'}>;
export function ThreadsView({empty,client,data,route,navigate,basis,usage,refresh}:{empty:ReactNode;refresh:()=>void;client:UsageClient;data:WorkspaceData;route:Route;navigate:(r:Partial<Route>)=>void;usage:(s:UsageSelection)=>void;basis:(s:UsageSummary)=>void}){
 const rows=data.list.items.filter((i):i is Extract<UsageItem,{kind:'thread'}>=>i.kind==='thread');
 const rememberedTask=useRef(route.thread);
 const selected=(route.thread?rows.find(i=>i.id===route.thread||i.upstreamId===route.thread):undefined)??(rememberedTask.current?rows.find(i=>i.id===rememberedTask.current||i.upstreamId===rememberedTask.current):undefined)??rows[0];
 const suggestions=useTaskSuggestions(client,data.list.snapshotRef.snapshotId,route,rows.map(row=>row.id));
 const listPosition=useRef(0),panelPosition=useRef(0),previousThread=useRef(route.thread),list=useRef<HTMLElement|null>(null),listOpener=useRef<HTMLButtonElement|null>(null);
 useEffect(()=>{if(previousThread.current&&!route.thread){window.scrollTo(0,listPosition.current);if(list.current)list.current.scrollTop=panelPosition.current;const target=listOpener.current?.isConnected?listOpener.current:list.current?.querySelector<HTMLElement>('.thread-row.active');target?.focus({preventScroll:true});}if(route.thread)rememberedTask.current=route.thread;previousThread.current=route.thread;},[route.thread]);
 const [search,setSearch]=useState(route.search??'');useEffect(()=>setSearch(route.search??''),[route.search]);
 const reviewReturn=returnRoute(route);
 return <>
  {reviewReturn&&<p className="read-notice"><button className="link" onClick={()=>navigate(reviewReturn)}>{t('webui.back')}</button></p>}
  <Heading title={t('webui.threads')} sub={t('task.purpose')}/>
  <div className={`split task-split ${route.thread?'task-selected':''}`}>
   <section ref={list} className="panel thread-list" data-view-scroll data-view-key="task-list" aria-label={t('webui.threadList')}>
    <div className="list-head">
     <form className="search-form" onSubmit={e=>{e.preventDefault();navigate({search:search||undefined,offset:0,thread:undefined,turn:undefined,turnOffset:0});}}>
      <input aria-label={t('webui.searchLabel')} placeholder={t('webui.search')} value={search} onChange={e=>setSearch(e.target.value)}/>
      <button aria-label={t('webui.searchAction')}>⌕</button>
     </form>
     <div className="list-meta"><select aria-label={t('webui.threadSort')} value={route.sort} onChange={e=>navigate({sort:e.target.value as Route['sort'],offset:0,thread:undefined,turn:undefined,turnOffset:0})}><SortOptions/></select></div>
    </div>
    <TaskListSummary result={data.list}/><PublicationChanges result={data.list}/>
    {rows.map(task=><TaskRow key={task.id} task={task} selected={task.id===selected?.id} route={route} suggestion={suggestions.get(task.id)} open={trigger=>{rememberedTask.current=task.id;listOpener.current=trigger;panelPosition.current=list.current?.scrollTop??0;listPosition.current=window.scrollY;navigate({thread:task.id,turn:undefined,turnOffset:0,offset:data.list.page.offset});}}/>)}
    {!rows.length&&<p className="compact-note">{t('webui.noMatch')}</p>}
    <Pagination page={data.list.page} onPage={offset=>navigate({offset,thread:undefined,turn:undefined,turnOffset:0})}/>
    <p className="compact-note">{t('task.listNote')}</p>
    <details className="provenance"><summary>{t('webui.dataVersion')}</summary><p>{t('webui.version',{version:data.list.snapshotRef.snapshotId})}</p></details>
   </section>
   <section className="panel detail task-detail" data-view-scroll data-view-key="task-detail" aria-label={t('webui.threadDetail')}>
    {selected?<>
     <button className="link task-return" onClick={()=>navigate({thread:undefined,turn:undefined})}>{t('task.backToList')}</button>
     <h2>{selected.title?.trim()||t('common.untitled_thread')}</h2>
     <p className="subtle">{t(data.list.quality.status==='partial'?'webui.recordedThread':'webui.fullThread')} <SummaryToken summary={selected.threadUsage} interactive/> Token · {amount(selected.threadUsage)}</p>
     <TaskShortcuts key={JSON.stringify([selected.id,data.list.snapshotRef.snapshotId,route.timezone])} client={client} snapshotId={data.list.snapshotRef.snapshotId} thread={selected.id} route={route} navigate={navigate} suggestion={suggestions.get(selected.id)}/>
     {selected.matchedUsage.measurementCount!==selected.threadUsage.measurementCount&&<div className="matched-summary">{t('webui.matched')}: <SummaryToken summary={selected.matchedUsage}/> Token · {amount(selected.matchedUsage)}<br/><small>{t('webui.context')}</small></div>}
     <dl className="facts thread-primary"><dt>{t('webui.agent')}</dt><dd>{selected.agentKind}</dd><dt>{t('webui.directory')}</dt><dd className="working-directory" title={selected.project??''}>{selected.project??t('webui.unassigned')}</dd><dt>{t('webui.historyModels')}</dt><dd>{selected.models.join(' / ')||t('webui.unknown')}</dd><dt>{t('webui.effort')}</dt><dd>{selected.reasoningEfforts.join(' / ')||t('webui.unknown')}</dd></dl>
     <details className="provenance"><summary>{t('webui.provenance')}</summary><dl className="facts"><dt>{t('webui.sourceInstance')}</dt><dd><code>{selected.sourceInstanceId}</code></dd><dt>{t('webui.directoryPath')}</dt><dd><code>{selected.project??t('webui.unknown')}</code></dd><dt>{t('webui.threadId')}</dt><dd><code>{selected.upstreamId??selected.id}</code></dd></dl><p className="note">{t('webui.scopeNote')}</p></details>
     <div className="task-actions"><button className="link" onClick={()=>navigate({returnTo:linkedReturn(route),page:'instructions',configThread:selected.id,snapshot:data.list.snapshotRef.snapshotId,configView:undefined,configId:undefined,configOffset:0,instructionSearch:undefined})}>{t('config.relatedConfig')}</button><button className="link" onClick={()=>usage({summary:selected.threadUsage,scope:{allTime:true,timezone:route.timezone,threadId:selected.id},snapshotId:data.list.snapshotRef.snapshotId})}>{t('webui.usageDetail')}</button></div>
     {!data.freshness?.initialScan&&<Composition summary={selected.threadUsage}/>}<CostComposition summary={selected.threadUsage}/><CostNote onBasis={()=>basis(selected.threadUsage)}/>
     <UsageInspection client={client} snapshotId={data.list.snapshotRef.snapshotId} route={route} navigate={navigate} refresh={refresh} threadId={selected.id}/>
     <SessionComparison choices={rows} key={selected.id} client={client} snapshotId={data.list.snapshotRef.snapshotId} threadId={selected.id} route={route} refresh={refresh} openThread={thread=>navigate({thread,snapshot:data.list.snapshotRef.snapshotId,turn:undefined,offset:0})}/>
     <Turns key={JSON.stringify([selected.id,scopeOf(route),route.turnSort,route.turnView])} client={client} snapshotId={data.list.snapshotRef.snapshotId} thread={selected.id} route={route} navigate={navigate} basis={basis} refresh={refresh}/>
    </>:empty}
   </section>
  </div>
 </>;
}
function SortOptions({time=false}:{time?:boolean}){return <><option value={time?'time':'recent'}>{time?t('webui.chronological'):t('webui.recent')}</option><option value="tokens">{t('webui.tokensFirst')}</option><option value="cost">{t('webui.costFirst')}</option></>;}
function Events({client,snapshotId,thread,turn,route,basis,refresh,navigate}:{navigate:(r:Partial<Route>)=>void;refresh:()=>void;client:UsageClient;snapshotId:string;thread:string;turn:string;route:Route;basis:(s:UsageSummary)=>void}){
 const offset=route.eventsOffset??0;
 const {result,error,errorCode,loading,retry,expired}=useUsageQuery(client,{action:'steps',snapshotId,threadId:thread,turnId:turn,scope:scopeOf(route),locateOperationId:route.operation,sort:'time',offset,limit:100});
 useEffect(()=>{if(!loading&&route.operation){const node=document.querySelector<HTMLElement>(`[data-operation="${CSS.escape(route.operation)}"]`);node?.scrollIntoView({block:'nearest'});}},[loading,result,route.operation]);
 return <div className="timeline" data-view-key="task-events" aria-busy={loading}>{loading&&<p role="status">{t('webui.loading')}</p>}{error&&<QueryError error={error} code={errorCode} retry={expired?refresh:retry}/>}{result?.items.map(event=>event.kind==='measurement'?<details className="event" data-view-key={event.id} key={event.id}><summary>{timestamp(event.timestamp,route.timezone,event.timePrecision)} · {event.model??t('webui.unknown')} · <SummaryToken summary={event.usage}/> Token · {amount(event.usage)} {event.matchesScope&&<span className="tag">{t('webui.matched')}</span>}</summary><div className="measurement-detail"><Composition summary={event.usage}/><p><code>{event.id}</code> · {event.reasoningEffort??t('webui.unknown')} · {event.timePrecision}</p><button className="link" onClick={()=>basis(event.usage)}>{t('webui.basis')}</button></div></details>:event.kind==='operation'?<div className={route.operation===event.id?"event evidence-selected":"event"} data-operation={event.id} data-view-key={event.id} key={event.id}>{timestamp(event.timestamp,route.timezone,event.timePrecision)} · {event.name}<small>{eventStatusLabel(event.status)} · {operationTypeLabel(event.operationType)}<br/>{t('webui.eventNote')}</small></div>:null)}{result&&<Pagination page={result.page} onPage={eventsOffset=>navigate({eventsOffset,operation:undefined})}/>}</div>;
}

function focusTurn(id:string){
 const node=document.querySelector<HTMLElement>(`[data-turn="${CSS.escape(id)}"]`);if(!node)return false;
 node.scrollIntoView({block:'start'});node.querySelector<HTMLElement>('summary')?.focus({preventScroll:true});return true;
}
function Turns({client,snapshotId,thread,route,navigate,basis,refresh}:{client:UsageClient;snapshotId:string;thread:string;route:Route;navigate:(r:Partial<Route>)=>void;basis:(s:UsageSummary)=>void;refresh:()=>void}){
 const offset=route.turnOffset;
 const group=useTiming(client,{action:'turns',snapshotId,threadId:thread,scope:scopeOf(route),sort:route.turnSort,matchedOnly:route.turnView==='matching',locateTurnId:route.turn==='closed'?undefined:route.turn,offset,limit:20},route.turn);
 const {usage:result,error,errorCode,loading,retry,expired}=group;
 const turns=result?.items.filter((i):i is Turn=>i.kind==='turn')??[];
 const located=useRef<string|undefined>(undefined);
 useEffect(()=>{if(!loading&&route.turn&&route.turn!=='closed'&&located.current!==route.turn){if(focusTurn(route.turn))located.current=route.turn;}},[loading,result,route.turn]);
 const selectedTurn=group.turnId??'closed';
 return <section className="task-turns">{loading&&<p role="status">{t('webui.loading')}</p>}{error&&<QueryError error={errorCode==='CANCELLED'?'CANCELLED':t('execution.readUnavailable')} code={errorCode} retry={expired?refresh:retry}/>}<div className="section-head"><h3>{t('webui.turns')}</h3><select aria-label={t('webui.turnView')} value={route.turnView} onChange={e=>navigate({turnView:e.target.value as Route['turnView'],turn:selectedTurn,turnOffset:0})}><option value="matching">{t('webui.matchingTurns')}</option><option value="all">{t('webui.allTurns')}</option></select><select aria-label={t('webui.turnSort')} value={route.turnSort} onChange={e=>navigate({turnSort:e.target.value as Route['turnSort'],turnOffset:0,turn:undefined})}><SortOptions time/><option value="recent">{t('webui.recent')}</option></select></div>{turns.map(turn=><details key={turn.id} className="turn" data-turn={turn.id} open={turn.id===selectedTurn}><summary onClick={e=>{e.preventDefault();navigate({turn:turn.id===selectedTurn?'closed':turn.id,turnOffset:result?.page.offset??offset});}}><strong>{turn.ordinal==null?t('webui.unassignedTurn'):t('webui.turn',{number:turn.ordinal})}</strong><Pair summary={turn.usage}/></summary>{turn.id===selectedTurn&&<div className="turn-body"><p className="subtle">{t('webui.matchingUsage')}: <Pair summary={turn.matchedUsage}/></p><Composition summary={turn.usage}/><CostComposition summary={turn.usage}/><p className="note">{t('webui.turnNote')}</p><TurnExecution key={JSON.stringify([turn.id,result?.snapshotRef.snapshotId])} client={client} summary={group.summary} loading={group.timingLoading||loading} unavailable={group.unavailable} errorCode={group.errorCode} expired={expired} snapshotId={result!.snapshotRef.snapshotId} threadId={thread} turnId={turn.id} timezone={route.timezone} refresh={refresh}/>{turn.ordinal!=null&&<UsageInspection client={client} snapshotId={result!.snapshotRef.snapshotId} route={route} navigate={navigate} refresh={refresh} threadId={thread} turnId={turn.id}/>}<details open={!!route.operation}><summary>{t('execution.usageRecords')}</summary><Events navigate={navigate} refresh={refresh} key={turn.id} client={client} snapshotId={result!.snapshotRef.snapshotId} thread={thread} turn={turn.id} route={route} basis={basis}/></details></div>}</details>)}{result&&<Pagination page={result.page} onPage={turnOffset=>navigate({turnOffset,turn:undefined})}/>}</section>;
}
