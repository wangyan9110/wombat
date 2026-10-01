import { useEffect, useRef, type ReactNode } from 'react';
import type { UsageSummary, UsageResult } from '@wombat/client';
import { t } from '@wombat/client/locale';
export const compact = (n: number | null | undefined) => n == null ? '—' : new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(n);
export const amount = (s: UsageSummary) => s.price.status === 'unknown' ? t('webui.amountUnknown') : '$'+Number(s.price.cost ?? s.price.knownCost).toFixed(4)+(s.price.status==='partial'?'*':'');
export const directoryName = (path?:string|null) => path ? path.split(/[\\/]/).filter(Boolean).at(-1) ?? path : t('webui.unassigned');
export const timestamp = (at:string|null|undefined,zone:string,precision?:string) => at && precision==='date' ? at.slice(0,10) : at ? new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(at))+' · '+zone : t('webui.undated');
export function Token({value,interactive=false}:{value?:number|null;interactive?:boolean}) { const full=value==null?t('webui.unknown'):value.toLocaleString('en-US')+' Token';return interactive ? <button className="token-value" title={full} aria-label={full} popoverTarget="token-popover" onClick={()=>{const el=document.getElementById('token-popover');if(el)el.textContent=t('webui.exact')+': '+full;}}>{compact(value)}</button>:<span className="token-number" title={full} aria-label={full}>{compact(value)}</span>; }
export function Pair({summary}:{summary:UsageSummary}) { return <span className="dual-values"><span><Token value={summary.tokens.total}/> <span className="unit">Token</span></span><small>{amount(summary)}</small></span>; }
export function Composition({summary:s}:{summary:UsageSummary}) {return <div className="token-composition"><div className="token-family"><div className="token-parent"><span><i className="input-key"/>{t('webui.input')}</span><Token value={s.inputTotal} interactive/></div><div className="token-child"><span>{t('webui.cacheRead')}</span><Token value={s.tokens.cacheRead} interactive/></div>{s.tokens.cacheCreate!==0&&<div className="token-child"><span>{t('webui.cacheCreate')}</span><Token value={s.tokens.cacheCreate} interactive/></div>}</div><div className="token-family"><div className="token-parent"><span><i className="output-key"/>{t('webui.output')}</span><Token value={s.tokens.output} interactive/></div><div className="token-child"><span>{t('webui.reasoning')}</span><Token value={s.tokens.reasoning} interactive/></div></div></div>;}
export function CostNote({onBasis}:{onBasis:()=>void}) {return <div className="cost-note"><span>{t('webui.costNote')}</span><button className="link" onClick={onBasis}>{t('webui.basis')}</button></div>;}
export function Heading({title,sub,children}:{title:string;sub?:string;children?:ReactNode}){return <div className="page-heading"><div><h1>{title}</h1>{sub&&<p className="subtle">{sub}</p>}</div>{children}</div>;}
export function Empty({title,copy,children}:{title:string;copy:string;children?:ReactNode}){return <section className="empty"><div className="empty-symbol" aria-hidden="true">◌</div><h2>{title}</h2><p>{copy}</p><div className="actions">{children}</div></section>;}
export function Pagination({page,onPage}:{page:UsageResult['page'];onPage:(offset:number)=>void}){if(page.total<=page.limit)return null;return <div className="pagination"><span>{t('webui.page',{current:Math.floor(page.offset/page.limit)+1,total:Math.ceil(page.total/page.limit),count:page.total})}</span><div className="controls"><button disabled={!page.offset} onClick={()=>onPage(Math.max(0,page.offset-page.limit))}>{t('webui.previous')}</button><button disabled={page.nextOffset==null} onClick={()=>onPage(page.nextOffset!)}>{t('webui.next')}</button></div></div>;}
export function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{const trigger=document.activeElement;ref.current?.showModal();return()=>{if(trigger instanceof HTMLElement&&trigger.isConnected)trigger.focus();};},[]);return <dialog aria-labelledby="dialog-title" ref={ref} onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><div id="dialog-body"><div className="dialog-head"><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label={t('webui.close')} onClick={onClose}>✕</button></div>{children}</div></dialog>;}
export function Basis({summary:s,onPrices}:{summary:UsageSummary;onPrices:()=>void}) {
 return <>
  <p>{t('webui.costNote')}</p>
  <p><Token value={s.tokens.total}/> Token · {amount(s)}</p>
  <dl className="facts"><dt>{t('webui.revision')}</dt><dd>{s.price.priceRevision}</dd></dl>
  {s.price.components.map((c,i)=><p key={i}>
   {c.category}: {compact(c.tokens)} Token {c.ratePerMillion!=null?'× $'+c.ratePerMillion+' / 1M = ':'· '}
   {c.cost==null?(c.status==='unknown'?t('webui.amountUnknown'):'$'+c.knownCost+'*'):'$'+c.cost}
  </p>)}
  {s.price.basis.map((b,i)=><div className="source-card" key={i}>
   <strong>{b.originalModel}</strong><p>{b.pricingModel} · {b.condition} · {b.matchMethod}</p>
   <p>{b.priceRevision} · {b.verifiedAt}</p>
   {safeURL(b.source)&&<a href={b.source} target="_blank" rel="noreferrer">{t('webui.official')}</a>}
  </div>)}
  {s.price.issues.length>0&&<p>{s.price.issues.join(' · ')}</p>}
  <button onClick={onPrices}>{t('webui.prices')}</button>
 </>;
}
export function safeURL(url:string){try{return new URL(url).protocol==='https:';}catch{return false;}}
