import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import type { CodexEvent, Finding, ModuleResult, Session } from './contracts.js';

export interface CodexResult {
  sessions: Session[];
  events: CodexEvent[];
  findings: Finding[];
  status: ModuleResult;
  warnings: string[];
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

async function listJsonl(root: string, since: string, until: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(dir: string, depth: number) {
    if (depth > 6) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file, depth + 1);
      else if (entry.isFile() && file.endsWith('.jsonl')) {
        const match = file.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
        const date = match ? `${match[1]}-${match[2]}-${match[3]}` : null;
        if (!date || (date >= since && date < until)) files.push(file);
      }
    }
  }
  await visit(root, 0);
  return files.sort();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(outputText).join('\n');
  if (isObject(value)) {
    if (typeof value.output === 'string') return value.output;
    if (Array.isArray(value.content)) return outputText(value.content);
    if (typeof value.text === 'string') return value.text;
  }
  return '';
}

function targetFromCall(tool: string, argsValue: unknown): string | undefined {
  let args: Record<string, unknown> | null = null;
  if (isObject(argsValue)) args = argsValue;
  else if (typeof argsValue === 'string') {
    try { const parsed: unknown = JSON.parse(argsValue); if (isObject(parsed)) args = parsed; }
    catch { return undefined; }
  }
  if (!args) return undefined;
  if ((tool === 'read_file' || tool === 'view_image') && typeof args.path === 'string') return args.path;
  if (tool !== 'exec_command' || typeof args.cmd !== 'string') return undefined;
  const cmd = args.cmd.trim();
  const match = cmd.match(/^(?:cat|head|tail|sed\s+-n\s+[^ ]+|rg\s+--files)\s+(?:--\s+)?([\w./~@+-]+)(?:\s*)$/);
  return match?.[1];
}

function finding(ruleId: string, title: string, fact: string, hypothesis: string, recommendation: string, evidence: CodexEvent[], session: Session, severity: Finding['severity'] = 'review'): Finding {
  return {
    id: hash(`${ruleId}:${session.id}:${evidence.map(event => event.id).join(',')}`).slice(0, 20),
    ruleId, ruleVersion: '1', severity, confidence: 'indication', title, fact, hypothesis, recommendation,
    diff: null, agent: 'codex', workspace: session.workspace, sessionId: session.id,
    evidence: evidence.map(event => event.evidence),
  };
}

function analyzeEvents(events: CodexEvent[], session: Session): Finding[] {
  const findings: Finding[] = [];
  const outputs = events.filter(event => event.type === 'tool_output');
  const calls = new Map(events.filter(event => event.type === 'tool_call' && event.callId).map(event => [event.callId, event]));
  for (const event of outputs) {
    if ((event.bytes ?? 0) >= 50_000) {
      findings.push(finding('codex.large_output', '工具输出较大', `一次工具输出约 ${event.bytes} 字节。`,
        '可能包含超出本轮需要的内容；实际消耗仍以用量账本为准。', '检查该调用能否缩小搜索或输出范围。', [event], session, 'info'));
    }
  }
  const byTargetAndHash = new Map<string, CodexEvent[]>();
  for (const output of outputs) {
    const call = output.callId ? calls.get(output.callId) : undefined;
    if (!call?.target || !output.outputSha256 || !output.bytes) continue;
    const key = `${call.target}\0${output.outputSha256}`;
    byTargetAndHash.set(key, [...(byTargetAndHash.get(key) ?? []), output]);
  }
  for (const [key, repeated] of byTargetAndHash) {
    if (repeated.length < 2) continue;
    const target = key.split('\0')[0];
    const compacted = events.some(event => event.type === 'compaction' && event.timestamp >= repeated[0].timestamp && event.timestamp <= repeated.at(-1)!.timestamp);
    findings.push(finding('codex.same_read', '同内容重复读取', `同一会话对 ${target} 返回相同内容 ${repeated.length} 次。`,
      compacted ? '期间出现上下文压缩，重新读取可能用于恢复必要上下文。' : '可能是重复探索，也可能是任务中有意复查。',
      '查看调用前后的任务目标；若目标相同，可考虑限定行号或搜索范围。', repeated, session));
  }
  return findings;
}

