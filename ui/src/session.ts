import { resolveLocale, type Locale } from '@wombat/client/locale';
import type { UsageClient } from '@wombat/client';
import type { LocaleRuntime } from '@wombat/client/locale';

/** A late preference cannot undo a language choice made while the shell loads. */
export async function restoreLanguage(client: UsageClient, runtime: LocaleRuntime) {
  if (!client.preferences) return;
  let changed = false;
  const unsubscribe = runtime.subscribe(() => {
    changed = true;
  });
  try {
    const saved = await client.preferences(
      { action: 'get' },
      { signal: AbortSignal.timeout(5000) },
    );
    if (!changed && saved.language) runtime.setLocale(saved.language);
  } catch {
    /* Keep the already visible fallback language. */
  } finally {
    unsubscribe();
  }
}

export function connectionExpired(code?: string) {
  return code === 'HTTP_401' || code === 'HTTP_403';
}
type LanguageStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function saveLanguage(storage: LanguageStorage, language: Locale) {
  try {
    storage.setItem('wombat-language', language);
  } catch {
    /* Restricted storage still allows this page to work. */
  }
}
export function sessionLanguage(
  explicit: string | null,
  storage: LanguageStorage,
  languages: readonly string[],
): Locale {
  let saved: string | null = null;
  try {
    saved = storage.getItem('wombat-language');
  } catch {
    /* Fall back to browser preferences. */
  }
  const valid = (value: string | null) => (value === 'zh' || value === 'en' ? value : undefined);
  const language = resolveLocale({ explicit: valid(explicit) ?? valid(saved), languages });
  saveLanguage(storage, language);
  return language;
}
