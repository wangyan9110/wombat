import { setTimeout as delay } from 'node:timers/promises';
import { runPricingCli } from './prices-cli.js';
import packageMetadata from '../package.json' with { type: 'json' };
import { CoreError, type UsageRequest, type UsageResult } from '@wombat/client';
import { createNodeClient } from '@wombat/client/node';
import { launchInteractive } from './interactive.js';
import { renderUsageResult } from './format.js';
export const usageHelp = `Wombat

用法
  wombat                         打开用量与对话；非交互终端查看用量
  wombat prices [update]         查看 / 联网更新官方价表
  wombat refresh                 更新本机记录
  wombat usage                   查看用量
  wombat threads                 查看对话
  wombat turns --thread ID        查看轮次
  wombat steps --thread ID --turn ID  查看轮次记录

选项
  --fresh                        等待本次同步完成（最长 10 秒）
  --cached                       仅读取已提交数据
  --watch                        持续更新；配合 --json 输出 NDJSON
  --verify                       完整校验源日志（仅 refresh）
  --json                         输出 JSON
  --snapshot ID                  查询固定快照
  --timezone ZONE                显示和筛选时区
  --since YYYY-MM-DD             起始日期（含）
  --until YYYY-MM-DD             截止日期（不含）
  --model ID --effort LEVEL       模型与推理强度
  --project PATH                 项目路径
  --model-unknown --effort-unknown  筛选未知模型或推理强度
  --undated                      筛选日期未知记录
  --thread ID                    限定对话
  --group day|week|month          用量周期
  --sort tokens|recent|time       排序
  --search TEXT                  搜索对话
  --limit 1..500 --offset N       分页
  --root PATH                    来源目录，可重复
  --version                      显示版本
  --help                         显示帮助
`;
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
const valued = new Set(['root', 'snapshot', 'timezone', 'since', 'until', 'model', 'effort', 'project', 'thread', 'turn', 'group', 'sort', 'search', 'limit', 'offset', 'root']);
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
    if (['--fresh', '--cached', '--watch', '--verify'].includes(arg)) { if (liveFlags.has(arg)) invalid(`${arg} 不能重复`); liveFlags.add(arg); continue; }
    if (arg === '--version' || arg === '-v') {
      version = true;
      continue;
    }
    if (arg === 'help' || arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (['--model-unknown', '--effort-unknown', '--undated'].includes(arg)) { if (unknownFlags.has(arg)) invalid(`${arg} 不能重复`); unknownFlags.add(arg); continue; }
    if (arg === '--json') {
      if (json)
        invalid('--json 不能重复');
      json = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      if (explicit || !actions.has(arg))
        invalid(`未知命令：${arg}`);
      action = arg as UsageRequest['action'];
      explicit = true;
      continue;
    }
    const equal = arg.indexOf('=');
    const name = arg.slice(2, equal < 0 ? undefined : equal);
    if (!valued.has(name))
      invalid(`未知参数：--${name}`);
    const value = equal < 0 ? argv[++i] : arg.slice(equal + 1);
    if (!value || value.startsWith('--'))
      invalid(`--${name} 缺少值`);
    if (name === 'root') {
      roots.push(value);
      continue;
    }
    if (values.has(name))
      invalid(`--${name} 不能重复`);
    values.set(name, value);
  }
  if (version && argv.some(arg => !['--version', '-v', '--json'].includes(arg)))
    invalid('--version 不能与查询参数同时使用');
  if (action === 'refresh' && unknownFlags.size) invalid('refresh 不支持查询筛选');
  const request: UsageRequest = { action };
  const scope: NonNullable<UsageRequest['scope']> = {};
  const allowed = action === 'refresh' ? new Set(['root']) : new Set(['root', 'snapshot', 'timezone', 'since', 'until', 'model', 'effort', 'project', 'thread', 'limit', 'offset', ...(action === 'usage' ? ['group'] : []), ...(action === 'threads' ? ['sort', 'search'] : []), ...(action === 'turns' || action === 'steps' ? ['sort'] : []), ...(action === 'steps' ? ['turn'] : [])]);
  for (const name of [...values.keys(), ...(roots.length ? ['root'] : [])])
    if (!allowed.has(name))
      invalid(`${action} 不支持 --${name}`);
  for (const key of ['since', 'until'] as const) {
    const value = values.get(key);
    if (value) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
        invalid(`--${key} 需要有效日期 YYYY-MM-DD`);
      scope[key] = value;
    }
  }
  if (unknownFlags.has('--undated')) { if (scope.since || scope.until) invalid('--undated 不能与日期范围同时使用'); scope.undated = true; }
  if (scope.since && scope.until && scope.since >= scope.until)
    invalid('--until 必须晚于 --since');
  const timezone = values.get('timezone');
  if (timezone) {
    try {
      new Intl.DateTimeFormat('zh-CN', { timeZone: timezone });
    }
    catch {
      invalid('--timezone 需要有效时区');
    }
    scope.timezone = timezone;
  }
  for (const [flag, key] of [['model', 'model'], ['effort', 'reasoningEffort'], ['project', 'project']] as const) {
    const value = values.get(flag);
    if (value)
      scope[key] = value;
  }
  if (unknownFlags.has('--model-unknown')) { if (scope.model) invalid('--model-unknown 不能与 --model 同时使用'); scope.modelUnknown = true; }
  if (unknownFlags.has('--effort-unknown')) { if (scope.reasoningEffort) invalid('--effort-unknown 不能与 --effort 同时使用'); scope.effortUnknown = true; }
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
    invalid(`${action} 需要 --thread ID`);
  if (!help && action === 'steps' && !request.turnId)
    invalid('steps 需要 --turn ID');
  const group = values.get('group');
  if (group) {
    if (!['day', 'week', 'month'].includes(group))
      invalid('--group 仅支持 day、week、month');
    request.group = group as UsageRequest['group'];
  }
  const sort = values.get('sort');
  if (sort) {
    const choices = action === 'threads' ? ['tokens', 'recent'] : ['tokens', 'time'];
    if (!choices.includes(sort))
      invalid(`--sort 仅支持 ${choices.join('、')}`);
    request.sort = sort as UsageRequest['sort'];
  }
  for (const name of ['limit', 'offset'] as const) {
    const value = values.get(name);
    if (value) {
      const n = Number(value);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < (name === 'limit' ? 1 : 0) || (name === 'limit' && n > 500))
        invalid(`--${name} 超出范围`);
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
  if (liveFlags.has('--fresh') && liveFlags.has('--cached')) invalid('--fresh 与 --cached 不能同时使用');
  if (liveFlags.has('--watch') && (action !== 'usage' || liveFlags.has('--cached') || request.snapshotId)) invalid('--watch 只支持实时 usage 查询');
  if (liveFlags.has('--verify') && action !== 'refresh') invalid('--verify 仅支持 refresh');
  if (request.snapshotId && (liveFlags.has('--fresh') || roots.length)) invalid('--snapshot 不能与 --fresh 或 --root 同时使用');
  if (action === 'refresh' && liveFlags.has('--cached')) invalid('refresh 不能使用 --cached');
  return { request, json, help, version, mode: liveFlags.has('--cached') ? 'cached' : liveFlags.has('--fresh') ? 'fresh' : 'auto', watch: liveFlags.has('--watch'), verify: liveFlags.has('--verify'), interactive: tty && !explicit && !json && !help && !version && !liveFlags.size };
}
export function resultExitCode(result: UsageResult): number { return result.quality.status === 'partial' || (result.freshness && !['current', 'fixed'].includes(result.freshness.status)) ? 2 : 0; }
export async function runUsageCli(argv = process.argv.slice(2)): Promise<number> {
  const json = argv.includes('--json');
  try {
    if (argv[0] === 'prices') return await runPricingCli(argv.slice(1));
    const invocation = parseUsageArgs(argv, Boolean(process.stdin.isTTY && process.stdout.isTTY));
    if (invocation.version) {
      process.stdout.write(invocation.json ? JSON.stringify({ outputVersion: 3, name: 'Wombat', version: packageMetadata.version }) + '\n' : 'Wombat ' + packageMetadata.version + '\n');
      return 0;
    }
    if (invocation.help) {
      process.stdout.write(invocation.json ? JSON.stringify({ outputVersion: 3, name: 'Wombat', commands: ['refresh', 'usage', 'threads', 'turns', 'steps', 'prices'], help: usageHelp }) + '\n' : usageHelp);
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
          if (invocation.request.action === 'refresh') process.stderr.write(`Wombat · ${stage}\n`);
        } };
        const result = invocation.request.snapshotId && !invocation.request.snapshotId.startsWith('live:')
          ? await client.query(invocation.request, queryOptions)
          : (await client.live!({ query: invocation.request, mode: invocation.mode, verify: invocation.verify }, queryOptions)).result;
        const revision = JSON.stringify([result.snapshotRef.snapshotId, result.scope, result.freshness?.status, result.quality]);
        if (!invocation.watch || revision !== lastRevision) {
          if (!invocation.json && result.freshness && !['current', 'fixed'].includes(result.freshness.status)) process.stderr.write(`Wombat · ${result.freshness.status === 'syncing' ? '正在同步，显示已提交数据' : result.freshness.error ?? '显示已缓存数据'}\n`);
          process.stdout.write(invocation.json ? JSON.stringify(result) + '\n' : renderUsageResult(result, process.stdout.columns ?? 120) + '\n');
          lastRevision = revision;
        }
        if (!invocation.watch) return resultExitCode(result);
        try { await delay(1_000, undefined, { signal: controller.signal }); }
        catch { throw new CoreError('CANCELLED', '已取消'); }
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