async function parseSession(file: string): Promise<{ session: Session; events: CodexEvent[]; findings: Finding[]; badLines: number }> {
  const fallbackId = path.basename(file).replace(/\.jsonl$/, '');
  const session: Session = { id: `codex:${fallbackId}`, agent: 'codex', workspace: null, startedAt: null, lastActivityAt: null, sourceFile: file, eventCount: 0 };
  const events: CodexEvent[] = [];
  let line = 0; let badLines = 0;
  const stream = createReadStream(file, { encoding: 'utf8' });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const rawLine of reader) {
      line++;
      if (!rawLine.trim()) continue;
      let record: unknown;
      try { record = JSON.parse(rawLine); } catch { badLines++; continue; }
      if (!isObject(record)) { badLines++; continue; }
      const payload = isObject(record.payload) ? record.payload : {};
      const timestamp = typeof record.timestamp === 'string' ? record.timestamp : '';
      if (timestamp) {
        if (!session.startedAt || timestamp < session.startedAt) session.startedAt = timestamp;
        if (!session.lastActivityAt || timestamp > session.lastActivityAt) session.lastActivityAt = timestamp;
      }
      if (record.type === 'session_meta') {
        const sourceId = typeof payload.id === 'string' ? payload.id : typeof payload.session_id === 'string' ? payload.session_id : null;
        if (sourceId) session.id = `codex:${sourceId}`;
        session.workspace = typeof payload.cwd === 'string' ? payload.cwd : session.workspace;
        continue;
      }
      if (record.type !== 'response_item' && record.type !== 'event_msg') continue;
      const type = typeof payload.type === 'string' ? payload.type : '';
      const evidence = { file, line, sessionId: session.id, eventId: `${session.id}:${line}` };
      if (type === 'compaction' || type === 'context_compacted' || type === 'context_compaction') {
        events.push({ id: evidence.eventId, sessionId: session.id, timestamp, type: 'compaction', evidence });
        continue;
      }
      if (type === 'function_call' || type === 'custom_tool_call') {
        const tool = typeof payload.name === 'string' ? payload.name : 'unknown';
        const callId = typeof payload.call_id === 'string' ? payload.call_id : undefined;
        events.push({ id: evidence.eventId, sessionId: session.id, timestamp, type: 'tool_call', tool,
          target: targetFromCall(tool, payload.arguments ?? payload.input), callId, evidence });
        continue;
      }
      if (type === 'function_call_output' || type === 'custom_tool_call_output') {
        const output = outputText(payload.output);
        const callId = typeof payload.call_id === 'string' ? payload.call_id : undefined;
        events.push({ id: evidence.eventId, sessionId: session.id, timestamp, type: 'tool_output',
          bytes: Buffer.byteLength(output), outputSha256: output ? hash(output) : undefined, callId, evidence });
      }
    }
  } finally { reader.close(); stream.destroy(); }
  session.eventCount = events.length;
  return { session, events, findings: analyzeEvents(events, session), badLines };
}

export async function scanCodexSessions(since: string, until: string, root = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions')): Promise<CodexResult> {
  const warnings: string[] = []; const sessions: Session[] = []; const events: CodexEvent[] = []; const findings: Finding[] = [];
  let files: string[];
  try { files = await listJsonl(root, since, until); }
  catch (error) { return { sessions, events, findings, warnings, status: { source: `codex:${root}`, state: 'failed', detail: String(error) } }; }
  let badLines = 0;
  for (const file of files) {
    try {
      const parsed = await parseSession(file);
      sessions.push(parsed.session); events.push(...parsed.events); findings.push(...parsed.findings); badLines += parsed.badLines;
    } catch (error) { warnings.push(`会话无法解析 ${file}: ${String(error)}`); }
  }
  if (badLines) warnings.push(`Codex JSONL 中 ${badLines} 行无法解析，已保留其他可用事件。`);
  const state: ModuleResult['state'] = warnings.length ? 'partial' : files.length ? 'success' : 'empty';
  return { sessions, events, findings, warnings, status: { source: `codex:${root}`, state, count: sessions.length, detail: warnings.length ? `${warnings.length} 项覆盖提示` : undefined } };
}
