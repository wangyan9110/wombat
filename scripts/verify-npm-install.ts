/** Verify a final archive in a clean directory without Rust, pnpm, or source dependencies. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { toolCommand } from './run-tool.ts';
const { values } = parseArgs({ options: { archive: { type: 'string' }, name: { type: 'string', default: '@wangyan9110/wombat' } } });
assert(values.archive, '--archive is required');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'wombat-final-install-'));
function run(program: string, args: string[], env: NodeJS.ProcessEnv, status = 0): string {
  const result = spawnSync(...toolCommand(program, args), { cwd: scratch, env, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  assert.ifError(result.error); assert.equal(result.status, status, result.stderr + result.stdout); return result.stdout;
}
try {
  const env = { ...process.env, WOMBAT_AUTO_PRICES: '0', WOMBAT_DATA_HOME: path.join(scratch, 'data'), CODEX_HOME: path.join(scratch, 'source'), NO_COLOR: '1' } as NodeJS.ProcessEnv;
  delete env.WOMBAT_CORE_BIN;
  run('npm', ['install', '--prefix', scratch, '--engine-strict', '--ignore-scripts', '--no-audit', '--no-fund', '--fetch-retries=0', '--fetch-timeout=15000', '--cache', path.join(scratch, 'cache'), path.resolve(values.archive)], env);
  const installed = path.join(scratch, 'node_modules', ...values.name!.split('/'));
  const metadata = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'));
  const cli = path.join(installed, 'dist/wombat.js');
  const query = (args: string[], status = 0) => JSON.parse(run(process.execPath, [cli, ...args, '--json'], env, status));
  assert.equal(query(['--version']).version, metadata.version);
  assert(existsSync(path.join(scratch, 'node_modules/.bin', process.platform === 'win32' ? 'wombat.cmd' : 'wombat')));
  assert.equal(query(['usage', '--cached'], 1).error.code, 'NO_SNAPSHOT');
  const sessions = path.join(env.CODEX_HOME!, 'sessions'); mkdirSync(sessions, { recursive: true });
  const file = path.join(sessions, 'synthetic.jsonl');
  const row = (id: string) => JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'token_usage_record', thread_id: 'thread', turn_id: 'turn', response_id: id, usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10, total_tokens: 110 } } }) + '\n';
  writeFileSync(file, JSON.stringify({ type: 'session_meta', payload: { id: 'thread' } })+'\n'+JSON.stringify({ type: 'turn_context', payload: { turn_id: 'turn', model: 'gpt-5.4', model_provider: 'openai' } })+'\n'+row('one'));
  const first = query(['usage', '--fresh']); assert.equal(first.summary.tokens.total, 110);
  const snapshot = query(['refresh']); assert.equal(snapshot.summary.tokens.total, 110);
  appendFileSync(file, row('two'));
  assert.equal(query(['usage', '--fresh']).summary.tokens.total, 220);
  assert.equal(query(['usage', '--snapshot', snapshot.snapshotRef.snapshotId]).summary.tokens.total, 110);
  assert.equal(query(['threads', '--fresh']).summary.tokens.total, 220);
  console.log(JSON.stringify({ package: metadata.name, version: metadata.version, target: process.platform+'-'+process.arch, install: true, live: true, append: true, fixedSnapshot: true }));
} finally { rmSync(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 1000 }); }
