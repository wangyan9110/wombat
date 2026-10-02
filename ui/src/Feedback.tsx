import type { UsageResult } from '@wombat/client';
import { t,storageFailureText } from '@wombat/client/locale';
import { Empty } from './components.js';
import { connectionExpired } from './session.js';

export function QueryError({error,code,retry,hasResult=true,previousResultAt}:{error:string;code?:string;retry:()=>void;hasResult?:boolean;previousResultAt?:string}) {
 const expired=connectionExpired(code);
 const changed=code==='VIEW_EXPIRED'||code==='NOT_FOUND';
 const message=code==='NOT_FOUND'?t('webui.notFoundHint'):changed?t('webui.viewExpiredHint'):storageFailureText(code)??error;
 return <div className="warning-box" role="alert"><h3>{expired?t('webui.sessionExpired'):error==='CANCELLED'?t(hasResult?'webui.cancelled':'webui.cancelledFirst'):t('webui.failed')}</h3>{expired?<p>{t('webui.sessionRecovery')}</p>:<>{error!=='CANCELLED'&&<p>{message}</p>}{previousResultAt&&<p>{t('webui.previousResult',{time:previousResultAt})}</p>}<button onClick={retry}>{t(changed?'config.refresh':'webui.retry')}</button></>}</div>;
}
export function emptyReason(result:UsageResult) {
 if(result.quality.status==='partial'||result.quality.sources.some(s=>s.status!=='complete'))return 'sourceIncomplete';
 return result.facets?.agents.length||result.facets?.discoveredThreadCount?'noMatch':'noLogs';
}
export function EmptyUsage({result,sources,clear,dates,filtered,tasks}:{result:UsageResult;sources:()=>void;clear:()=>void;dates:()=>void;filtered:boolean;tasks?:()=>void}) {
 const reason=emptyReason(result);
 return <Empty title={reason==='noMatch'?t('webui.noRecordsMatched'):t(`webui.${reason}`)} copy={reason==='noMatch'?t('webui.emptyHint'):t(`webui.${reason}Hint`)}><div className="actions">
 {filtered&&<button onClick={clear}>{t('webui.clearFilters')}</button>}
 {result.availableRange?.since&&result.availableRange?.until&&<button onClick={dates}>{t('webui.availableDates')}</button>}
 {tasks&&!!result.facets?.discoveredThreadCount&&<button onClick={tasks}>{t('webui.discoveredTasks')}</button>}
 <button onClick={sources}>{t('webui.sources')}</button></div></Empty>;
}
