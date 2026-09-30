import { CoreError } from '@wombat/client';
import { locale, resolveLocale, type Locale } from '@wombat/client/locale';

/** Consume presentation options before either usage or pricing argument parsing. */
export function parseLanguageArgs(argv: readonly string[], environment: NodeJS.ProcessEnv = process.env): { argv: string[]; locale: Locale } {
  const rest: string[] = [];
  let explicit: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--lang' || arg.startsWith('--lang=')) {
      if (explicit !== undefined) throw new CoreError('INVALID_ARGUMENT', '--lang cannot be repeated');
      explicit = arg === '--lang' ? argv[++index] : arg.slice('--lang='.length);
      if (!explicit || explicit.startsWith('-')) throw new CoreError('INVALID_ARGUMENT', '--lang requires zh or en');
    } else rest.push(arg);
  }
  const system = environment.LC_ALL || environment.LC_MESSAGES || environment.LANG;
  try {
    return { argv: rest, locale: resolveLocale({ explicit, environment: environment.WOMBAT_LANG,
      languages: [system === 'C' || system === 'POSIX' || system?.startsWith('C.') ? 'en' : system ?? Intl.DateTimeFormat().resolvedOptions().locale] }) };
  } catch (error) { throw new CoreError('INVALID_ARGUMENT', error instanceof Error ? error.message : String(error)); }
}
export function configureLanguage(argv: string[]): string[] {
  const parsed = parseLanguageArgs(argv);
  locale.setLocale(parsed.locale);
  return parsed.argv;
}
