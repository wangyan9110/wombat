/** Shared presentation-only locale service. Never localize protocol values or source content. */
import { zh } from './zh.js';
import { en } from './en.js';
export type Locale = 'zh' | 'en';
export type MessageKey = keyof typeof zh;
type Slots<S extends string> = S extends `${string}{${infer P}}${infer Rest}` ? P | Slots<Rest> : never;
type Arguments<K extends MessageKey> = [Slots<(typeof zh)[K]>] extends [never]
  ? [] : [params: Record<Slots<(typeof zh)[K]>, string | number>];
export type Translate = <K extends MessageKey>(key: K, ...args: Arguments<K>) => string;
const dictionaries = { zh, en };
export function matchLocale(value: string | undefined): Locale | undefined {
  const language = value?.trim().toLowerCase().split(/[-_.@]/)[0];
  return language === 'zh' || language === 'en' ? language : undefined;
}
/** Explicit CLI choice, environment choice, ordered system languages, then Chinese compatibility default. */
export function resolveLocale(options: { explicit?: string; environment?: string; languages?: readonly string[] } = {}): Locale {
  for (const value of [options.explicit, options.environment]) {
    if (value !== undefined) {
      const matched = matchLocale(value);
      if (!matched) throw new RangeError(`Unsupported language: ${value}; expected zh or en`);
      return matched;
    }
  }
  for (const value of options.languages ?? []) {
    const matched = matchLocale(value);
    if (matched) return matched;
  }
  return 'zh';
}
export class LocaleRuntime {
  private snapshot: Readonly<{ locale: Locale; revision: number }>;
  private listeners = new Set<() => void>();
  constructor(locale: Locale = 'zh') { this.snapshot = Object.freeze({ locale, revision: 0 }); }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  setLocale(locale: Locale): void {
    if (locale !== 'zh' && locale !== 'en') throw new RangeError(`Unsupported language: ${locale}`);
    if (locale === this.snapshot.locale) return;
    this.snapshot = Object.freeze({ locale, revision: this.snapshot.revision + 1 });
    // Complete notification even if one subscriber fails; report the first failure to the caller.
    let failure: unknown;
    for (const listener of [...this.listeners]) { try { listener(); } catch (error) { failure ??= error; } }
    if (failure !== undefined) throw failure;
  }
  /** Stable function identity; reads the active locale on every invocation. */
  t: Translate = (key, ...args) => {
    const template: string = dictionaries[this.snapshot.locale][key] ?? en[key] ?? key;
    const params = args[0] as Record<string, string | number> | undefined;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => params && Object.hasOwn(params, name) ? String(params[name]) : match);
  };
}
/** One presentation session per CLI process; independent runtimes are available to other hosts. */
export const locale = new LocaleRuntime();
export const t = locale.t;
/** Locale-sensitive labels in module-level maps remain live across switches. */
type PlainMessageKey = { [K in MessageKey]: Slots<(typeof zh)[K]> extends never ? K : never }[MessageKey];
export function labels<K extends string>(keys: Record<K, PlainMessageKey>): Record<K, string> {
  return Object.defineProperties({}, Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, {
    enumerable: true, get: () => dictionaries[locale.getSnapshot().locale][key as MessageKey],
  }]))) as Record<K, string>;
}

/** Translate known core and host progress signals; retain unknown diagnostics verbatim. */
export function progressText(stage: string): string {
  const key = (['tui.components.loading-model.read_codex_logs', 'tui.components.loading-model.save_usage', 'progress.sync', 'progress.fetch_prices', 'progress.save_prices'] as const).find(key => zh[key] === stage);
  return key ? t(key) : stage;
}

/** Automatic price checks describe download state separately from log freshness. */
export function automaticPriceText(result: import('../generated/usage-app.js').Response): string | undefined {
  const state = result.priceUpdate;
  if (!state) return undefined;
  if (state.status === 'checking') return t('prices.auto.checking');
  if (state.status === 'failed') return t('prices.auto.failed', { code: state.errorCode ?? 'PRICE_UPDATE_FAILED' });
  return result.summary.price.issues.includes('catalogPriceMissing') ? t('prices.auto.unresolved') : t('prices.auto.updated');
}
