import {useEffect,useState} from 'react';
import type {UsageClient,UsageResult,UsageRequest} from '@wombat/client';
import {t,numberLabel} from '@wombat/client/locale';
import {Pagination} from './components.js';
import {QueryError} from './Feedback.js';
import {scopeOf,shiftDate,type Route} from './state.js';
import {useUsageQuery} from './useUsageQuery.js';
export function UsageStatistics(props:{client:UsageClient;snapshotId:string;route:Route;refresh:()=>void;threadId?:string}) {
 const [open,setOpen]=useState(false);
 return <details className="panel" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>{t('statistics.title')}</summary>{open&&<StatisticsTable {...props}/>}</details>;
}
export function Population({population:p}:{population:NonNullable<UsageResult['statistics']>['population']}) {
 return <><p>{t('statistics.population',{complete:p.completeTasks,total:p.measuredTasks})}</p><p>{t('statistics.mean')}: {numberLabel(p.meanTokens)} · {t('statistics.median')}: {numberLabel(p.medianTokens)} · {t('statistics.p90')}: {numberLabel(p.p90Tokens)} Token</p></>;
}
function StatisticsTable({client,snapshotId,route,refresh,threadId}:{client:UsageClient;snapshotId:string;route:Route;refresh:()=>void;threadId?:string}) {
 const [dimension,setDimension]=useState<'projects'|'models'>('projects'),[offset,setOffset]=useState(0);
 const selectedScope=scopeOf(route),scope=threadId?{...selectedScope,threadId:undefined}:selectedScope;
 const comparison:UsageRequest['comparison']=scope.since&&scope.until ? {kind:'periods',baselineSince:shiftDate(scope.since,-Math.round((Date.parse(scope.until)-Date.parse(scope.since))/86400000)),baselineUntil:scope.since,dimension:'thread'}:undefined;
 const q=useUsageQuery(client,{action:'statistics',snapshotId,threadId,scope,presentation:dimension,comparison,offset,limit:12,compact:true});
 useEffect(()=>{if(q.expired)refresh();},[q.expired,refresh]);
 const stats=q.result?.statistics;
 return <>{q.loading&&<p role="status">{t('webui.loading')}</p>}{q.error&&<QueryError error={q.error} code={q.errorCode} retry={q.expired?refresh:q.retry}/>}<select aria-label={t('webui.dimension')} value={dimension} onChange={e=>{setDimension(e.target.value as typeof dimension);setOffset(0);}}><option value="projects">{t('webui.projects')}</option><option value="models">{t('webui.models')}</option></select>{stats&&<><Population population={stats.population}/>{stats.selectedTask&&<p>{t('statistics.selected',{rank:stats.selectedTask.percentileRank==null?'—':(stats.selectedTask.percentileRank*100).toFixed(1),tokens:numberLabel(stats.selectedTask.tokens)})}</p>}{stats.growth&&<><Population population={stats.growth.baseline}/><p>{t('statistics.growth',{count:stats.growth.taskCountDelta,mean:numberLabel(stats.growth.meanTokensDelta)})}</p><p>{t('statistics.contributions',{count:numberLabel(stats.growth.taskCountContribution),intensity:numberLabel(stats.growth.perTaskContribution)})}</p></>}<div className="report-table-wrap"><table className="project-table"><thead><tr><th>{t('webui.dimension')}</th><th>{t('webui.threads')}</th><th>{t('statistics.mean')}</th><th>{t('statistics.median')}</th><th>{t('statistics.p90')}</th></tr></thead><tbody>{stats.groups.map(g=><tr key={g.key??'unknown'}><td>{g.key??t('webui.unknown')}</td><td>{g.population.measuredTasks}</td><td>{numberLabel(g.population.meanTokens)}</td><td>{numberLabel(g.population.medianTokens)}</td><td>{numberLabel(g.population.p90Tokens)}</td></tr>)}</tbody></table></div><Pagination page={q.result!.page} onPage={setOffset}/></>}<p className="note">{t('statistics.note')}</p></>;
}
