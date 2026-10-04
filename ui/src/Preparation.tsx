import {useEffect,useState} from 'react';
import {t,progressText,storageFailureText} from '@wombat/client/locale';
import type {WorkspaceData} from './workspace.js';
import {timestamp} from './components.js';

export function Preparation({since,pending,progress,initial=false}:{since:number;pending:boolean;progress:string;initial?:boolean}){
 const [elapsed,setElapsed]=useState(0);
 useEffect(()=>{const tick=()=>setElapsed(Math.max(0,Math.floor((Date.now()-since)/1000)));tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer);},[since]);
 return <p className="read-notice" role="status">{initial?t('webui.readingHistory'):progress?progressText(progress):t(pending?'webui.preparing':'webui.loading')} · {t('webui.elapsed',{seconds:elapsed})}{elapsed>=10&&<> {t('webui.longPreparation')}</>}</p>;
}
export function FreshnessNotice({data}:{data:WorkspaceData}){
 const freshness=data.freshness;
 if(!freshness||!freshness.initialScan&&['fixed','current'].includes(freshness.status))return null;
 return <p className="read-notice" role="status">{t(freshness.status==='failed'?'webui.syncFailed':freshness.initialScan?'webui.initialTasks':freshness.status==='syncing'?'webui.syncing':'webui.sourceStale')} {data.overview.snapshotRef.createdAt&&t('webui.resultTime',{time:timestamp(data.overview.snapshotRef.createdAt,data.route.timezone)})}{freshness.error&&<> · {storageFailureText(freshness.errorCode??undefined)??freshness.error}</>}</p>;
}
