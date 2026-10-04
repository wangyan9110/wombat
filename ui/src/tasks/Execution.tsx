import {useRef,useState} from 'react';
import {t} from '@wombat/client/locale';
import './execution.css';
/** Presentation input, not a transport DTO. Metrics and evidence are supplied by the caller. */
export interface ExecutionView {
 observedWindow:boolean;
 status:'completed'|'running'|'unknown';
 duration:string|null;
 cutoff:string;
 windowLabel?:string;
 gaps?:{id:string;range:string;left:number;width:number}[];
 tracks:{id:string;label:string;range:string;left:number;width:number;evidence:string}[];
 distribution:string|null;
 uses:{id:string;name:string;count:number|null;records:{id:string;label:string}[]}[];
 shareText:string;
}
export function Execution({view,refresh}:{view:ExecutionView;refresh:()=>void}){
 const [selected,setSelected]=useState<string>(),[share,setShare]=useState(false),[copy,setCopy]=useState('');
 const opener=useRef<HTMLButtonElement|null>(null),dialog=useRef<HTMLDialogElement|null>(null);
 const evidence=view.tracks.find(track=>track.id===selected);
 const close=()=>{setSelected(undefined);opener.current?.focus();};
 return <section className={`execution ${view.observedWindow?'':'execution-no-window'}`} aria-label={t('execution.title')}>
  <div className="section-head"><h3>{t('execution.title')}</h3><button className="link" onClick={()=>{setSelected(undefined);refresh();}}>{t('execution.refresh')}</button></div>
  <div className="execution-summary"><div><span>{t('execution.duration')}</span><strong>{view.duration??t(view.status==='running'?'execution.running':'execution.missing')}</strong></div><p>{t(`execution.${view.status}`)}<br/><small>{t('execution.cutoff',{time:view.cutoff})}</small></p></div>
  {!view.duration&&<p className="note">{t('execution.timeGap')}</p>}
  {view.observedWindow&&view.windowLabel&&<p className="execution-axis">{t('execution.window',{range:view.windowLabel})}</p>}
  <div className="execution-tracks">{view.tracks.map(track=><div className="execution-track" key={track.id}><span>{track.label}</span><div><button aria-label={`${track.label} ${track.range}`} style={{left:`${track.left}%`,width:`${track.width}%`}} onClick={event=>{opener.current=event.currentTarget;setSelected(track.id);}}/></div></div>)}{view.gaps?.map(gap=><div className="execution-track" key={gap.id}><span>{t('execution.unclassified')}</span><div><span className="execution-gap" style={{left:`${gap.left}%`,width:`${gap.width}%`}} aria-label={gap.range}/></div></div>)}</div>
  <div className="execution-list">{view.tracks.map(track=><button className="link" key={track.id} onClick={event=>{opener.current=event.currentTarget;setSelected(track.id);}}>{track.range} · {track.label}</button>)}{view.gaps?.map(gap=><p key={gap.id}>{gap.range} · {t('execution.unclassified')}</p>)}</div>
  {view.distribution&&<details><summary>{t('execution.distribution')}</summary><p>{view.distribution}</p></details>}
  {evidence&&<aside className="execution-evidence"><strong>{t('execution.evidence')}</strong><p>{evidence.evidence}</p><button className="link" onClick={close}>{t('execution.closeEvidence')}</button></aside>}
  <h3>{t('execution.uses')}</h3>{view.uses.map(use=><details key={use.id}><summary><strong>{use.name}</strong><span>{use.count===null?t('execution.missing'):t('execution.count',{count:use.count})}</span></summary><p>{t('execution.definition')}</p>{use.records.map(record=><p key={record.id}>{record.label}</p>)}</details>)}
  <button onClick={()=>{setCopy('');setShare(true);dialog.current?.showModal();}}>{t('execution.share')}</button>
  <dialog ref={dialog} onClose={()=>setShare(false)}><h3>{t('execution.sharePreview')}</h3>{share&&<pre>{view.shareText}</pre>}<button onClick={()=>{void navigator.clipboard.writeText(view.shareText).then(()=>setCopy(t('execution.copied')),()=>setCopy(t('execution.copyFailed')));}}>{t('execution.copy')}</button><button onClick={()=>dialog.current?.close()}>{t('execution.close')}</button><p role="status">{copy}</p></dialog>
 </section>;
}
