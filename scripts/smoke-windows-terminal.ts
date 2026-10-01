/** ConPTY acceptance on Windows: synthetic data, native Node CLI, resize and clean exit. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pty from 'node-pty';
import headless from '@xterm/headless';
assert.equal(process.platform, 'win32', 'This journey requires Windows ConPTY');
const dir = mkdtempSync(path.join(os.tmpdir(), 'wombat-conpty-'));
let child: pty.IPty | undefined;
try {
  const source = path.join(dir, 'source'); mkdirSync(path.join(source, 'sessions'), { recursive: true });
  const stamp = new Date().toISOString();
  writeFileSync(path.join(source, 'sessions/test.jsonl'), [
    { type: 'session_meta', payload: { id: 'synthetic-conpty' } },
    { type: 'turn_context', payload: { turn_id: 'turn', model: 'gpt-5.4', model_provider: 'openai' } },
    { timestamp: stamp, type: 'event_msg', payload: { type: 'token_usage_record', thread_id: 'synthetic-conpty', turn_id: 'turn', response_id: 'response', usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10, total_tokens: 110 } } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
  const screen = new headless.Terminal({ cols: 120, rows: 32, allowProposedApi: true });
  const env = { ...process.env, CODEX_HOME: source, WOMBAT_DATA_HOME: path.join(dir, 'data'), WOMBAT_LANG: 'en', WOMBAT_AUTO_PRICES: '0', TERM: 'xterm-256color' };
  child = pty.spawn(process.execPath, [path.resolve('dist/wombat.js')], { cols: 120, rows: 32, env, useConpty: true });
  let exit: number | undefined;
  child.onData(text => screen.write(text)); screen.onData(text => child!.write(text));
  child.onExit(event => { exit = event.exitCode; });
  const text = () => Array.from({ length: screen.rows }, (_, row) => screen.buffer.active.getLine(row)?.translateToString(true) ?? '').join('\n');
  const expect = async (label: string) => {
    const deadline = Date.now() + 15000;
    while (!text().includes(label) && exit === undefined && Date.now() < deadline) await delay(50);
    assert.ok(text().includes(label), `Expected ${label}: ${text()}`);
  };
  await expect('Daily report');
  for (const width of [40, 80, 120]) { screen.resize(width, 32); child.resize(width, 32); await delay(300); await expect('Daily report'); }
  child.write('g'); await expect('Weekly report'); child.write('q');
  const deadline = Date.now() + 10000;
  while (exit === undefined && Date.now() < deadline) await delay(50);
  assert.equal(exit, 0); screen.dispose();
  console.log(JSON.stringify({ platform: 'win32-x64', node: process.version, synthetic: true, widths: [40, 80, 120], periodSwitch: true, cleanExit: true }));
} finally { child?.kill(); rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 1000 }); }
