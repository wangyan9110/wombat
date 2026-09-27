import { spawn } from 'node:child_process';
import path from 'node:path';
import { scan } from './scan.js';
import { collectUsage, normalizeRange, usageKinds, validateTimezone, type UsageKind } from './usage.js';
import { loadSnapshot, saveSnapshot } from './storage.js';
import { writeReport } from './report.js';

interface Flags {
  positionals: string[];
  since?: string;
  until?: string;
  timezone?: string;
  out?: string;
  snapshot?: string;
  sourceDirs: Record<string, string[]>;
  noOpen: boolean;
  noCost: boolean;
  json: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { positionals: [], sourceDirs: {}, noOpen: false, noCost: false, json: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) { flags.positionals.push(arg); continue; }
    if (arg === '--no-open') flags.noOpen = true;
    else if (arg === '--no-cost') flags.noCost = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--source-dir') {
      const value = argv[++index];
      if (!value?.includes('=')) throw new Error('--source-dir 需要 agent=PATH');
      const separator = value.indexOf('=');
      const agent = value.slice(0, separator); const dir = value.slice(separator + 1);
      if (!agent || !dir) throw new Error('--source-dir 需要 agent=PATH');
      (flags.sourceDirs[agent] ||= []).push(path.resolve(dir));
    } else if (['--since', '--until', '--timezone', '--out', '--snapshot'].includes(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} 缺少值`);
      const key = arg.slice(2) as 'since' | 'until' | 'timezone' | 'out' | 'snapshot';
      flags[key] = value;
    } else throw new Error(`未知参数：${arg}`);
  }
  return flags;
}

function help() {
  process.stdout.write(`Wombat · 袋熊 — Agent 环境管家（只读首版）\n\n` +
    `用法:\n  wombat scan [path] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--timezone Asia/Shanghai] [--source-dir codex=PATH] [--out REPORT.html] [--no-open] [--json]\n` +
    `  wombat usage daily|weekly|monthly|session [--json] [--no-cost] [--since YYYY-MM-DD] [--until YYYY-MM-DD]\n` +
    `  wombat report [--snapshot SNAPSHOT.json] [--out REPORT.html] [--no-open]\n\n` +
    `日期范围包含 --since，不包含 --until；默认最近 30 个自然日。所有扫描默认离线。\n`);
}

function maybeOpen(file: string, noOpen: boolean) {
  if (noOpen || !process.stdout.isTTY || process.platform !== 'darwin') return;
  const child = spawn('open', [file], { stdio: 'ignore', detached: true });
  child.unref();
}

async function main(argv: string[]) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === 'help' || command === '-h') { help(); return; }
  const flags = parseFlags(rest);
  if (command === 'scan') {
    if (flags.positionals.length > 1) throw new Error('scan 只接受一个工作空间路径');
    const snapshot = await scan({ workspace: flags.positionals[0] || process.cwd(), since: flags.since, until: flags.until,
      timezone: flags.timezone, sourceDirs: flags.sourceDirs, noCost: flags.noCost });
    const snapshotPath = await saveSnapshot(snapshot);
    const reportPath = await writeReport(snapshot, flags.out);
    const partial = snapshot.modules.some(module => ['failed', 'partial', 'permission_denied'].includes(module.state));
    if (flags.json) process.stdout.write(JSON.stringify({ snapshot: snapshotPath, report: reportPath, modules: snapshot.modules }) + '\n');
    else process.stdout.write(`扫描完成：${snapshot.resources.length} 项环境资源，${snapshot.sessions.length} 个 Codex 会话，${snapshot.findings.length} 条发现。\n快照：${snapshotPath}\n报告：${reportPath}\n${partial ? '部分来源未完成，详见报告。\n' : ''}`);
    maybeOpen(reportPath, flags.noOpen || flags.json);
    if (partial) process.exitCode = 2;
    return;
  }
  if (command === 'usage') {
    const kind = flags.positionals[0] as UsageKind | undefined;
    if (!kind || !usageKinds.includes(kind) || flags.positionals.length !== 1) throw new Error('usage 需要 daily、weekly、monthly 或 session');
    const timezone = validateTimezone(flags.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    const range = normalizeRange(flags.since, flags.until, timezone);
    const usage = await collectUsage({ ...range, timezone, noCost: flags.noCost, sourceDirs: flags.sourceDirs });
    const section = usage.sections[kind];
    if (!section) throw new Error(`用量来源 ${kind} 未完成：${usage.status.find(item => item.source.endsWith(kind))?.detail || '未知原因'}`);
    if (flags.json) process.stdout.write(JSON.stringify({ schemaVersion: 1, source: 'ccusage', version: usage.version, scope: { ...range, timezone }, section }) + '\n');
    else {
      process.stdout.write(`Wombat 用量 · ${kind} · ${range.since} 至 ${range.until}（不含）\n`);
      for (const row of section.rows) process.stdout.write(`${row.period}\t${row.agent}\t${row.totalTokens ?? '未知'} tokens\t${row.pricing === 'hidden' ? '费用已隐藏' : row.pricing === 'unpriced' ? '部分未计价' : row.costUSD === null ? '费用未知' : `$${row.costUSD.toFixed(4)}`}\n`);
      if (!section.rows.length) process.stdout.write('当前范围没有可用记录。\n');
    }
    return;
  }
  if (command === 'report') {
    if (flags.positionals.length) throw new Error('report 不接受位置参数');
    const loaded = await loadSnapshot(flags.snapshot);
    const reportPath = await writeReport(loaded.snapshot, flags.out);
    if (flags.json) process.stdout.write(JSON.stringify({ snapshot: loaded.path, report: reportPath }) + '\n');
    else process.stdout.write(`报告：${reportPath}\n`);
    maybeOpen(reportPath, flags.noOpen || flags.json);
    return;
  }
  throw new Error(`未知命令：${command}`);
}

main(process.argv.slice(2)).catch(error => {
  process.stderr.write(`Wombat：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
