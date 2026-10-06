import path from 'node:path';
import { CoreError, type QueryOptions, type TimingRequest, type TimingErrorOutput, type UsageClient } from '@wombat/client';
import { createNodeClient } from '@wombat/client/node';
import { t } from '@wombat/client/locale';
import { configureLanguage } from './locale.js';
import { renderTimingResult, timingExitCode } from './timing-format.js';

type Format = 'json' | 'text';
export type TimingInvocation = { help: true; format: Format } | { help: false; format: Format; request: TimingRequest };
export function timingHelp(): string { return t('cli.timing.help'); }
function invalid(): never { throw new CoreError('INVALID_ARGUMENT', t('cli.timing.error.invalid')); }
export function parseTimingArgs(argv: readonly string[]): TimingInvocation {
  const args = [...argv];
  let action: TimingRequest['action'] = 'summary';
  if (['summary', 'evidence', 'capabilities'].includes(args[0])) action = args.shift() as TimingRequest['action'];
  const flags = new Set<string>(), values = new Map<string, string>(), roots: string[] = [];
  let help = false;
  for (let index = 0; index < args.length; index++) {
    const [name, inline] = args[index].split(/=(.*)/s);
    if (name === '--help' || name === '-h') { if (inline !== undefined || help) invalid(); help = true; continue; }
    if (['--json', '--text', '--share', '--fresh', '--cached'].includes(name)) {
      if (inline !== undefined || flags.has(name)) invalid(); flags.add(name); continue;
    }
    if (!['--thread', '--turn', '--snapshot', '--source', '--root', '--limit', '--cursor', '--collection', '--object'].includes(name)
      || (name !== '--root' && values.has(name))) invalid();
    const value = inline ?? args[++index];
    if (!value || value.startsWith('-')) invalid();
    if (name === '--root') roots.push(path.resolve(value)); else values.set(name, value);
  }
  if (flags.has('--json') && flags.has('--text') || flags.has('--fresh') && flags.has('--cached')) invalid();
  const format = flags.has('--text') ? 'text' : 'json';
  const privacyProfile = flags.has('--share') ? 'share-v1' : 'local';
  if (action === 'capabilities') {
    if (values.size || roots.length || flags.has('--fresh') || flags.has('--cached')) invalid();
    return help ? { help, format } : { help, format, request: { action, privacyProfile } };
  }
  if (action === 'summary' && (values.has('--limit') || values.has('--cursor') || values.has('--collection') || values.has('--object'))
    || action === 'evidence' && (flags.has('--share') || flags.has('--fresh') || flags.has('--cached'))
    || values.has('--snapshot') && flags.has('--fresh')) invalid();
  const collection = values.get('--collection') ?? 'turn_events';
  if (!['turn_events', 'use_objects', 'use_records'].includes(collection)
    || values.has('--object') && collection !== 'use_records') invalid();
  let limit: number | undefined;
  if (values.has('--limit')) {
    const raw = values.get('--limit')!; limit = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) invalid();
  }
  if (help) return { help, format };
  const threadId = values.get('--thread'), turnId = values.get('--turn'), snapshotId = values.get('--snapshot');
  if (!threadId || !turnId || action === 'evidence' && !snapshotId) invalid();
  const scope = values.has('--source') ? { sourceInstanceId: values.get('--source')! } : undefined;
  if (action === 'evidence') return { help, format, request: {
    action, threadId, turnId, snapshotId: snapshotId!, roots, scope, privacyProfile: 'local',
    collection: collection as 'turn_events' | 'use_objects' | 'use_records', objectRef: values.get('--object'),
    limit: limit ?? 50, cursor: values.has('--cursor') ? { token: values.get('--cursor')! } : undefined,
  } };
  return { help, format, request: { action, threadId, turnId, snapshotId, roots, scope, privacyProfile,
    mode: flags.has('--fresh') ? 'fresh' : flags.has('--cached') ? 'cached' : 'auto' } };
}

const errorMessages = {
  INVALID_ARGUMENT: 'cli.timing.error.invalid', VIEW_EXPIRED: 'cli.timing.error.expired',
  NOT_FOUND: 'cli.timing.error.notFound',
  SNAPSHOT_CORRUPT: 'cli.timing.error.corrupt', SOURCE_UNREADABLE: 'cli.timing.error.source',
  RESOURCE_LIMIT: 'cli.timing.error.resource', OUTPUT_LIMIT: 'cli.timing.error.resource',
  UNSUPPORTED_VERSION: 'cli.timing.error.version', SYNC_PENDING: 'cli.timing.error.pending',
  CANCELLED: 'cli.timing.error.cancelled', CORE_UNAVAILABLE: 'cli.timing.error.unavailable',
  PROTOCOL_ERROR: 'cli.timing.error.unavailable', CORE_ERROR: 'cli.timing.error.unavailable',
  TIMEOUT: 'cli.timing.error.unavailable', TRANSPORT_ERROR: 'cli.timing.error.unavailable', INTERNAL_ERROR: 'cli.timing.error.unavailable',
} as const;
export function timingErrorOutput(error: unknown, cancelled = false): TimingErrorOutput {
  const candidate = cancelled ? 'CANCELLED' : error instanceof CoreError ? error.code : 'INTERNAL_ERROR';
  const code = Object.hasOwn(errorMessages, candidate) ? candidate as keyof typeof errorMessages : 'INTERNAL_ERROR';
  return { outputVersion: 1, error: { code, message: t(errorMessages[code]) } };
}
interface TimingHost {
  createClient?: (options: { automaticPrices: false }) => Pick<UsageClient, 'timing'>;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  signal?: AbortSignal;
}
/** The injected host is for isolated entry tests; production uses the same typed Node client. */
export async function runTimingCli(argv: string[], host: TimingHost = {}): Promise<number> {
  const stdout = host.stdout ?? ((text: string) => { process.stdout.write(text); });
  const stderr = host.stderr ?? ((text: string) => { process.stderr.write(text); });
  let format: Format = argv.includes('--text') && !argv.includes('--json') ? 'text' : 'json';
  const controller = new AbortController(), stop = () => controller.abort();
  const signal = host.signal ? AbortSignal.any([controller.signal, host.signal]) : controller.signal;
  try {
    const invocation = parseTimingArgs(configureLanguage(argv)); format = invocation.format;
    if (invocation.help) { stdout(format === 'json' ? JSON.stringify({ outputVersion: 1, help: timingHelp() }) + '\n' : timingHelp()); return 0; }
    if (signal.aborted) throw new CoreError('CANCELLED', 'Cancelled');
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    const client = (host.createClient ?? createNodeClient)({ automaticPrices: false });
    if (!client.timing) throw new CoreError('CORE_UNAVAILABLE', 'Timing unavailable');
    const options: QueryOptions = { signal, onProgress: () => { stderr(`Wombat · ${t('cli.timing.title')}…\n`); } };
    const result = await client.timing(invocation.request, options);
    if (signal.aborted) throw new CoreError('CANCELLED', 'Cancelled');
    stdout((format === 'json' ? JSON.stringify(result) : renderTimingResult(result)) + '\n');
    return timingExitCode(result);
  } catch (error) {
    const result = timingErrorOutput(error, signal.aborted);
    if (format === 'json') stdout(JSON.stringify(result) + '\n'); else stderr(`Wombat · ${result.error.message}\n`);
    return result.error.code === 'CANCELLED' ? 130 : 1;
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
