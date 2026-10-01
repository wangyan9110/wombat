import { configureLanguage } from './locale.js';
import { t, progressText } from '@wombat/client/locale';
import { setTimeout as delay } from 'node:timers/promises';
import { runPricingCli } from './prices-cli.js';
import packageMetadata from '../package.json' with { type: 'json' };
import { CoreError, type UsageRequest, type UsageResult } from '@wombat/client';
import { createNodeClient } from '@wombat/client/node';
import { launchInteractive } from './interactive.js';
import { renderUsageResult } from './format.js';
export function usageHelp(): string { return t("cli.usage-app-cli.help"); }
export interface Invocation {
  request: UsageRequest;
  json: boolean;
  interactive: boolean;
  help: boolean;
  version: boolean;
  mode: 'auto' | 'fresh' | 'cached';
  watch: boolean;
  verify: boolean;
}
const actions = new Set(['refresh', 'usage', 'threads', 'turns', 'steps']);
const valued = new Set(['root', 'snapshot', 'agent', 'source', 'timezone', 'since', 'until', 'model', 'effort', 'project', 'thread', 'turn', 'group', 'presentation', 'sort', 'search', 'limit', 'offset', 'locate-thread']);
function invalid(message: string): never { throw new CoreError('INVALID_ARGUMENT', message); }
export function parseUsageArgs(argv: string[], tty = false): Invocation {
  let action: UsageRequest['action'] = 'usage';
  let explicit = false;
  let json = false;
  let help = false;
  let version = false;
  const liveFlags = new Set<string>();
  const unknownFlags = new Set<string>();
  const values = new Map<string, string>();
  const roots: string[] = [];
  for (let i = 0;i < argv.length;i++) {
    const arg = argv[i];
    if (['--fresh', '--cached', '--watch', '--verify'].includes(arg)) { if (liveFlags.has(arg)) invalid(t("common.value_cannot_be_repeated", { p0: arg })); liveFlags.add(arg); continue; }
    if (arg === '--version' || arg === '-v') {
      version = true;
      continue;
    }
    if (arg === 'help' || arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (['--model-unknown', '--effort-unknown', '--undated', '--project-unknown'].includes(arg)) { if (unknownFlags.has(arg)) invalid(t("common.value_cannot_be_repeated", { p0: arg })); unknownFlags.add(arg); continue; }
    if (arg === '--json') {
      if (json)
        invalid(t("cli.usage-app-cli.json_cannot_be_repeated"));
      json = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      if (explicit || !actions.has(arg))
        invalid(t("cli.usage-app-cli.unknown_command_value", { p0: arg }));
      action = arg as UsageRequest['action'];
      explicit = true;
      continue;
    }
    const equal = arg.indexOf('=');
    const name = arg.slice(2, equal < 0 ? undefined : equal);
    if (!valued.has(name))
      invalid(t("cli.usage-app-cli.unknown_option_value", { p0: name }));
    const value = equal < 0 ? argv[++i] : arg.slice(equal + 1);
    if (!value || value.startsWith('--'))
      invalid(t("cli.usage-app-cli.value_requires_a_value", { p0: name }));
    if (name === 'root') {
      roots.push(value);
      continue;
    }
    if (values.has(name))
      invalid(t("cli.usage-app-cli.value_cannot_be_repeated", { p0: name }));
    values.set(name, value);
  }
  if (version && argv.some(arg => !['--version', '-v', '--json'].includes(arg)))
    invalid(t("cli.usage-app-cli.version_cannot_be_combined_with_query"));
  if (action === 'refresh' && unknownFlags.size) invalid(t("cli.usage-app-cli.refresh_does_not_support_query_filters"));
  const request: UsageRequest = { action };
  const scope: NonNullable<UsageRequest['scope']> = {};
  const allowed = action === 'refresh' ? new Set(['root']) : new Set(['root', 'snapshot', 'agent', 'source', 'timezone', 'since', 'until', 'model', 'effort', 'project', 'thread', 'limit', 'offset', ...(action === 'usage' ? ['group', 'presentation', 'sort'] : []), ...(action === 'threads' ? ['sort', 'search', 'locate-thread'] : []), ...(action === 'turns' || action === 'steps' ? ['sort'] : []), ...(action === 'steps' ? ['turn'] : [])]);
  for (const name of [...values.keys(), ...(roots.length ? ['root'] : [])])
    if (!allowed.has(name))
      invalid(t("cli.usage-app-cli.value_does_not_support_value", { p0: action, p1: name }));
  for (const key of ['since', 'until'] as const) {
    const value = values.get(key);
    if (value) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
        invalid(t("cli.usage-app-cli.value_requires_a_valid_date_in", { p0: key }));
      scope[key] = value;
    }
  }
  if (unknownFlags.has('--undated')) { if (scope.since || scope.until) invalid(t("cli.usage-app-cli.undated_cannot_be_combined_with_a")); scope.undated = true; }
  if (scope.since && scope.until && scope.since >= scope.until)
    invalid(t("cli.usage-app-cli.until_must_be_later_than_since"));
  const timezone = values.get('timezone');
  if (timezone) {
    try {
      new Intl.DateTimeFormat('zh-CN', { timeZone: timezone });
    }
    catch {
      invalid(t("cli.usage-app-cli.timezone_requires_a_valid_time_zone"));
    }
    scope.timezone = timezone;
  }
  for (const [flag, key] of [['agent', 'agentKind'], ['source', 'sourceInstanceId'], ['model', 'model'], ['effort', 'reasoningEffort'], ['project', 'project']] as const) {
    const value = values.get(flag);
    if (value)
      scope[key] = value;
  }
  if (unknownFlags.has('--model-unknown')) { if (scope.model) invalid(t("cli.usage-app-cli.model_unknown_cannot_be_combined_with")); scope.modelUnknown = true; }
  if (unknownFlags.has('--effort-unknown')) { if (scope.reasoningEffort) invalid(t("cli.usage-app-cli.effort_unknown_cannot_be_combined_with")); scope.effortUnknown = true; }
  if (unknownFlags.has('--project-unknown')) { if (scope.project) invalid(t('webui.projectConflict')); scope.projectUnknown = true; }
  if (values.get('locate-thread')) request.locateThreadId = values.get('locate-thread');
  const thread = values.get('thread');
  if (thread) {
    if (action === 'turns' || action === 'steps')
      request.threadId = thread;
    else
      scope.threadId = thread;
  }
  const turn = values.get('turn');
  if (turn)
    request.turnId = turn;
  if (!help && (action === 'turns' || action === 'steps') && !request.threadId)
    invalid(t("cli.usage-app-cli.value_requires_thread_id", { p0: action }));
  if (!help && action === 'steps' && !request.turnId)
    invalid(t("cli.usage-app-cli.steps_requires_turn_id"));
  const group = values.get('group');
  if (group) {
    if (!['day', 'week', 'month'].includes(group))
      invalid(t("cli.usage-app-cli.group_accepts_day_week_or_month"));
    request.group = group as UsageRequest['group'];
  }
  const presentation = values.get('presentation');
  if (presentation) { if (!['distribution', 'details', 'projects', 'models'].includes(presentation)) invalid(t('cli.usage-app-cli.presentation_invalid')); request.presentation = presentation as UsageRequest['presentation']; }
  const sort = values.get('sort');
  if (sort) {
    const choices = action === 'threads' ? ['tokens', 'cost', 'recent'] : ['tokens', 'cost', 'time'];
    if (!choices.includes(sort))
      invalid(t("cli.usage-app-cli.sort_accepts_value", { p0: choices.join('、') }));
    request.sort = sort as UsageRequest['sort'];
  }
  for (const name of ['limit', 'offset'] as const) {
    const value = values.get(name);
    if (value) {
      const n = Number(value);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < (name === 'limit' ? 1 : 0) || (name === 'limit' && n > 500))
        invalid(t("cli.usage-app-cli.value_is_out_of_range", { p0: name }));
      request[name] = n;
    }
  }
  if (values.get('snapshot'))
    request.snapshotId = values.get('snapshot');
  if (values.get('search'))
    request.search = values.get('search');
  if (roots.length)
    request.roots = roots;
  if (Object.keys(scope).length)
    request.scope = scope;
  if (liveFlags.has('--fresh') && liveFlags.has('--cached')) invalid(t("cli.usage-app-cli.fresh_and_cached_cannot_be_combined"));
  if (liveFlags.has('--watch') && (action !== 'usage' || liveFlags.has('--cached') || request.snapshotId)) invalid(t("cli.usage-app-cli.watch_only_supports_live_usage_queries"));
  if (liveFlags.has('--verify') && action !== 'refresh') invalid(t("cli.usage-app-cli.verify_only_supports_refresh"));
  if (request.snapshotId && (liveFlags.has('--fresh') || roots.length)) invalid(t("cli.usage-app-cli.snapshot_cannot_be_combined_with_fresh"));
  if (action === 'refresh' && liveFlags.has('--cached')) invalid(t("cli.usage-app-cli.refresh_cannot_use_cached"));
  return { request, json, help, version, mode: liveFlags.has('--cached') ? 'cached' : liveFlags.has('--fresh') ? 'fresh' : 'auto', watch: liveFlags.has('--watch'), verify: liveFlags.has('--verify'), interactive: tty && !explicit && !json && !help && !version && !liveFlags.size };
}
export function resultExitCode(result: UsageResult): number { return result.quality.status === 'partial' || (result.freshness && !['current', 'fixed'].includes(result.freshness.status)) ? 2 : 0; }
export async function runUsageCli(argv = process.argv.slice(2)): Promise<number> {
  const json = argv.includes('--json');
  try {
    argv = configureLanguage(argv);
    if (argv[0] === 'prices') return await runPricingCli(argv.slice(1));
    if (argv[0] === 'web') return await (await import('./web-cli.js')).runWebCli(argv.slice(1));
    const invocation = parseUsageArgs(argv, Boolean(process.stdin.isTTY && process.stdout.isTTY));
    if (invocation.version) {
      process.stdout.write(invocation.json ? JSON.stringify({ outputVersion: 3, name: 'Wombat', version: packageMetadata.version }) + '\n' : 'Wombat ' + packageMetadata.version + '\n');
      return 0;
    }
    if (invocation.help) {
      process.stdout.write(invocation.json ? JSON.stringify({ outputVersion: 3, name: 'Wombat', commands: ['refresh', 'usage', 'threads', 'turns', 'steps', 'prices', 'web'], help: usageHelp() }) + '\n' : usageHelp());
      return 0;
    }
    if (invocation.interactive)
      return await launchInteractive(invocation.request);
    const client = createNodeClient();
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      let lastRevision = '';
      for (;;) {
        const queryOptions = { signal: controller.signal, onProgress: (stage: string) => {
          if (invocation.request.action === 'refresh') process.stderr.write(`Wombat · ${progressText(stage)}\n`);
        } };
        const result = invocation.request.snapshotId && !invocation.request.snapshotId.startsWith('live:')
          ? await client.query(invocation.request, queryOptions)
          : (await client.live!({ query: invocation.request, mode: invocation.mode, verify: invocation.verify }, queryOptions)).result;
        const revision = JSON.stringify([result.snapshotRef.snapshotId, result.scope, result.freshness?.status, result.quality]);
        if (!invocation.watch || revision !== lastRevision) {
          if (!invocation.json && result.freshness && !['current', 'fixed'].includes(result.freshness.status)) process.stderr.write(`Wombat · ${result.freshness.status === 'syncing' ? t("cli.usage-app-cli.syncing_showing_committed_data") : result.freshness.error ?? t("cli.usage-app-cli.showing_cached_data")}\n`);
          process.stdout.write(invocation.json ? JSON.stringify(result) + '\n' : renderUsageResult(result, process.stdout.columns ?? 120) + '\n');
          lastRevision = revision;
        }
        if (!invocation.watch) return resultExitCode(result);
        try { await delay(1_000, undefined, { signal: controller.signal }); }
        catch { throw new CoreError('CANCELLED', t("common.cancelled")); }
      }
    } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }

  }
  catch (error) {
    const code = error instanceof CoreError ? error.code : error instanceof Error && ['ExitPromptError', 'AbortPromptError'].includes(error.name) ? 'CANCELLED' : 'INTERNAL_ERROR';
    const message = error instanceof Error ? error.message : String(error);
    if (json)
      process.stdout.write(JSON.stringify({ outputVersion: argv[0] === 'prices' ? 1 : 3, error: { code, message } }) + '\n');
    else
      process.stderr.write(`Wombat · ${message}\n`);
    return code === 'CANCELLED' ? 130 : 1;
  }
}
