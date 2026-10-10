import { createRoot } from 'react-dom/client';
import { createHttpClient } from '@wombat/client/http';
import { locale, t } from '@wombat/client/locale';
import { App } from './App.js';
import './style.css';
import { sessionLanguage, restoreLanguage } from './session.js';

const fragment = new URLSearchParams(location.hash.slice(1));
const token = fragment.get('token') ?? sessionStorage.getItem('wombat-token');
const language = fragment.get('lang');
if (fragment.has('token')) sessionStorage.setItem('wombat-token', token ?? '');
if (fragment.has('token') || fragment.has('lang')) {
  history.replaceState(null, '', location.pathname + location.search);
}
function Locked() {
  return (
    <main>
      <h1>Wombat</h1>
      <h1>{t('web.locked')}</h1>
      <p>{t('web.lockedHint')}</p>
    </main>
  );
}
const root = createRoot(document.getElementById('root')!);
const client = token ? createHttpClient({ origin: location.origin, token }) : undefined;
locale.setLocale(sessionLanguage(language, sessionStorage, navigator.languages));
root.render(client ? <App client={client} /> : <Locked />);
if (client && !language) void restoreLanguage(client, locale);
