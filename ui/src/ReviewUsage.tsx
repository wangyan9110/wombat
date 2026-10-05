import { UseBasis } from './UseBasis.js';
import { useState } from 'react';
import type { ConfigResult, OptimizeSuggestion, UsageClient } from '@wombat/client';
import { t, relatedActivityText, eventStatusLabel, reviewFindingLabel } from '@wombat/client/locale';
import { Pagination, Token, amount, timestamp } from './components.js';
import { QueryError } from './Feedback.js';
import { configRequest, useConfig } from './useConfig.js';
import { relatedTurnRoute, type Route } from './state.js';

/** Reuses Rust's pinned, deduplicated evidence query; presentation never allocates costs. */
export function ReviewUsage({client,suggestion,readView,route,navigate,refresh}:{client:UsageClient;suggestion:OptimizeSuggestion;readView:string;route:Route;navigate:(r:Partial<Route>)=>void;refresh:()=>void}) {
 const [offset,setOffset]=useState(0);
 const q=useConfig(client,{...configRequest(route),action:'evidence',readView,snapshotId:undefined,itemId:suggestion.item.id,kind:undefined,observation:undefined,search:undefined,scope:{...configRequest(route).scope,threadId:undefined},offset,limit:20});
 return <section className="review-related"><div className="section-head"><h3>{t('optimize.relatedUsage')}</h3><small>{route.allTime?t('webui.allDates'):`${route.since} — ${route.until}`} · {route.timezone}</small></div>
 {q.loading&&<p role="status">{t('webui.loading')}</p>}{q.error&&<QueryError error={q.error} code={q.code} retry={q.code==='VIEW_EXPIRED'||q.code==='NOT_FOUND'?refresh:q.retry}/>}
 {q.data&&<RelatedUsageContent result={q.data} route={route} navigate={navigate} onPage={setOffset}/>}
 </section>;
}
export function RelatedUsageContent({result,route,navigate,onPage}:{result:ConfigResult;route:Route;navigate:(r:Partial<Route>)=>void;onPage:(n:number)=>void}) {
 const item=result.items[0],historyAvailable=['current','fixed','partial'].includes(result.coverage.historyStatus);
 const uses=item?.kind==='mcp'||item?.kind==='skill';
 const records=item?.useBasis&&item.useBasis.status!=='observed'?null:uses?item?.usageCount:item?.counts.fileReads;
 const rows=result.evidence;
 return <><dl className="review-metrics"><div><dt>{t(uses?'config.activity':'config.reads')}</dt><dd>{historyAvailable&&records!=null?t(uses?'config.usesCount':'config.fileReadsCount',{count:records}):'—'}</dd></div><div><dt>{t('optimize.relatedTokens')}</dt><dd><Token value={item?.usage?.tokens.total}/></dd></div><div><dt>{t(item?.usage?.price.status==='unknown'?'webui.amountUnknown':'optimize.relatedCost')}</dt><dd>{item?.usage&&item.usage.price.status!=='unknown'?amount(item.usage):'—'}</dd></div></dl><p className="note">{t('optimize.relatedSummary')}</p>
 {item&&item.kind!=='hook'&&<UseBasis basis={item.useBasis}/>}
 {!historyAvailable?<p className="read-notice">{t('optimize.historyUnavailable')}</p>:records===0?<p>{t('optimize.noAssociation')}</p>:null}
 {historyAvailable&&records==null&&<p className="note">{t('config.coverageNote')}</p>}
 {result.coverage.status==='partial'&&<p className="note">{t('optimize.historyIncomplete')}</p>}
 <details className="provenance"><summary>{relatedActivityText(historyAvailable?item?.relatedTurns??'—':'—',historyAvailable?result.page.total:'—')}</summary>{item&&historyAvailable&&<p className="note">{t('config.outcomes',{success:item.counts.succeeded,failed:item.counts.failed,unknown:item.counts.outcomeUnknown})}</p>}{rows.map(e=><article className="config-evidence" key={e.id}><strong>{e.title?.trim()||t('common.untitled_thread')}</strong><p>{timestamp(e.timestamp,route.timezone)} · {eventStatusLabel(e.outcome)}</p><details className="provenance"><summary>{t('webui.provenance')}</summary><p>{t('webui.threadId')}: <code>{e.threadId}</code></p>{e.turnId&&<p>{t('webui.turnId')}: <code>{e.turnId}</code></p>}</details>{e.turnId&&result.usageRevision?<button className="link" onClick={()=>navigate(relatedTurnRoute(route,result.usageRevision!,e.threadId,e.turnId!))}>{t('optimize.exactTurn')}</button>:<p className="note">{t('optimize.turnUnknown')}</p>}</article>)}<Pagination page={result.page} onPage={onPage}/></details>
 <details className="provenance"><summary>{t('optimize.relatedDetails')}</summary><p>{t('optimize.relatedNote')}</p>{item?.usage&&<p>{t('webui.costNote')}</p>}<p>{t('config.versionNote')}</p></details></>;
}
/** The core comparison identifies the original assessment; current item fields never establish comparability. */
export function textChanges(s:OptimizeSuggestion) {
 const rows:{label:string;before:number;after:number}[]=[];
 for(const check of s.checks) {
  if(check.comparison.status!=='comparable'||!check.comparison.baselineAssessmentId)continue;
  const original=s.reviewBaseline?.assessments.find(a=>a.assessmentId===check.comparison.baselineAssessmentId);
  const before=original?.basis.measurement,after=check.basis.measurement;
  if(before?.kind==='numeric'&&after.kind==='numeric'&&before.observed!=null&&after.observed!=null)
   rows.push({label:reviewFindingLabel(check.rule),before:before.observed,after:after.observed});
 }
 return rows;
}
export function TextChanges({suggestion}:{suggestion:OptimizeSuggestion}) {
 if(!suggestion.recheckRuleParameters&&suggestion.checks.every(c=>c.comparison.status==='not_requested'))return null;
 const rows=textChanges(suggestion);
 return <section className="review-related"><h3>{t('optimize.comparison')}</h3>{rows.length?<div className="report-table-wrap"><table className="project-table text-change-table"><thead><tr><th>{t('webui.type')}</th><th>{t('optimize.before')}</th><th>{t('optimize.after')}</th></tr></thead><tbody>{rows.map(r=><tr key={r.label}><td>{r.label}</td><td>{r.before.toLocaleString()}</td><td>{r.after.toLocaleString()}</td></tr>)}</tbody></table></div>:<p>{t('optimize.comparisonUnknown')}</p>}<p className="note">{t('optimize.comparisonNote')}</p></section>;
}
