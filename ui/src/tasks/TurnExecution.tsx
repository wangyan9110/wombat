import {ActivityInspection} from './ActivityInspection.js';
import {useCallback,useEffect,useRef,useState} from 'react';
import {CoreError,type UsageClient,type TimingLocalResult,type TimingShareResult,type TimingResult} from '@wombat/client';
import {t} from '@wombat/client/locale';
import {Execution} from './Execution.js';
import {QueryError} from '../Feedback.js';
import {timestamp} from '../components.js';
import {TurnUses} from './Uses.js';

const phaseLabel=(phase?:string|null)=>{
 switch(phase){case 'started':return t('execution.started');case 'completed':return t('execution.completed');case 'failed':return t('execution.failed');case 'cancelled':return t('execution.cancelled');case 'running':return t('execution.running');default:return undefined;}
};
type Evidence=Extract<TimingResult,{action:'evidence';collection:'turn_events'}>;
type CopyStatus='execution.copied'|'execution.copyFailed';
export class TimingDetailReader {
 private aborts=new Map<string,AbortController>(); expired=false;
 constructor(private client:UsageClient,private snapshotId:string,private threadId:string,private turnId:string){}
 stop=()=>{for(const abort of this.aborts.values())abort.abort();this.aborts.clear();};
 private async read(kind:'evidence'|'share',cursor?:{token:string},limit=200){
  if(this.expired)throw new CoreError('VIEW_EXPIRED','Refresh the whole turn group');
  if(!this.client.timing)throw new CoreError('CORE_UNAVAILABLE','Timing unavailable');
  this.aborts.get(kind)?.abort();const abort=new AbortController();this.aborts.set(kind,abort);
  try {
   const common={snapshotId:this.snapshotId,threadId:this.threadId,turnId:this.turnId};
   const result=await this.client.timing(kind==='share'?{...common,action:'summary',privacyProfile:'share-v1',mode:'cached'}:{...common,action:'evidence',privacyProfile:'local',cursor,limit},{signal:abort.signal});
   if(abort.signal.aborted)throw new CoreError('CANCELLED','Cancelled');
   if(kind==='share'&&(result.action!=='summary'||result.profile!=='share-v1')||kind==='evidence'&&(result.action!=='evidence'||result.collection!=='turn_events'||result.snapshotId!==this.snapshotId||result.scope.threadId!==this.threadId||result.scope.turnId!==this.turnId))throw new CoreError('PROTOCOL_ERROR','Timing detail read identity mismatch');
   return result;
  }catch(error){if(error instanceof CoreError&&error.code==='VIEW_EXPIRED')this.expired=true;throw error;}
 }
 evidence=(cursor?:{token:string},limit=200)=>this.read('evidence',cursor,limit) as Promise<Evidence>;
 share=()=>this.read('share') as Promise<TimingShareResult>;
}
type LocatedPages=Array<TimingLocalResult['evidence']['intervalPages']['entries'][number]['pages'][number]|TimingLocalResult['evidence']['repeatPages']['entries'][number]['later']['pages'][number]>;
export function timingEvidenceLocations(summary:TimingLocalResult) {
 const proofs=summary.evidence.repeatPages.entries.flatMap(entry=>[entry.later,...(entry.afterFailure?[entry.afterFailure]:[]),...entry.successfulReads]);
 return [...summary.evidence.intervalPages.entries,...proofs.map(proof=>({intervalAlias:proof.operationAlias,pages:proof.pages}))];
}
/** Selection and transport generation are one boundary, including unlocatable selections. */
export class TimingDetailSelection {
 private revision=0;
 constructor(private reader:TimingDetailReader){}
 invalidate=()=>{this.revision++;this.reader.stop();};
 expire=()=>{this.reader.expired=true;this.invalidate();};
 select(alias:string|undefined,entries:ReadonlyArray<{intervalAlias:string;pages:LocatedPages}>):LocatedPages|undefined {
  this.invalidate();
  return alias?(entries.find(entry=>entry.intervalAlias===alias)?.pages??[]):undefined;
 }
 async read(kind:'evidence'|'share',cursor?:{token:string},limit=200){
  this.invalidate();const revision=this.revision;
  try{const result=kind==='share'?await this.reader.share():await this.reader.evidence(cursor,limit);return {superseded:revision!==this.revision,result};}
  catch(error){return {superseded:revision!==this.revision,error};}
 }
}
function evidenceTime(value:number|null|undefined,timezone:string){
 if(value==null)return t('execution.missing');
 const date=new Date(value);return Number.isNaN(date.getTime())?t('execution.missing'):timestamp(date.toISOString(),timezone,'millisecond');
}
export function TimingEvidenceRecord({row,selected,timezone}:{row:Evidence['rows'][number];selected:boolean;timezone:string}){
 const details=[row.recordKind,row.phase,row.timestampMs==null?t('execution.missing'):`${row.timestampMs} ms`].filter(Boolean).join(' · ');
 return <div className={selected?'evidence-selected':''}><p>{[t('execution.record'),phaseLabel(row.phase),evidenceTime(row.timestampMs,timezone)].filter(Boolean).join(' · ')}</p>{row.durationMs!=null&&<p>{t('execution.nativeDuration')} · {row.durationMs} ms</p>}{row.firstTokenMs!=null&&<p>{t('execution.nativeTtft')} · {row.firstTokenMs} ms</p>}{row.gapCodes.length>0&&<p>{t('execution.recordGaps')}</p>}<details><summary>{t('execution.technical')}</summary><code>{row.reference}</code><p>{details}</p><p>{row.gapCodes.join(', ')}</p></details></div>;
}
export function TurnExecution({client,summary,loading=false,unavailable=false,errorCode,expired=false,snapshotId,threadId,turnId,refresh,timezone='UTC'}:{client:UsageClient;summary?:TimingLocalResult;loading?:boolean;unavailable?:boolean;errorCode?:string;expired?:boolean;snapshotId:string;threadId:string;turnId:string;refresh:()=>void;timezone?:string}){
 const [evidence,setEvidence]=useState<Evidence>(),[refs,setRefs]=useState<string[]>(),[share,setShare]=useState<TimingShareResult>(),[busy,setBusy]=useState(false),[error,setError]=useState<string>(),[detailExpired,setDetailExpired]=useState(false),[copy,setCopy]=useState<CopyStatus>();
 const selection=useRef<TimingDetailSelection|null>(null),epoch=useRef(0),opener=useRef<HTMLElement|null>(null),dialog=useRef<HTMLDialogElement|null>(null),detail=useRef<HTMLElement|null>(null);
 useEffect(()=>{if(refs){detail.current?.focus();detail.current?.scrollIntoView({block:'nearest'});}},[refs]);
 const lastRead=useRef<{kind:'evidence'|'share';cursor?:{token:string};limit:number}|undefined>(undefined);
 const [navigation,setNavigation]=useState<{cursor?:{token:string}|null;limit:number;evidenceRefs:string[]}[]>();
 useEffect(()=>{const current=new TimingDetailReader(client,snapshotId,threadId,turnId);const coordinator=new TimingDetailSelection(current);selection.current=coordinator;epoch.current++;setEvidence(undefined);setRefs(undefined);setShare(undefined);setError(undefined);setDetailExpired(false);setBusy(false);setNavigation(undefined);setCopy(undefined);lastRead.current=undefined;opener.current=null;if(expired)coordinator.expire();return()=>{epoch.current++;coordinator.invalidate();};},[client,summary,snapshotId,threadId,turnId]);
 useEffect(()=>{if(share&&!dialog.current?.open)dialog.current?.showModal();else if(!share&&dialog.current?.open)dialog.current.close();},[share]);
 const blocked=expired||detailExpired;
 const expire=useCallback(()=>{epoch.current++;selection.current?.expire();setBusy(false);setDetailExpired(true);},[]);
 useEffect(()=>{if(blocked){epoch.current++;selection.current?.expire();setBusy(false);}},[blocked]);
 const read=async(kind:'evidence'|'share',cursor?:{token:string},limit=200)=>{
  if(blocked||!selection.current)return;
  lastRead.current={kind,cursor,limit};const identity=epoch.current;setBusy(true);setError(undefined);
  const outcome=await selection.current.read(kind,cursor,limit);
  if(epoch.current!==identity||outcome.superseded)return;
  if(outcome.result){if(kind==='share'&&outcome.result.action==='summary'&&outcome.result.profile==='share-v1'){setShare(outcome.result);setCopy(undefined);}else if(outcome.result.action==='evidence'&&outcome.result.collection==='turn_events')setEvidence(outcome.result);}
  if(outcome.error){const code=outcome.error instanceof CoreError?outcome.error.code:'INTERNAL_ERROR';if(code!=='CANCELLED'){setError(code);if(code==='VIEW_EXPIRED')expire();}}
  setBusy(false);
 };
 const inspect=(references:string[],intervalAlias?:string)=>{
  opener.current=document.activeElement as HTMLElement;setBusy(false);setError(undefined);lastRead.current=undefined;setRefs(references);setEvidence(undefined);
  // The core owns exact event-page locations; collection refs are shown as collection basis.
  const pages=selection.current?.select(intervalAlias,summary?timingEvidenceLocations(summary):[]);
  setNavigation(pages);if(intervalAlias&&!pages?.length){setNavigation([]);setError(undefined);lastRead.current=undefined;return;}void read('evidence',pages?.[0]?.cursor??undefined,pages?.[0]?.limit??200);
 };
 const close=()=>{selection.current?.invalidate();setBusy(false);setRefs(undefined);setEvidence(undefined);if(opener.current?.isConnected&&!opener.current.matches(':disabled'))opener.current.focus();};
 if(!summary)return <section className="execution" aria-label={t('execution.title')}><h3>{t('execution.title')}</h3><p role="status">{t(loading?'webui.loading':errorCode?'execution.readUnavailable':unavailable?'execution.unsupported':'execution.missing')}</p>{errorCode&&<QueryError error={errorCode==='CANCELLED'?'CANCELLED':t('execution.readUnavailable')} code={errorCode} retry={refresh} hasResult={false}/>}</section>;
 return <>{errorCode&&<QueryError error={errorCode==='CANCELLED'?'CANCELLED':t('execution.readUnavailable')} code={errorCode} retry={refresh} previousResultAt={summary.freshness.checkedAt??undefined}/>}<Execution summary={summary} refresh={refresh} onEvidence={inspect} onShare={()=>{opener.current=document.activeElement as HTMLElement;void read('share');}} updating={loading} blocked={blocked}/>
 <ActivityInspection key={JSON.stringify(['activity',summary.readView.snapshotId,summary.scope.sourceInstanceId,summary.scope.threadId,summary.scope.turnId,summary.methodVersion])} client={client} summary={summary} onEvidence={inspect} blocked={blocked} onExpired={expire}/>
 <TurnUses key={JSON.stringify(['uses',summary.readView.snapshotId,summary.scope.sourceInstanceId,summary.scope.threadId,summary.scope.turnId,summary.methodVersion])} client={client} summary={summary} blocked={blocked} refresh={refresh} onExpired={expire} timezone={timezone}/>
 {busy&&<p role="status">{t('webui.loading')}</p>}{error&&<QueryError error={error==='CANCELLED'?'CANCELLED':t('execution.readUnavailable')} code={error} retry={blocked?refresh:()=>{const request=lastRead.current;if(request)void read(request.kind,request.cursor,request.limit);}}/>}
 {refs&&<aside ref={detail} tabIndex={-1} className="execution-evidence" aria-label={t('execution.evidence')}><h3>{t('execution.evidence')}</h3><p>{t(navigation?'execution.selectedRecords':'execution.wholeTurn')}</p><details><summary>{t('execution.technical')}</summary><p>{refs.join(', ')||t('execution.missing')}</p></details>{navigation?.length===0&&<p>{t('execution.navigationUnavailable')}</p>}{summary.evidence.collections.filter(collection=>refs.includes(collection.reference)).map(collection=><details key={collection.reference}><summary>{t('execution.collectionBasis')}</summary><p>{collection.kind} · {collection.count.value??t('execution.missing')} · {collection.method}</p></details>)}{navigation&&navigation.length>1&&navigation.map((page,index)=><button key={index} disabled={busy||blocked} onClick={()=>{void read('evidence',page.cursor??undefined,page.limit);}}>{t('execution.evidencePage',{number:index+1})}</button>)}{evidence&&<><p>{t('execution.evidenceCount',{count:evidence.total.value??t('execution.missing')})}</p>{evidence.rows.filter(row=>!navigation||refs.includes(row.reference)).map(row=><TimingEvidenceRecord key={row.reference} row={row} selected={refs.includes(row.reference)} timezone={timezone}/>)}{!navigation&&evidence.nextCursor&&<button disabled={busy||blocked} onClick={()=>{void read('evidence',evidence.nextCursor!);}}>{t('execution.nextEvidence')}</button>}</>}<button className="link" onClick={close}>{t('execution.closeEvidence')}</button></aside>}
 <dialog ref={dialog} className="execution-share" onClose={()=>{setShare(undefined);if(opener.current?.isConnected&&!opener.current.matches(':disabled'))opener.current.focus();}}><h3>{t('execution.sharePreview')}</h3><p>{t('execution.shareNote')}</p>{share&&<><p>{t('execution.shareCutoff')}</p><pre>{JSON.stringify(share,null,2)}</pre></>}<button disabled={!share} onClick={()=>{if(share){const identity=epoch.current;void (async()=>{try{if(!navigator.clipboard)throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(JSON.stringify(share,null,2));if(epoch.current===identity)setCopy('execution.copied');}catch{if(epoch.current===identity)setCopy('execution.copyFailed');}})();}}}>{t('execution.copy')}</button><button onClick={()=>dialog.current?.close()}>{t('execution.close')}</button><p role="status">{copy?t(copy):''}</p></dialog>
 </>;
}
