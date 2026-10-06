import { useEffect,useState } from 'react';
import type { UsageClient,PricingResult } from '@wombat/client';
import { t } from '@wombat/client/locale';
import { QueryError } from './Feedback.js';
import { connectionExpired } from './session.js';
import { Heading } from './components.js';
import {PriceCatalog} from './prices/Catalog.js';
export function PricesView({client}:{client:UsageClient}){
 const [result,setResult]=useState<PricingResult>(),[loading,setLoading]=useState(true),[error,setError]=useState(''),[errorCode,setErrorCode]=useState<string>(),[action,setAction]=useState<'status'|'update'>('status'),[revision,setRevision]=useState(0),[tier,setTier]=useState('standard');
 useEffect(()=>{const abort=new AbortController();setLoading(true);setError('');void client.prices({action},{signal:abort.signal}).then(r=>{if(!abort.signal.aborted)setResult(r);}).catch(e=>{if(!abort.signal.aborted){setError(e.message);setErrorCode(e.code);}}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});return()=>abort.abort();},[client,action,revision]);
 return <><Heading title={t('webui.prices')} sub={result?`${result.catalog.revision} · ${result.catalog.verifiedAt}`:undefined}><select aria-label={t('webui.priceTier')} value={tier} onChange={e=>setTier(e.target.value)}>{(['standard','longContext'] as const).map(v=><option value={v} key={v}>{t(`webui.${v}`)}</option>)}</select></Heading><div className="cost-note"><span>{t('webui.priceDescription')}</span></div><p className="table-scroll-hint">{t('webui.scrollPrices')}</p>{loading&&<p role="status">{t('webui.loading')}</p>}{error&&<QueryError error={error} code={errorCode} retry={()=>setRevision(n=>n+1)}/>}{result&&<><PriceCatalog catalog={result.catalog} tier={tier}/><div className="section-head"><h2>{t('webui.priceSource')}</h2><button disabled={loading||connectionExpired(errorCode)} onClick={()=>{setAction('update');setRevision(n=>n+1);}}>{t('webui.priceUpdate')}</button></div><p className="subtle">{t('webui.catalogBoundary')}</p><p className="note">{result.origin} · {result.updated?t('webui.priceUpdated'):t('webui.priceCurrent')}</p></>}</>;
}
