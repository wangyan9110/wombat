import { spawn } from 'node:child_process';
import path from 'node:path';
import * as readline from 'node:readline/promises';
import { scan } from './scan.js';
import { collectUsage, normalizeRange, usageKinds, validateTimezone, type UsageKind } from './usage.js';
import { loadSnapshot, saveSnapshot } from './storage.js';
import { writeReport } from './report.js';
import { renderDoctor, renderEnvironment, renderSessionDetail, renderSessions, renderStatus, renderUsage, sortSessions, statusSummary } from './cli-view.js';
import { SCHEMA_VERSION, type ScanSnapshot } from './contracts.js';

interface Flags {
  positionals: string[];
  since?: string; until?: string; timezone?: string; out?: string; snapshot?: string;
  agent?: string; model?: string; kind?: string; scope?: string; project?: string; session?: string; limit?: number;
  sourceDirs: Record<string, string[]>;
  noOpen: boolean; open: boolean; noCost: boolean; json: boolean; html: boolean; live: boolean; all: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { positionals: [], sourceDirs: {}, noOpen: false, open: false, noCost: false, json: false, html: false, live: false, all: false };
  const values = new Set(['--since', '--until', '--timezone', '--out', '--snapshot', '--agent', '--model', '--kind', '--scope', '--project', '--session', '--limit']);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) { flags.positionals.push(arg); continue; }
    if (arg === '--no-open') flags.noOpen = true;
    else if (arg === '--open') flags.open = true;
    else if (arg === '--no-cost') flags.noCost = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--html') flags.html = true;
    else if (arg === '--live') flags.live = true;
    else if (arg === '--all') flags.all = true;
    else if (arg === '--source-dir') {
      const value = argv[++index];
      if (!value?.includes('=')) throw new Error('--source-dir 需要 agent=PATH');
      const separator = value.indexOf('=');
      const agent = value.slice(0, separator); const dir = value.slice(separator + 1);
      if (!agent || !dir) throw new Error('--source-dir 需要 agent=PATH');
      (flags.sourceDirs[agent] ||= []).push(path.resolve(dir));
    } else if (values.has(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} 缺少值`);
      if (arg === '--limit') {
        const limit = Number(value);
        if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('--limit 需要正整数');
        flags.limit = limit;
      } else (flags as unknown as Record<string, unknown>)[arg.slice(2)] = value;
    } else throw new Error(`未知参数：${arg}`);
  }
  if (flags.open && flags.noOpen) throw new Error('--open 与 --no-open 不能同时使用');
  return flags;
}

function help() {
  process.stdout.write(`Wombat · 袋熊 — 本地 Agent 环境管家

用法
  wombat                         交互菜单（仅终端）
  wombat scan [path]              更新只读快照，终端显示摘要
  wombat status                   查看上次扫描的概览与来源状态
  wombat usage [daily|weekly|monthly|session]  查看精细用量
  wombat env                      查看 Rules、Skills、MCP
  wombat doctor                   查看事实、证据与建议预览
  wombat sessions                 查看会话；--session ID 看事件
  wombat report                   从快照生成离线 HTML

常用选项
  scan --html [--out PATH]        扫描时同时生成 HTML
  usage --live                    直接查询本地 ccusage 数据
  --snapshot PATH                 查询指定快照；默认最近一次
  --agent NAME                    按 Agent 筛选
  --json                          机器可读 JSON
  --all / --limit N               展开更多清单或发现
  --since / --until YYYY-MM-DD    仅用于扫描或实时用量，结束日期不包含
  --timezone Asia/Shanghai        扫描或实时用量的时区
  --source-dir agent=PATH         指定本地来源，可重复
  --open                          生成 HTML 后在 macOS 打开

所有扫描默认离线。配置盘点与 doctor 均只读。
`);
}

function json(value: unknown) { process.stdout.write(JSON.stringify(value) + '\n'); }
function pageLimit(flags: Flags, fallback: number) { return flags.limit ?? (flags.all || flags.json ? Infinity : fallback); }
function ensurePositionals(flags: Flags, max: number, command: string) {
  if (flags.positionals.length > max) throw new Error(`${command} 最多接受 ${max} 个位置参数`);
}
function ensureSnapshotQuery(command: string, flags: Flags) {
  if (flags.since || flags.until || flags.timezone || Object.keys(flags.sourceDirs).length || flags.live || flags.noCost)
    throw new Error(`${command} 读取已保存快照；请用 wombat scan 更新范围`);
}
function ensureAllowed(command: string, flags: Flags, allowed: string[]) {
  for (const [key, value] of Object.entries(flags)) {
    if (key === 'positionals' || key === 'sourceDirs' || allowed.includes(key)) continue;
    if (typeof value === 'boolean' ? value : value !== undefined) throw new Error(`${command} 不支持 --${key.replace(/[A-Z]/g, char => '-' + char.toLowerCase())}`);
  }
}
async function snapshotFrom(flags: Flags): Promise<{ path: string; snapshot: ScanSnapshot }> {
  try { return await loadSnapshot(flags.snapshot); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('未找到快照，请先运行 wombat scan；或用 --snapshot PATH 指定文件');
    throw error;
  }
}
function openFile(file: string) {
  if (process.platform !== 'darwin') throw new Error('--open 当前只支持 macOS');
  const child = spawn('open', [file], { stdio: 'ignore', detached: true });
  child.unref();
}

async function runCommand(command: string, argv: string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) { help(); return; }
  const flags = parseFlags(argv);
  if (command === 'scan') {
    ensurePositionals(flags, 1, command);
    ensureAllowed(command, flags, ['since', 'until', 'timezone', 'out', 'noOpen', 'open', 'noCost', 'json', 'html']);
    const result = await scan({ workspace: flags.positionals[0] || process.cwd(), since: flags.since, until: flags.until,
      timezone: flags.timezone, sourceDirs: flags.sourceDirs, noCost: flags.noCost });
    const snapshotPath = await saveSnapshot(result);
    const reportPath = flags.html || flags.out || flags.open ? await writeReport(result, flags.out) : null;
    const partial = result.modules.some(item => ['failed', 'partial', 'permission_denied', 'cancelled'].includes(item.state));
    if (flags.json) json({ schemaVersion: SCHEMA_VERSION, snapshot: snapshotPath, report: reportPath, summary: statusSummary(result), modules: result.modules });
    else process.stdout.write(renderStatus(result) + `\n快照已保存  ${snapshotPath}\n${reportPath ? `HTML 报告  ${reportPath}` : '导出 HTML   wombat report'}\n`);
    if (reportPath && flags.open) openFile(reportPath);
    if (partial) process.exitCode = 2;
    return;
  }
  if (command === 'status') {
    ensurePositionals(flags, 0, command); ensureSnapshotQuery(command, flags);
    ensureAllowed(command, flags, ['snapshot', 'json']);
    const loaded = await snapshotFrom(flags);
    if (flags.json) json({ schemaVersion: SCHEMA_VERSION, snapshot: loaded.path, createdAt: loaded.snapshot.createdAt,
      scope: loaded.snapshot.scope, summary: statusSummary(loaded.snapshot), modules: loaded.snapshot.modules,
      priorityFindings: loaded.snapshot.findings.slice(0, 3), warnings: loaded.snapshot.warnings });
    else process.stdout.write(renderStatus(loaded.snapshot));
    return;
  }
  if (command === 'usage') {
    ensurePositionals(flags, 1, command);
    ensureAllowed(command, flags, ['snapshot', 'json', 'agent', 'model', 'live', 'since', 'until', 'timezone', 'noCost']);
    const kind = (flags.positionals[0] || 'daily') as UsageKind;
    if (!usageKinds.includes(kind)) throw new Error('usage 需要 daily、weekly、monthly 或 session');
    const useLive = flags.live || !!(flags.since || flags.until || flags.timezone || flags.noCost || Object.keys(flags.sourceDirs).length);
    if (useLive && flags.snapshot) throw new Error('--snapshot 与实时用量选项不能同时使用');
    let section; let scope: string; let source: string;
    if (useLive) {
      const timezone = validateTimezone(flags.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
      const range = normalizeRange(flags.since, flags.until, timezone);
      const usage = await collectUsage({ ...range, timezone, noCost: flags.noCost, sourceDirs: flags.sourceDirs });
      section = usage.sections[kind]; source = `ccusage ${usage.version} · 实时`;
      scope = `${range.since} 至 ${range.until}（不含） · ${timezone}`;
      if (!section) throw new Error(`用量来源 ${kind} 未完成：${usage.status.find(item => item.source.endsWith(kind))?.detail || '未知原因'}`);
    } else {
      const loaded = await snapshotFrom(flags);
      section = loaded.snapshot.usage?.sections[kind]; source = `快照 ${loaded.snapshot.snapshotId}`;
      scope = `${loaded.snapshot.scope.since} 至 ${loaded.snapshot.scope.until}（不含） · ${loaded.snapshot.scope.timezone} · 扫描于 ${loaded.snapshot.createdAt}`;
      if (!section) throw new Error(`快照没有 ${kind} 用量；运行 wombat scan 查看来源状态`);
    }
    const rows = section.rows.filter(row => (!flags.agent || row.agent === flags.agent) && (!flags.model || row.models.some(model => model.toLowerCase().includes(flags.model!.toLowerCase()))));
    if (flags.json) json({ schemaVersion: SCHEMA_VERSION, source, scope, kind, rows, totals: flags.agent || flags.model ? null : section.totals,
      filter: { agent: flags.agent ?? null, model: flags.model ?? null }, note: flags.agent || flags.model ? '筛选后不展示未重新计算的全量合计' : null });
    else process.stdout.write(renderUsage(rows, `${kind} 用量 · ${source}`, scope));
    return;
  }
  if (command === 'env') {
    ensurePositionals(flags, 0, command); ensureSnapshotQuery(command, flags);
    ensureAllowed(command, flags, ['snapshot', 'json', 'agent', 'scope', 'kind', 'limit', 'all']);
    if (flags.scope && !['user', 'workspace'].includes(flags.scope)) throw new Error('--scope 仅支持 user 或 workspace');
    if (flags.kind && !['rule', 'skill', 'mcp', 'config'].includes(flags.kind)) throw new Error('--kind 仅支持 rule、skill、mcp、config');
    const loaded = await snapshotFrom(flags);
    const all = loaded.snapshot.resources.filter(item => (!flags.agent || item.agent === flags.agent) && (!flags.scope || item.scope === flags.scope) && (!flags.kind || item.kind === flags.kind));
    const resources = all.slice(0, pageLimit(flags, 50));
    if (flags.json) json({ schemaVersion: SCHEMA_VERSION, snapshot: loaded.path, scope: loaded.snapshot.scope, total: all.length, resources });
    else process.stdout.write(renderEnvironment(loaded.snapshot, resources, all.length));
    return;
  }
  if (command === 'doctor') {
    ensurePositionals(flags, 0, command); ensureSnapshotQuery(command, flags);
    ensureAllowed(command, flags, ['snapshot', 'json', 'agent', 'limit', 'all']);
    const loaded = await snapshotFrom(flags);
    const all = loaded.snapshot.findings.filter(item => !flags.agent || item.agent === flags.agent);
    const findings = all.slice(0, pageLimit(flags, 3));
    if (flags.json) json({ schemaVersion: SCHEMA_VERSION, snapshot: loaded.path, scope: loaded.snapshot.scope, total: all.length,
      findings, modules: loaded.snapshot.modules.filter(item => !['success', 'empty'].includes(item.state)) });
    else process.stdout.write(renderDoctor(loaded.snapshot, findings, all.length));
    return;
  }
  if (command === 'sessions') {
    ensurePositionals(flags, 0, command); ensureSnapshotQuery(command, flags);
    ensureAllowed(command, flags, ['snapshot', 'json', 'agent', 'project', 'session', 'limit', 'all']);
    const loaded = await snapshotFrom(flags);
    if (flags.session) {
      const session = loaded.snapshot.sessions.find(item => item.id === flags.session);
      if (!session) throw new Error(`未找到会话：${flags.session}`);
      const all = loaded.snapshot.events.filter(item => item.sessionId === session.id);
      const events = all.slice(0, pageLimit(flags, 100));
      if (flags.json) json({ schemaVersion: SCHEMA_VERSION, snapshot: loaded.path, session, totalEvents: all.length, events });
      else { process.stdout.write(renderSessionDetail(session, events)); if (events.length < all.length) process.stdout.write('还有更多事件，使用 --all 或 --limit N 查看。\n'); }
    } else {
      const all = sortSessions(loaded.snapshot.sessions.filter(item => (!flags.agent || item.agent === flags.agent) && (!flags.project || item.workspace?.includes(flags.project))));
      const sessions = all.slice(0, pageLimit(flags, 20));
      if (flags.json) json({ schemaVersion: SCHEMA_VERSION, snapshot: loaded.path, scope: loaded.snapshot.scope, total: all.length, sessions });
      else process.stdout.write(renderSessions(loaded.snapshot, sessions, all.length));
    }
    return;
  }
  if (command === 'report') {
    ensurePositionals(flags, 0, command); ensureSnapshotQuery(command, flags);
    ensureAllowed(command, flags, ['snapshot', 'json', 'out', 'open', 'noOpen', 'html']);
    const loaded = await snapshotFrom(flags);
    const reportPath = await writeReport(loaded.snapshot, flags.out);
    if (flags.json) json({ schemaVersion: SCHEMA_VERSION, snapshot: loaded.path, report: reportPath });
    else process.stdout.write(`HTML 报告  ${reportPath}\n`);
    if (flags.open) openFile(reportPath);
    return;
  }
  throw new Error(`未知命令：${command}；运行 wombat --help 查看用法`);
}

async function menu() {
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  const options: Record<string, string> = { '1': 'status', '2': 'usage', '3': 'env', '4': 'doctor', '5': 'sessions', '6': 'scan', '7': 'report' };
  try {
    while (true) {
      process.stdout.write('\nWombat · 袋熊\n  1 概览   2 用量   3 环境   4 检查\n  5 会话   6 重新扫描   7 导出 HTML   0 退出\n');
      const choice = (await input.question('请选择 > ')).trim();
      if (choice === '0' || choice.toLowerCase() === 'q') return;
      const selected = options[choice];
      if (!selected) { process.stdout.write('请输入 0–7。\n'); continue; }
      try { await runCommand(selected, []); }
      catch (error) { process.stderr.write(`Wombat：${error instanceof Error ? error.message : String(error)}\n`); }
    }
  } finally { input.close(); }
}

async function main(argv: string[]) {
  const [command, ...rest] = argv;
  if (!command) {
    if (process.stdin.isTTY && process.stdout.isTTY) await menu();
    else help();
    return;
  }
  if (['help', '--help', '-h'].includes(command)) { help(); return; }
  if (['--version', '-V'].includes(command)) { process.stdout.write('Wombat 0.2.0\n'); return; }
  await runCommand(command, rest);
}

main(process.argv.slice(2)).catch(error => {
  process.stderr.write(`Wombat：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
