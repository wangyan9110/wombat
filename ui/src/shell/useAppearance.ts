import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { UsageClient } from '@wombat/client';
import { locale, t } from '@wombat/client/locale';
import type { Page } from '../state.js';
import { saveLanguage } from '../session.js';

/** Browser appearance and serialized preference writes share one presentation owner. */
export function useAppearance(client: UsageClient, page: Page) {
  const { locale: language } = useSyncExternalStore(locale.subscribe, locale.getSnapshot);
  const [dark, setDark] = useState(() => localStorage.getItem('wombat-theme') === 'dark');
  const [preferenceError, setPreferenceError] = useState(false);
  const preferenceQueue = useRef(Promise.resolve());
  const savePreference = (next: 'zh' | 'en') => {
    if (!client.preferences) return;
    preferenceQueue.current = preferenceQueue.current
      .catch(() => {})
      .then(async () => {
        try {
          await client.preferences!({ action: 'set', language: next });
          setPreferenceError(false);
        } catch {
          setPreferenceError(true);
        }
      });
  };
  const lastLanguage = useRef(language);
  useEffect(() => {
    if (lastLanguage.current !== language) {
      lastLanguage.current = language;
      savePreference(language);
    }
  }, [language]);
  useEffect(() => {
    saveLanguage(sessionStorage, language);
    document.documentElement.lang = language;
    document.title = `Wombat · ${t(`webui.${page}`)}`;
  }, [language, page]);
  useEffect(() => {
    document.body.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('wombat-theme', dark ? 'dark' : 'light');
  }, [dark]);
  return {
    language,
    dark,
    setDark,
    preferenceError,
    savePreference,
    changeLanguage: (next: 'zh' | 'en') => locale.setLocale(next),
  };
}
