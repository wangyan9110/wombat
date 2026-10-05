import { useEffect, useRef, useId, type ReactNode } from 'react';
import type { UsageSummary, UsageResult } from '@wombat/client';
import { t, pricingIssueText, tokenSummaryPresentation, type SummaryTokenField } from '@wombat/client/locale';
export const compact = (n: number | null | undefined) => n == null ? '—' : new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(n);
export const currency = (n:number, decimals=4) => n>0&&n<10**-decimals?'<$'+(10**-decimals).toFixed(decimals):'$'+n.toFixed(decimals);
export const amount = (s: UsageSummary, decimals=4) => s.measurementCount===0||s.price.status==='unknown'?t('webui.amountUnknown'):currency(Number(s.price.cost??s.price.knownCost),decimals)+(s.price.status==='partial'?'*':'');
export const directoryName = (path?:string|null) => path ? path.split(/[\\/]/).filter(Boolean).at(-1) ?? path : t('webui.unassigned');
export const timestamp = (at:string|null|undefined,zone:string,precision?:string) => at && precision==='date' ? at.slice(0,10) : at ? new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(at))+' · '+zone : t('webui.undated');
export function Token({value,interactive=false,estimated=false,description}:{value?:number|null;interactive?:boolean;estimated?:boolean;description?:string}) { const full=value==null?t('usage.tokenValueUnavailable'):estimated?t('config.referenceTokens',{value:value.toLocaleString('en-US')}):value.toLocaleString('en-US')+' Token';const accessible=description?`${full} · ${description}`:full;return interactive ? <button className="token-value" title={accessible} aria-label={accessible} popoverTarget="token-popover" onClick={()=>{const el=document.getElementById('token-popover');if(el)el.textContent=t('webui.exact')+': '+accessible;}}>{compact(value)}</button>:<span className="token-number" title={accessible} aria-label={accessible}>{estimated&&value!=null?'≈ ':''}{compact(value)}</span>; }
/** The core gives complete totals and field-level observed subtotals separately. */
export function SummaryToken({summary,field='total',interactive=false}:{summary:UsageSummary;field?:SummaryTokenField;interactive?:boolean}) {
 const value=tokenSummaryPresentation(summary,field);
 return <span className="summary-token"><Token value={value.value} interactive={interactive} description={value.state==='partial'?`${value.qualifier} · ${value.description}`:value.state==='unavailable'?value.description:undefined}/>{value.state==='partial'&&<small className="token-coverage">{value.qualifier} · {t('usage.tokenAnalysis.covered',{count:value.coverage.coveredRecords})}</small>}</span>;
}
export function Pair({summary,decimals=4}:{summary:UsageSummary;decimals?:number}) { return <span className="dual-values"><span><SummaryToken summary={summary}/> <span className="unit">Token</span></span><small>{amount(summary,decimals)}</small></span>; }
export function Composition({summary:s}:{summary:UsageSummary}) {if(s.measurementCount===0)return <p className="note">{t('webui.noMetering')}</p>;return <div className="token-composition"><div className="token-family"><div className="token-parent"><span><i className="input-key"/>{t('webui.input')}</span><SummaryToken summary={s} field="rawInput" interactive/></div><div className="token-child"><span>{t('webui.cacheRead')}</span><SummaryToken summary={s} field="cacheRead" interactive/></div>{s.tokens.cacheCreate!==0&&<div className="token-child"><span>{t('webui.cacheCreate')}</span><SummaryToken summary={s} field="cacheCreate" interactive/></div>}</div><div className="token-family"><div className="token-parent"><span><i className="output-key"/>{t('webui.output')}</span><SummaryToken summary={s} field="output" interactive/></div><div className="token-child"><span>{t('webui.reasoning')}</span><SummaryToken summary={s} field="reasoning" interactive/></div></div></div>;}
export function CostNote({onBasis}:{onBasis:()=>void}) {return <div className="cost-note"><span>{t('webui.costNote')}</span><button className="link" onClick={onBasis}>{t('webui.basis')}</button></div>;}
export function Heading({title,sub,children}:{title:string;sub?:string;children?:ReactNode}){return <div className="page-heading"><div><h1>{title}</h1>{sub&&<p className="subtle">{sub}</p>}</div>{children}</div>;}
export function Empty({title,copy,children}:{title:string;copy:string;children?:ReactNode}){return <section className="empty"><div className="empty-symbol" aria-hidden="true">◌</div><h2>{title}</h2><p>{copy}</p><div className="actions">{children}</div></section>;}
export function Pagination({page,onPage}:{page:UsageResult['page'];onPage:(offset:number)=>void}){if(page.total<=page.limit)return null;return <div className="pagination"><span>{t('webui.page',{current:Math.floor(page.offset/page.limit)+1,total:Math.ceil(page.total/page.limit),count:page.total})}</span><div className="controls"><button disabled={!page.offset} onClick={()=>onPage(Math.max(0,page.offset-page.limit))}>{t('webui.previous')}</button><button disabled={page.nextOffset==null} onClick={()=>onPage(page.nextOffset!)}>{t('webui.next')}</button></div></div>;}
export function Modal({title,onClose,children,drawer=false,restoreFocus}:{title:string;onClose:()=>void;children:ReactNode;drawer?:boolean;restoreFocus?:()=>void}) {
 const titleId=useId();
 const ref=useRef<HTMLDialogElement>(null),restoreRef=useRef(restoreFocus);restoreRef.current=restoreFocus;
 useEffect(()=>{
  const trigger=document.activeElement,wide=window.matchMedia('(min-width: 1440px)'),dialog=ref.current;
  const reserve=()=>document.body.classList.toggle('detail-reserved',!!document.querySelector('dialog[data-reserves-space="true"][open]'));
  const show=()=>{if(!dialog)return;dialog.close();dialog.dataset.reservesSpace=String(drawer&&wide.matches);if(drawer&&wide.matches)dialog.show();else dialog.showModal();reserve();};
  show();wide.addEventListener('change',show);
  return()=>{wide.removeEventListener('change',show);dialog?.close();reserve();if(trigger instanceof HTMLElement&&trigger.isConnected&&trigger!==document.body)trigger.focus();else restoreRef.current?.();};
 },[drawer]);
 return <dialog className={drawer?'usage-drawer':undefined} aria-labelledby={titleId} ref={ref} onCancel={e=>{e.stopPropagation();onClose();}} onKeyDown={e=>{if(e.key==='Escape'&&!e.defaultPrevented&&e.target instanceof Element&&e.target.closest('dialog')===e.currentTarget&&e.currentTarget.dataset.reservesSpace==='true'){e.preventDefault();e.stopPropagation();onClose();}}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><div className="dialog-body" data-view-scroll data-view-key={drawer?'drawer':'modal'}><div className="dialog-head"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label={t('webui.close')} onClick={onClose}>✕</button></div>{children}</div></dialog>;
}
export function Basis({summary:s,onPrices}:{summary:UsageSummary;onPrices:()=>void}) {
 return <>
  <p>{t('webui.costNote')}</p>
  <p><SummaryToken summary={s}/> Token · {amount(s)}</p>
  <p className="note">{tokenSummaryPresentation(s).description}</p>
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
  {s.price.issues.length>0&&<ul>{s.price.issues.map((issue,index)=><li key={index}>{pricingIssueText(issue)} <code>({issue})</code></li>)}</ul>}
  <button onClick={onPrices}>{t('webui.prices')}</button>
 </>;
}
export function safeURL(url:string){try{return new URL(url).protocol==='https:';}catch{return false;}}
