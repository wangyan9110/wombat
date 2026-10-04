import {useEffect,useState} from 'react';
import type {UsageClient,DirectoriesResult} from '@wombat/client';
import {t} from '@wombat/client/locale';
import {QueryError} from './Feedback.js';

/** A browser path is never an authority. Confirmation consumes a host-issued choice. */
export function DirectoryAuthorization({client,onChanged}:{client:UsageClient;onChanged:()=>void}) {
  const [result,setResult]=useState<DirectoriesResult>(),[choice,setChoice]=useState<DirectoriesResult>(),[error,setError]=useState<Error&{code?:string}>(),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
  useEffect(()=>{const controller=new AbortController();void client.directories?.({action:'list'},{signal:controller.signal}).then(value=>{if(!controller.signal.aborted){setResult(value);setError(undefined);}},failure=>{if(!controller.signal.aborted)setError(failure);});return()=>controller.abort();},[client,refresh]);
  const run=async(request:Parameters<NonNullable<UsageClient['directories']>>[0])=>{
    setBusy(true);setError(undefined);
    try{const value=await client.directories!(request);if(request.action==='choose')setChoice(value);else{setResult(value);setChoice(undefined);onChanged();}}
    catch(failure){setError(failure as Error);}
    finally{setBusy(false);}
  };
  if(!client.directories)return null;
  return <section className="source-card"><h3>{t('directories.title')}</h3><p>{t('directories.note')}</p>
    <div className="actions"><button disabled={busy} onClick={()=>void run({action:'choose',purpose:'source'})}>{t('directories.chooseSource')}</button><button disabled={busy} onClick={()=>void run({action:'choose',purpose:'project'})}>{t('directories.chooseProject')}</button></div>
    {busy&&<p role="status">{t('directories.waiting')}</p>}
    {error&&<QueryError code={error.code} error={error.message} retry={()=>setRefresh(n=>n+1)}/>}
    {choice?.choiceToken&&<section><h4>{t('directories.preview')}</h4><code>{choice.chosenPath}</code><p>{t('directories.confirmNote')}</p><div className="actions"><button className="primary" disabled={busy} onClick={()=>void run({action:'confirm',choiceToken:choice.choiceToken!})}>{t('directories.confirm')}</button><button disabled={busy} onClick={()=>setChoice(undefined)}>{t('webui.cancel')}</button></div></section>}
    {result?.grants.map(grant=><section key={grant.id}><p><strong>{t(`directories.${grant.purpose}`)}</strong> · {t(grant.status==='authorized'?'directories.authorized':'directories.unavailable')}</p><code>{grant.path}</code><p><button disabled={busy} onClick={()=>void run({action:'revoke',grantId:grant.id})}>{t('directories.revoke')}</button></p></section>)}
    <p className="note">{t('directories.revokeNote')}</p>
  </section>;
}
