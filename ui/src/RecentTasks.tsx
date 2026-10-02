import type { UsageClient } from '@wombat/client';
import { t } from '@wombat/client/locale';
import { Pair, directoryName, timestamp } from './components.js';
import { useUsageQuery } from './useUsageQuery.js';
import { QueryError } from './Feedback.js';
import { scopeOf, type Route } from './state.js';
export function RecentTasks({client,route,snapshotId,navigate}:{client:UsageClient;route:Route;snapshotId:string;navigate:(r:Partial<Route>)=>void}){
 const q=useUsageQuery(client,{action:'threads',snapshotId,scope:scopeOf(route),sort:route.project?'tokens':'recent',limit:5});
 return <section className="panel recent-tasks"><div className="panel-heading"><h2>{t(route.project?'webui.highUsageTasks':'webui.recentTasks')}</h2><button className="link" onClick={()=>navigate({page:'threads',snapshot:snapshotId,sort:route.project?'tokens':'recent',offset:0,thread:undefined,turn:undefined})}>{t('webui.threads')}</button></div>{q.loading&&<p role="status">{t('webui.loading')}</p>}{q.error&&<QueryError error={q.error} code={q.errorCode} retry={q.retry}/>} {q.result?.items.map(i=>i.kind==='thread'&&<button key={i.id} className="drawer-row" onClick={()=>navigate({page:'threads',snapshot:snapshotId,thread:i.id,turn:undefined,offset:0})}><span><strong>{i.title??i.upstreamId??i.id}</strong><small>{directoryName(i.project)} · {timestamp(i.matchedLastActivityAt,route.timezone)}</small></span><Pair summary={i.matchedUsage} decimals={2}/></button>)}</section>;
}
