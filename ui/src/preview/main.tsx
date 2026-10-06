import {ExecutionPreview} from './execution.js';
import {createRoot} from 'react-dom/client';
import {useState,useSyncExternalStore} from 'react';
import {locale,t} from '@wombat/client/locale';
import {App} from '../App.js';
import {createPreviewClient,scenarios,scenarioFromQuery,type Scenario} from './fixtures.js';
import '../style.css';
// This separate Vite entry is development-only; the production entry never imports fixtures.
if (!import.meta.env.DEV) throw new Error('Preview requires the development server');
locale.setLocale(new URLSearchParams(location.search).get('lang')==='en'?'en':'zh');
const initialScenario=scenarioFromQuery(new URLSearchParams(location.search).get('scenario'));
let module=new URLSearchParams(location.search).get('previewModule')??'application';
const app=createRoot(document.getElementById('root')!);
function show(scenario:Scenario){app.render(module==='execution'?<ExecutionPreview key={scenario} scenario={scenario}/>:<App key={scenario} client={createPreviewClient(scenario)}/>);}
function Controls(){useSyncExternalStore(locale.subscribe,locale.getSnapshot);const [scenario,setScenario]=useState<Scenario>(initialScenario);return <aside aria-label={t('preview.title')} style={{padding:12,borderBottom:'1px solid #ddd'}}><strong>{t('preview.title')}</strong>{' '}<select aria-label={t('preview.scenario')} value={scenario} onChange={e=>{const next=e.target.value as Scenario;setScenario(next);show(next);}}>{scenarios.map(value=><option key={value} value={value}>{t(`preview.${value}`)}</option>)}</select>{' '}<select aria-label={t('preview.title')} defaultValue={module} onChange={event=>{module=event.target.value;show(scenario);}}><option value="application">{t('preview.application')}</option><option value="execution">{t('preview.execution')}</option></select></aside>;}
createRoot(document.getElementById('preview-controls')!).render(<Controls/>);
show(initialScenario);
