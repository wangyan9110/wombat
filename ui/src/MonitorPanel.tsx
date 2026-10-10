import {useEffect,useState} from 'react';
import type {UsageClient,MonitorRequest,MonitorResult} from '@wombat/client';
import {t} from '@wombat/client/locale';
import {scopeOf,type Route} from './state.js';
import {SummaryToken} from './components.js';
import {Population} from './UsageStatistics.js';
export function MonitorPanel(props:{client:UsageClient;route:Route}) {
 const [open,setOpen]=useState(false);
 if(!props.client.monitor)return null;
 return <details className="panel" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>{t('monitor.title')}</summary>{open&&<MonitorSettings {...props}/>}</details>;
}
function MonitorSettings({client,route}:{client:UsageClient;route:Route}) {
 const [result,setResult]=useState<MonitorResult>(),[error,setError]=useState<string>(),[busy,setBusy]=useState(false),[watch,setWatch]=useState(false);
 const [id,setId]=useState(''),[period,setPeriod]=useState<'day'|'week'|'month'>('week'),[tokens,setTokens]=useState(''),[review,setReview]=useState(true);
 const query=async(request:MonitorRequest,signal?:AbortSignal)=>{const r=await client.monitor!(request,{signal});const view=request.action==='list'?r:await client.monitor!({action:'list'},{signal});if(!signal?.aborted)setResult(view);return r;};
 useEffect(()=>{const abort=new AbortController();void query({action:'list'},abort.signal).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();},[client]);
 const check=async(signal?:AbortSignal)=>{
  const settings=await client.monitor!({action:'list'},{signal}),ids=settings.plans.filter(p=>p.enabled).map(p=>p.id);
  if(!ids.length)return;
  const live=await client.live?.({query:{action:'usage',scope:{allTime:true},compact:true,limit:1},mode:'fresh'},{signal});
  if(!live)throw new Error(t('monitor.unavailable'));
  await client.monitor!({action:'check',ids,snapshotId:live.result.snapshotRef.snapshotId},{signal});
  await query({action:'list'},signal);
 };
 useEffect(()=>{
  if(!watch)return;
  const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;
  const run=async()=>{try{await check(abort.signal);}catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'MONITOR_CHECK_FAILED');}finally{if(!abort.signal.aborted)timer=setTimeout(()=>void run(),60_000);}};
  void run();return()=>{abort.abort();clearTimeout(timer);};
 },[watch,client]);
 const run=async(work:()=>Promise<unknown>)=>{setBusy(true);setError(undefined);try{await work();}catch(e){setError(e instanceof Error?e.message:'MONITOR_CHECK_FAILED');}finally{setBusy(false);}};
 return <><p className="note">{t('monitor.note')}</p>{error&&<p role="alert">{error==='MONITOR_CHECK_FAILED'?t('monitor.checkFailed'):error}</p>}<form onSubmit={e=>{e.preventDefault();void run(async()=>{
  const amount=tokens.trim()?Number(tokens):null;if(amount!==null&&(!Number.isSafeInteger(amount)||amount<=0))throw new Error(t('monitor.invalid'));
  const selected=scopeOf(route);
  const {since:_since,until:_until,allTime:_all,undated:_undated,threadId:_thread,turnId:_turn,...scope}=selected;
  await query({action:'upsert',plan:{id,period,enabled:true,scope,tokenLimit:amount,warningRatio:0.8,review}});
 });}}><label>{t('monitor.id')} <input required maxLength={64} pattern={'[A-Za-z0-9_\\-]+'} value={id} onChange={e=>setId(e.target.value)}/></label> <label>{t('webui.period')} <select value={period} onChange={e=>setPeriod(e.target.value as typeof period)}>{(['day','week','month'] as const).map(p=><option value={p} key={p}>{t(`webui.${p}`)}</option>)}</select></label> <label>{t('monitor.tokens')} <input type="number" min="1" step="1" value={tokens} onChange={e=>setTokens(e.target.value)}/></label> <label><input type="checkbox" checked={review} onChange={e=>setReview(e.target.checked)}/>{t('monitor.review')}</label> <button disabled={busy||!tokens&&!review}>{t('monitor.save')}</button></form><p>{result?.plans.map(p=><span className="monitor-plan" key={p.id}>{p.id} · {p.tokenLimit??'—'} Token · {t(`webui.${p.period}`)} <button disabled={busy} onClick={()=>void run(()=>query({action:'upsert',plan:{...p,enabled:!p.enabled}}))}>{t(p.enabled?'monitor.pause':'monitor.resume')}</button> <button disabled={busy} onClick={()=>void run(()=>query({action:'remove',id:p.id}))}>{t('monitor.remove')}</button><small>{p.scope?.project??t('webui.all')} · {p.scope?.model??t('webui.allModels')} · {p.scope?.timezone??'UTC'}</small> </span>)}</p><button disabled={busy} onClick={()=>void run(()=>check())}>{t('monitor.check')}</button> <label><input type="checkbox" checked={watch} onChange={e=>setWatch(e.target.checked)}/>{t('monitor.watch')}</label>{result?.notifications.map(n=><article className="read-notice" key={n.id}><b>{n.planId} · {t(`monitor.${n.kind}`)}</b><p>{n.scope.since} — {n.scope.until} · <SummaryToken summary={n.summary}/> Token{n.partial?' · '+t('monitor.partial'):''}</p><Population population={n.statistics.population}/>{!n.acknowledged&&<button disabled={busy} onClick={()=>void run(async()=>{await query({action:'acknowledge',notificationId:n.id});await query({action:'list'});})}>{t('monitor.acknowledge')}</button>}</article>)}</>;
}
