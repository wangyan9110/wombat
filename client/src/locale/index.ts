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
const plurals = { zh: new Intl.PluralRules('zh-CN'), en: new Intl.PluralRules('en-US') };
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
    const params = args[0] as Record<string, string | number> | undefined;
    const language = this.snapshot.locale;
    const dictionary: Readonly<Record<string, string>> = dictionaries[language];
    // Full-sentence variants keep interpolation literal and unknown counts distinct.
    const variant = typeof params?.count === 'number' ? `${key}.${plurals[language].select(params.count)}` : key;
    const template = dictionary[variant] ?? dictionary[key] ?? en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => params && Object.hasOwn(params, name) ? String(params[name]) : match);
  };
}
/** One presentation session per CLI process; independent runtimes are available to other hosts. */
export const locale = new LocaleRuntime();
export const t = locale.t;
/** Two independent counts require independent agreement in the complete sentence. */
export function relatedActivityText(turns: number | string, count: number | string): string {
  return t(turns === 1 ? 'optimize.tasks.turnOne' : 'optimize.tasks', { turns, count });
}
/** Format calendar buckets without applying the host time zone to date-only evidence. */
export function monthLabel(value: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])(?:-\d{2})?$/.test(value)) return value;
  const language = locale.getSnapshot().locale;
  const date = new Date(`${value.slice(0, 7)}-01T00:00:00Z`);
  const month = language === 'zh' ? Number(value.slice(5, 7)) : new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(date);
  return t('date.month', { year: value.slice(0, 4), month });
}
/** Compact display only; callers retain exact bytes for sorting and evidence. */
export function bytesLabel(value: number | null | undefined): string {
  if (value == null) return '—';
  if (value > 0 && value < 10.24) return '<0.01 KiB';
  return new Intl.NumberFormat(locale.getSnapshot().locale === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 2 }).format(value / 1024) + ' KiB';
}
/** One finding supplies the headline and key metric; all findings remain in the detail. */
export function reviewPresentation(s: import('../generated/optimize-response.js').Suggestion) {
  const finding = ['descriptionStandard','skillFormat','declaredCopyDrift','exactInstructionBlocks','descriptionSize','bodyTokens','fileSize']
    .map(rule => s.findings.find(f => f.rule === rule)).find(Boolean);
  const name = s.item.name;
  switch (finding?.rule) {
    case 'descriptionStandard': case 'descriptionSize': return {title:t('optimize.descriptionTitle',{name}),value:t(finding.rule==='descriptionStandard'?'optimize.standardValue':'optimize.descriptionValue'),metric:finding.observed,label:t('config.descriptionCharacters')};
    case 'skillFormat': return {title:t('optimize.formatTitle',{name}),value:t('optimize.formatValue'),metric:finding.evidenceCodes.length || undefined,label:t('optimize.formatErrors')};
    case 'bodyTokens': return {title:t('optimize.bodyTitle',{name}),value:t('optimize.bodyValue'),metric:finding.observed,label:t('config.bodyTokens')};
    case 'declaredCopyDrift': return {title:t('optimize.copyTitle',{name}),value:t('optimize.copyValue'),metric:undefined,label:t('webui.unknown')};
    case 'exactInstructionBlocks': return {title:t('optimize.blocksTitle',{name}),value:t('optimize.blocksValue'),metric:finding.observed,label:t('optimize.blockPositions')};
    case 'fileSize': return {title:t('optimize.fileTitle',{name}),value:t('optimize.fileValue'),metric:finding.observed,label:t('config.size')+' · B'};
    default: return {title:t('optimize.genericTitle',{name}),value:t('optimize.genericValue'),metric:undefined,label:t('webui.unknown')};
  }
}
export function reviewFindingLabel(rule:string):string {
  switch(rule){case 'exactInstructionBlocks':return t('optimize.exactBlocks');case 'declaredCopyDrift':return t('optimize.copyDrift');case 'fileSize':return t('optimize.fileSize');case 'descriptionSize':return t('optimize.descriptionSize');case 'descriptionStandard':return t('optimize.descriptionStandard');case 'bodyTokens':return t('config.bodyTokens');case 'skillFormat':return t('optimize.skillFormat');default:return rule;}
}
export function reviewFindingNote(rule:string):string {
  switch(rule){case 'exactInstructionBlocks':return t('optimize.blocksValue');case 'declaredCopyDrift':return t('optimize.copyValue');case 'fileSize':return t('optimize.agentsReminder');case 'descriptionSize':return t('optimize.descriptionReminder');case 'descriptionStandard':return t('optimize.descriptionStandardNote');case 'bodyTokens':return t('config.bodyNote');default:return t('optimize.formatNote');}
}
/** Locale-sensitive labels in module-level maps remain live across switches. */
type PlainMessageKey = { [K in MessageKey]: Slots<(typeof zh)[K]> extends never ? K : never }[MessageKey];
export function labels<K extends string>(keys: Record<K, PlainMessageKey>): Record<K, string> {
  return Object.defineProperties({}, Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, {
    enumerable: true, get: () => dictionaries[locale.getSnapshot().locale][key as MessageKey],
  }]))) as Record<K, string>;
}

/** Translate known core and host progress signals; retain unknown diagnostics verbatim. */
export function progressText(stage: string): string {
  const key = (['progress.read_logs', 'progress.save_usage', 'progress.sync', 'progress.fetch_prices', 'progress.save_prices'] as const).find(key => zh[key] === stage);
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

export function eventStatusLabel(status: string): string {
  switch(status){case 'completed':case 'succeeded':return t('event.completed');case 'failed':return t('event.failed');case 'cancelled':case 'canceled':return t('event.cancelled');case 'unknown':return t('webui.unknown');default:return status;}
}
export function operationTypeLabel(kind: string): string {
  switch(kind){case 'skillRead':return t('event.skillRead');case 'mcp':return t('event.mcp');case 'tool':return t('event.tool');default:return kind;}
}

export function storageFailureText(code?:string):string|undefined {switch(code){case 'STORAGE_FULL':return t('webui.storageFull');case 'STORAGE_UNAVAILABLE':return t('webui.storageUnavailable');case 'INDEX_MIGRATION_FAILED':return t('webui.indexMigrationFailed');case 'INDEX_UNSUPPORTED_VERSION':return t('webui.indexUnsupported');case 'INDEX_UNAVAILABLE':return t('webui.indexUnavailable');default:return undefined;}}
