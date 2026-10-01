import { resolveLocale, type Locale } from '@wombat/client/locale';

export function connectionExpired(code?: string) { return code === 'HTTP_401' || code === 'HTTP_403'; }
type LanguageStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function saveLanguage(storage: LanguageStorage, language: Locale) {
  try { storage.setItem('wombat-language', language); } catch { /* Restricted storage still allows this page to work. */ }
}
export function sessionLanguage(explicit: string | null, storage: LanguageStorage, languages: readonly string[]): Locale {
  let saved: string | null = null;
  try { saved = storage.getItem('wombat-language'); } catch { /* Fall back to browser preferences. */ }
  const valid = (value: string | null) => value === 'zh' || value === 'en' ? value : undefined;
  const language = resolveLocale({ explicit: valid(explicit) ?? valid(saved), languages });
  saveLanguage(storage, language);
  return language;
}
