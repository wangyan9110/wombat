import { realpathSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, appendFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { createNodeClient } from '@wombat/client/node';
import { startWebHost } from '@wombat/web';
import type { TimingLocalResult } from '@wombat/client';

export const privateBody = 'SYNTHETIC_PRIVATE_BROWSER_BODY';
export const nativeThread = 'synthetic-browser-thread', nativeTurn = 'synthetic-browser-turn';
export const title = 'Synthetic browser task · long title · '.repeat(3).trim();
const epoch = Date.parse('2026-10-03T00:00:00Z');
const row = (type: string, payload: unknown, milliseconds = 0) => ({ type, payload, timestamp: new Date(epoch + milliseconds).toISOString() });
const jsonl = (rows: unknown[]) => rows.map(item => JSON.stringify(item) + '\n').join('');
const token = (id: string, at: number) => row('event_msg', { type: 'token_usage_record', thread_id: nativeThread, turn_id: nativeTurn, response_id: id,
  usage: { input_tokens: 100, cached_input_tokens: 20, cache_write_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 2, total_tokens: 110 } }, at);
const read = (skill: string, id: string, at: number, failed = false) => [
  row('response_item', { type: 'function_call', call_id: id, name: 'read_file', arguments: JSON.stringify({ path: skill }) }, at),
  row('response_item', { type: 'function_call_output', call_id: id, output: { isError: failed, content: privateBody } }, at + 1),
];
export function nativeRows(project: string, skill: string): unknown[] {
  const command = (id: string, phase: 'item_started' | 'item_completed', start: number, end: number) => row('event_msg', {
    type: phase, turn_id: nativeTurn, started_at_ms: epoch + start, ...(phase === 'item_completed' ? { completed_at_ms: epoch + end } : {}),
    item: { type: 'CommandExecution', id, source: 'agent', cwd: project, parsed_cmd: [], command: ['SYNTHETIC_PRIVATE_COMMAND'], aggregated_output: privateBody,
      status: phase === 'item_started' ? 'in_progress' : 'completed', ...(phase === 'item_completed' ? { exit_code: 0, duration: { secs: 30, nanos: 0 } } : {}) },
  }, phase === 'item_started' ? start : end);
  // Oracle: [10s,40s) and [30s,60s): sum 60s, union 50s, overlap 10s.
  // Five calls plus two commands = seven operations; each start/result is one.
  return [row('session_meta', { id: nativeThread, cwd: project }),
    row('turn_context', { turn_id: nativeTurn, model: 'gpt-5.4', effort: 'low' }),
    row('event_msg', { type: 'task_started', turn_id: nativeTurn }),
    row('response_item', { type: 'message', id: 'synthetic-browser-message', role: 'assistant', content: [{ type: 'output_text', text: privateBody }] }, 50),
    command('synthetic-browser-command-one', 'item_started', 10_000, 40_000), command('synthetic-browser-command-two', 'item_started', 30_000, 60_000),
    command('synthetic-browser-command-one', 'item_completed', 10_000, 40_000), command('synthetic-browser-command-two', 'item_completed', 30_000, 60_000),
    ...read(skill, 'synthetic-browser-read-one', 70_000), ...read(skill, 'synthetic-browser-read-two', 72_000, true), ...read(skill, 'synthetic-browser-read-three', 74_000),
    row('event_msg', { type: 'mcp_tool_call_end', call_id: 'synthetic-browser-mcp', turn_id: nativeTurn,
      invocation: { server: 'synthetic-browser-server', tool: 'synthetic-browser-tool', arguments: { private: privateBody } },
      duration: { secs: 0, nanos: 2_000_000 }, result: { Ok: { content: [{ type: 'text', text: privateBody }], isError: false } } }, 80_000),
    row('event_msg', { type: 'item_completed', turn_id: nativeTurn, item: { type: 'FileChange', id: 'synthetic-browser-patch', status: 'completed',
      changes: { [path.join(project, 'reported-private-a.rs')]: { type: 'update', unified_diff: privateBody, move_path: path.join(project, 'reported-private-b.rs') } } } }, 85_000),
    token('synthetic-browser-response-one', 90_000),
    row('event_msg', { type: 'task_complete', turn_id: nativeTurn, duration_ms: 120_000, time_to_first_token_ms: 0, last_agent_message: privateBody }, 100_000),
  ];
}
export async function stop(child?: ChildProcess): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close'); child.kill('SIGTERM');
  const kill = setTimeout(() => child.kill('SIGKILL'), 2000);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([closed, new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('Synthetic subprocess did not stop')), 4000); })]); }
  finally { clearTimeout(kill); clearTimeout(deadline); }
}
export async function fixture(repo: string, signal: AbortSignal) {
  const dir = realpathSync.native(await mkdtemp(path.join(tmpdir(), 'wombat-event-browser-')));
  const root = path.join(dir, 'source'), project = path.join(dir, 'synthetic-long-project-name-for-narrow-layout-acceptance');
  const skill = path.join(project, '.agents', 'skills', 'synthetic-long-skill-name-for-narrow-layout', 'SKILL.md');
  const data = path.join(dir, 'data'), file = path.join(root, 'sessions', 'browser.jsonl');
  const saved = ['WOMBAT_DATA_HOME', 'CODEX_HOME', 'WOMBAT_AUTO_PRICES', 'WOMBAT_CODEX_BIN', 'WOMBAT_CORE_BIN'].map(key => [key, process.env[key]] as const);
  let service: ChildProcess | undefined, vite: ChildProcess | undefined, host: Awaited<ReturnType<typeof startWebHost>> | undefined;
  const cancel = () => { service?.kill('SIGTERM'); vite?.kill('SIGTERM'); };
  const close = async () => {
    signal.removeEventListener('abort', cancel);
    try { await host?.close(); }
    finally { try { const stopped = await Promise.allSettled([stop(vite), stop(service)]); const failure = stopped.find(result => result.status === 'rejected'); if (failure?.status === 'rejected') throw failure.reason; }
      finally { for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
        await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } }
  };
  try {
    signal.throwIfAborted(); signal.addEventListener('abort', cancel, { once: true });
    await mkdir(path.dirname(file), { recursive: true }); await mkdir(path.dirname(skill), { recursive: true });
    await writeFile(skill, '---\nname: synthetic-long-skill-name-for-narrow-layout\ndescription: Synthetic\n---\nUse evidence.\n');
    await writeFile(path.join(root, 'config.toml'), "[mcp_servers.synthetic-browser-server]\ncommand='synthetic-never-executed'\n");
    await writeFile(path.join(root, 'session_index.jsonl'), jsonl([{ id: nativeThread, thread_name: title, updated_at: new Date(epoch).toISOString() }]));
    await writeFile(file, jsonl(nativeRows(project, skill)));
    Object.assign(process.env, { WOMBAT_DATA_HOME: data, CODEX_HOME: root, WOMBAT_AUTO_PRICES: '0', WOMBAT_CODEX_BIN: path.join(dir, 'absent-native-codex') });
    const binaryPath = path.join(repo, 'dist', process.platform === 'win32' ? 'wombat-core.exe' : 'wombat-core');
    process.env.WOMBAT_CORE_BIN = binaryPath;
    service = spawn(binaryPath, ['--serve-usage'], { stdio: 'ignore', env: process.env }); await once(service, 'spawn');
    // The worker opens this index after binding the service listener. Wait for it
    // before using Node, avoiding an unowned fallback service during startup.
    const deadline = Date.now() + 10_000;
    for (;;) {
      signal.throwIfAborted(); if (service.exitCode !== null) throw new Error('Synthetic core exited before readiness');
      try { await stat(path.join(data, 'live-v2', 'index.sqlite')); break; }
      catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
      if (Date.now() > deadline) throw new Error('Synthetic core readiness timed out'); await delay(50, undefined, { signal });
    }
    const client = createNodeClient({ binaryPath, automaticPrices: false, timeoutMs: 15_000 });
    host = await startWebHost({ client, roots: [root], projectRoots: [project], assets: path.join(repo, 'dist', 'web'), automaticPrices: false });
    const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
    const address = socket.address(); if (!address || typeof address === 'string') throw new Error('Preview port unavailable');
    const port = address.port; await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
    // Resolve the installed Vite public CLI rather than leaving a package-manager
    // wrapper process between this runner and its owned server.
    const vitePackage = createRequire(import.meta.url).resolve('vite/package.json', { paths: [path.join(repo, 'ui')] });
    vite = spawn(process.execPath, [path.join(path.dirname(vitePackage), 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: path.join(repo, 'ui'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let outputBytes = 0;
    for (const stream of [vite.stdout, vite.stderr]) stream?.on('data', (bytes: Buffer) => { outputBytes += bytes.length; if (outputBytes > 1024 * 1024) vite?.kill('SIGTERM'); });
    await once(vite, 'spawn');
    const preview = `http://127.0.0.1:${port}`;
    const readyBy = Date.now() + 15_000;
    for (;;) {
      signal.throwIfAborted(); if (vite.exitCode !== null || outputBytes > 1024 * 1024) throw new Error('Preview server failed before readiness');
      try { if ((await fetch(preview + '/preview.html', { signal: AbortSignal.any([signal, AbortSignal.timeout(500)]) })).ok) break; }
      catch { signal.throwIfAborted(); }
      if (Date.now() > readyBy) throw new Error('Preview server readiness timed out'); await delay(100, undefined, { signal });
    }
    return { dir, root, project, skill, client, product: host.url, preview, close,
      reset: () => writeFile(file, jsonl(nativeRows(project, skill))),
      append: () => appendFile(file, jsonl([row('turn_context', { turn_id: nativeTurn, model: 'gpt-5.4', effort: 'low' }, 104_000), ...read(skill, 'synthetic-browser-read-four', 105_000), token('synthetic-browser-response-two', 110_000)])),
      current: async (): Promise<TimingLocalResult> => {
        const live = await client.live!({ query: { action: 'usage', roots: [root], scope: { allTime: true } }, mode: 'fresh' }, { signal });
        const snapshotId = live.result.snapshotRef.snapshotId;
        const threads = await client.live!({ query: { action: 'threads', roots: [root], snapshotId, scope: { allTime: true } }, mode: 'cached' }, { signal });
        const thread = threads.result.items.find(item => item.kind === 'thread'); if (!thread) throw new Error('Synthetic thread missing');
        const turns = await client.live!({ query: { action: 'turns', roots: [root], snapshotId, threadId: thread.id, scope: { allTime: true } }, mode: 'cached' }, { signal });
        const turn = turns.result.items.find(item => item.kind === 'turn'); if (!turn) throw new Error('Synthetic turn missing');
        const timing = await client.timing!({ action: 'summary', snapshotId, roots: [root], threadId: thread.id, turnId: turn.id, mode: 'cached', privacyProfile: 'local' }, { signal });
        if (timing.action !== 'summary' || timing.profile !== 'local') throw new Error('Synthetic timing missing'); return timing;
      },
    };
  } catch (error) { await close(); throw error; }
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;
