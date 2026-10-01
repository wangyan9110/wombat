import type { UsageResult } from '@wombat/client';
import { t } from '@wombat/client/locale';
import { Empty } from './components.js';
import { connectionExpired } from './session.js';

export function QueryError({error,code,retry}:{error:string;code?:string;retry:()=>void}) {
 const expired=connectionExpired(code);
 return <div className="warning-box" role="alert"><h3>{expired?t('webui.sessionExpired'):error==='CANCELLED'?t('webui.cancelled'):t('webui.failed')}</h3>{expired?<p>{t('webui.sessionRecovery')}</p>:<>{error!=='CANCELLED'&&<p>{error}</p>}<button onClick={retry}>{t('webui.retry')}</button></>}</div>;
}
export function emptyReason(result:UsageResult) {
 if(result.quality.status==='partial'||result.quality.sources.some(s=>s.status!=='complete'))return 'sourceIncomplete';
 return result.facets?.agents.length?'noMatch':'noLogs';
}
export function EmptyUsage({result,sources,clear,dates,filtered}:{result:UsageResult;sources:()=>void;clear:()=>void;dates:()=>void;filtered:boolean}) {
 const reason=emptyReason(result);
 return <Empty title={reason==='noMatch'?t('webui.noRecordsMatched'):t(`webui.${reason}`)} copy={reason==='noMatch'?t('webui.emptyHint'):t(`webui.${reason}Hint`)}><div className="actions">
 {filtered&&<button onClick={clear}>{t('webui.clearFilters')}</button>}
 {result.availableRange?.since&&result.availableRange?.until&&<button onClick={dates}>{t('webui.availableDates')}</button>}
 <button onClick={sources}>{t('webui.sources')}</button></div></Empty>;
}
