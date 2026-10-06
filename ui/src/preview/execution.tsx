import {useMemo,useState,useSyncExternalStore} from 'react';
import {locale,t} from '@wombat/client/locale';
import {createUsageClient,type UsageClient} from '@wombat/client';
import {TurnExecution} from '../tasks/TurnExecution.js';
import {useTiming} from '../useTiming.js';
import {usageFixture,type Scenario} from './fixtures.js';
import {previewTiming} from './timing.js';
import {previewActivity} from './activity.js';
export function createExecutionPreviewClient(scenario:Scenario):UsageClient {
 return createUsageClient({query:async request=>{
  const result=usageFixture(request,scenario);
  return {...result,snapshotRef:{...result.snapshotRef,snapshotId:request.snapshotId??'preview:1'}};
 },timing:previewTiming(scenario),optimize:previewActivity(scenario)});
}
export function ExecutionPreview({scenario}:{scenario:Scenario}){
 useSyncExternalStore(locale.subscribe,locale.getSnapshot,locale.getSnapshot);
 const [revision,setRevision]=useState(0);
 const client=useMemo(()=>createExecutionPreviewClient(scenario),[scenario]);
 const group=useTiming(client,{action:'turns',snapshotId:`preview:${revision+1}`,threadId:'preview-task',scope:{allTime:true,timezone:'UTC'}},'preview-turn');
 return <main style={{maxWidth:1000,margin:'auto',padding:24}}><p>{t('preview.title')}</p><TurnExecution key={group.usage?.snapshotRef.snapshotId} client={client} summary={group.summary} snapshotId={group.usage?.snapshotRef.snapshotId??`preview:${revision+1}`} threadId="preview-task" turnId="preview-turn" loading={group.loading||group.timingLoading} unavailable={group.unavailable} errorCode={group.errorCode} expired={group.expired} refresh={()=>setRevision(value=>value+1)}/></main>;
}
