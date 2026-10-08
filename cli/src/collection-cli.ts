import path from 'node:path';
import { CoreError, type CollectionRequest } from '@wombat/client';
import { createNodeClient, receiveCodexHook } from '@wombat/client/node';
import { t, type MessageKey } from '@wombat/client/locale';
import { terminalText } from './display-text.js';
const states = { logs_only: 'collection.logsOnly', waiting: 'collection.waiting', received: 'collection.received', paused: 'collection.paused' } as const satisfies Record<string, MessageKey>;
export function parseCollectionArgs(argv: string[]): { request: CollectionRequest; json: boolean; help: boolean } {
  const args = [...argv]; const command = args[0]?.startsWith('-') ? 'status' : args.shift() ?? 'status';
  const fail = (value: string): never => { throw new CoreError('INVALID_ARGUMENT', t('cli.config.invalid', { value })); };
  if (!['status', 'events', 'mode', 'pause', 'resume'].includes(command)) fail(command);
  const request: CollectionRequest = { action: command === 'mode' ? 'configure' : command as CollectionRequest['action'] };
  if (command === 'mode') { const mode = args.shift(); if (mode !== 'logs' && mode !== 'hooks') fail(mode ?? command); request.mode = mode === 'hooks' ? 'hooks' : 'logs'; }
  let json = false, help = false; const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].split(/=(.*)/s);
    if (flag !== '--root' && seen.has(flag)) fail(flag); seen.add(flag);
    if (['--json', '--help', '-h'].includes(flag)) { if (inline !== undefined) fail(flag); if (flag === '--json') json = true; else help = true; continue; }
    if (!['--root', '--project', '--after', '--limit', '--source'].includes(flag)) fail(flag);
    const value = inline ?? args[++i]; if (!value || value.startsWith('--')) fail(flag);
    if (flag === '--root') (request.roots ??= []).push(value);
    else if (flag === '--project') request.project = path.resolve(value);
    else if (flag === '--source') request.sourceInstanceId = value;
    else { const number = Number(value); if (command !== 'events' || !/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 0 || flag === '--limit' && (number < 1 || number > 200)) fail(flag); if (flag === '--after') request.after = number; else request.limit = number; }
  }
  return { request, json, help };
}
export async function runCollectionCli(argv: string[]): Promise<number> {
  const { request, json, help } = parseCollectionArgs(argv);
  if (help) { process.stdout.write(t('collection.help') + '\n'); return 0; }
  const controller = new AbortController(), stop = () => controller.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const result = await createNodeClient({ automaticPrices: false }).collection!(request, { signal: controller.signal });
    process.stdout.write(json ? JSON.stringify(result) + '\n' : t('collection.result', { state: t(states[result.state]), received: result.received, buffered: result.buffered, gaps: result.gaps, unknown: result.identityUnknown }) + '\n');
    if (!json) { if (result.lastReceivedAt) process.stdout.write(t('collection.lastReceipt', { time: result.lastReceivedAt }) + '\n'); for (const event of result.events) process.stdout.write(terminalText([event.sequence, event.observation.kind, event.observation.sessionId, event.observation.turnId ?? '', event.receivedAt].join(' · ')) + '\n'); if (result.nextAfter != null) process.stdout.write(t('collection.next', { after: result.nextAfter }) + '\n'); }
    return result.gaps || result.buffered || result.state === 'paused' ? 2 : 0;
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
/** Advisory Hooks always exit successfully and emit no stdout, including failures. */
export async function runHookCli(argv: string[]): Promise<number> {
  if (argv.length !== 1 || argv[0] !== 'codex') throw new CoreError('INVALID_ARGUMENT', t('cli.config.invalid', { value: 'hook codex' }));
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 4000); let bytes = 0; const chunks: Buffer[] = [];
  const abortInput = () => process.stdin.destroy(); controller.signal.addEventListener('abort', abortInput, { once: true });
  try {
    for await (const chunk of process.stdin) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); bytes += buffer.length; if (bytes > 64 * 1024) throw new CoreError('INPUT_LIMIT', 'Hook input limit'); chunks.push(buffer); }
    if (controller.signal.aborted) return 0;
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    await receiveCodexHook(body, { signal: controller.signal });
  } catch { process.stderr.write(t('collection.hookFailed') + '\n'); }
  finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abortInput); }
  return 0;
}
