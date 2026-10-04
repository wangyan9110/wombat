import { useState } from 'react';
import type { ConfigItem, ConfigResult, OptimizeSuggestion, UsageClient } from '@wombat/client';
import { t, relatedActivityText, eventStatusLabel } from '@wombat/client/locale';
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
 const records=item?.kind==='mcp'?item.usageCount:item?.counts.fileReads;
 const seen=new Set<string>(),rows=result.evidence.filter(e=>{const key=e.turnId?`${e.threadId}:${e.turnId}`:e.id;if(seen.has(key))return false;seen.add(key);return true;});
 return <><dl className="review-metrics"><div><dt>{t(item?.kind==='mcp'?'config.activity':'config.reads')}</dt><dd>{historyAvailable?!records?'—':t(item?.kind==='mcp'?'config.usesCount':'config.fileReadsCount',{count:records}):'—'}</dd></div><div><dt>{t('optimize.relatedTokens')}</dt><dd><Token value={item?.usage?.tokens.total}/></dd></div><div><dt>{t(item?.usage?.price.status==='unknown'?'webui.amountUnknown':'optimize.relatedCost')}</dt><dd>{item?.usage&&item.usage.price.status!=='unknown'?amount(item.usage):'—'}</dd></div></dl><p className="note">{t('optimize.relatedSummary')}</p>
 {!historyAvailable?<p className="read-notice">{t('optimize.historyUnavailable')}</p>:!records?<p>{t('optimize.noAssociation')}</p>:null}
 {result.coverage.status==='partial'&&<p className="note">{t('optimize.historyIncomplete')}</p>}
 <details className="provenance"><summary>{relatedActivityText(historyAvailable?item?.relatedTurns??'—':'—',historyAvailable?result.page.total:'—')}</summary>{item&&historyAvailable&&<p className="note">{t('config.outcomes',{success:item.counts.succeeded,failed:item.counts.failed,unknown:item.counts.outcomeUnknown})}</p>}{rows.map(e=><article className="config-evidence" key={e.id}><strong>{e.title?.trim()||t('common.untitled_thread')}</strong><p>{timestamp(e.timestamp,route.timezone)} · {eventStatusLabel(e.outcome)}</p><details className="provenance"><summary>{t('webui.provenance')}</summary><p>{t('webui.threadId')}: <code>{e.threadId}</code></p>{e.turnId&&<p>{t('webui.turnId')}: <code>{e.turnId}</code></p>}</details>{e.turnId&&result.usageRevision?<button className="link" onClick={()=>navigate(relatedTurnRoute(route,result.usageRevision!,e.threadId,e.turnId!))}>{t('optimize.exactTurn')}</button>:<p className="note">{t('optimize.turnUnknown')}</p>}</article>)}<Pagination page={result.page} onPage={onPage}/></details>
 <details className="provenance"><summary>{t('optimize.relatedDetails')}</summary><p>{t('optimize.relatedNote')}</p>{item?.usage&&<p>{t('webui.costNote')}</p>}<p>{t('config.versionNote')}</p></details></>;
}
function comparableTokens(before:ConfigItem,after:ConfigItem,body:boolean) {
 const a=body?before.bodyTokenEstimate:before.estimate,b=body?after.bodyTokenEstimate:after.estimate;
 if(before.measurementStatus!=='complete'||after.measurementStatus!=='complete'||(body&&(before.bodyEstimateStatus!=='estimated'||after.bodyEstimateStatus!=='estimated'))||!a||!b||a.method!==b.method||a.encoding!==b.encoding||a.payload!==b.payload||a.applicability!==b.applicability||a.tokenizerVersion!==b.tokenizerVersion||!a.contentHash||!b.contentHash) return;
 return [a.tokens,b.tokens] as const;
}
export function textChanges(s:OptimizeSuggestion) {
 const a=s.reviewBaseline?.item,b=s.item;
 if(!s.recheckRuleParameters||s.status==='recheckUnavailable'||!a||a.id!==b.id||a.stale||b.stale||!b.current||a.measurementStatus!=='complete'||b.measurementStatus!=='complete'||!a.contentHash||!b.contentHash)return [];
 const rows:{label:string;before:number;after:number}[]=[];
 if(a.bytes!=null&&b.bytes!=null)rows.push({label:t('config.size')+' · B',before:a.bytes,after:b.bytes});
 if(a.characters!=null&&b.characters!=null)rows.push({label:t('config.characters'),before:a.characters,after:b.characters});
 if(a.skillMetadata?.descriptionCharacters!=null&&b.skillMetadata?.descriptionCharacters!=null)rows.push({label:t('config.descriptionCharacters'),before:a.skillMetadata.descriptionCharacters,after:b.skillMetadata.descriptionCharacters});
 const tokens=comparableTokens(a,b,b.kind==='skill');if(tokens)rows.push({label:t(b.kind==='skill'?'config.bodyTokens':'config.content_tokens'),before:tokens[0],after:tokens[1]});
 return rows;
}
export function TextChanges({suggestion}:{suggestion:OptimizeSuggestion}) {
 if(!suggestion.recheckRuleParameters)return null;
 const rows=textChanges(suggestion);
 return <section className="review-related"><h3>{t('optimize.comparison')}</h3>{rows.length?<div className="report-table-wrap"><table className="project-table text-change-table"><thead><tr><th>{t('webui.type')}</th><th>{t('optimize.before')}</th><th>{t('optimize.after')}</th></tr></thead><tbody>{rows.map(r=><tr key={r.label}><td>{r.label}</td><td>{r.before.toLocaleString()}</td><td>{r.after.toLocaleString()}</td></tr>)}</tbody></table></div>:<p>{t('optimize.comparisonUnknown')}</p>}<p className="note">{t('optimize.comparisonNote')}</p></section>;
}
