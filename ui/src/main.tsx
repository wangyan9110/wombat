import { createRoot } from 'react-dom/client';
import { createHttpClient } from '@wombat/client/http';
import { locale, resolveLocale, t } from '@wombat/client/locale';
import { App } from './App.js';
import './style.css';

const fragment = new URLSearchParams(location.hash.slice(1));
const token = fragment.get('token') ?? sessionStorage.getItem('wombat-token');
const language = fragment.get('lang');
locale.setLocale(resolveLocale({ explicit: language === 'zh' || language === 'en' ? language : undefined, languages: navigator.languages }));
if (fragment.has('token')) {
  sessionStorage.setItem('wombat-token', token ?? '');
  history.replaceState(null, '', location.pathname + location.search);
}
function Locked() { return <main><h1>Wombat</h1><h1>{t('web.locked')}</h1><p>{t('web.lockedHint')}</p></main>; }
createRoot(document.getElementById('root')!).render(token
  ? <App client={createHttpClient({ origin: location.origin, token })}/>
  : <Locked/>);
