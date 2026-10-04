/** Extract and exercise the exact GitHub Release archive for the current platform. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {hashFile, inventory} from './artifact-files.ts';
import {releaseNodeVersion, type GitHubReleaseSet} from './github-release.ts';
import {nodeRuntimeBinary} from './native-platforms.ts';
import {toolCommand} from './run-tool.ts';

const {values} = parseArgs({options: {set: {type: 'string'}}});
assert(values.set, '--set is required');
const setFile = path.resolve(values.set);
const set: GitHubReleaseSet = JSON.parse(readFileSync(setFile, 'utf8'));
assert.equal(set.format, 1);
assert.equal(set.assets.length, set.targets.length);
const target = process.platform + '-' + process.arch;
const asset = set.assets.find(item => item.target === target);
assert(asset, `Release set does not contain ${target}`);
for (const item of set.assets) {
  assert.equal(path.basename(item.archive), item.archive);
  const archive = path.join(path.dirname(setFile), item.archive);
  assert.equal(hashFile(archive), item.sha256, `Archive hash mismatch: ${item.archive}`);
}

const scratch = mkdtempSync(path.join(os.tmpdir(), 'wombat-github-release-'));
try {
  const archive = path.join(path.dirname(setFile), asset.archive);
  const unpackedAt = performance.now();
  const unpack = spawnSync(...toolCommand('tar', ['-xzf', archive, '-C', scratch]), {encoding: 'utf8', timeout: 120_000});
  assert.ifError(unpack.error); assert.equal(unpack.status, 0, unpack.stderr);
  const installMs = Math.round(performance.now() - unpackedAt);
  const installed = path.join(scratch, 'wombat');
  const cli = path.join(installed, 'lib', 'wombat.js');
  const core = path.join(installed, 'lib', process.platform === 'win32' ? 'wombat-core.exe' : 'wombat-core');
  const runtime = path.join(installed, 'runtime', nodeRuntimeBinary(target));
  const launcher = path.join(installed, 'bin', process.platform === 'win32' ? 'wombat.cmd' : 'wombat');
  assert(existsSync(cli)); assert(existsSync(core)); assert(existsSync(runtime)); assert(existsSync(launcher));
  const release = JSON.parse(readFileSync(path.join(installed, 'release.json'), 'utf8'));
  assert.deepEqual({version: release.version, source: release.source, sourceSha256: release.sourceSha256, target: release.target, runtime: release.runtime},
    {version: set.version, source: set.source, sourceSha256: set.sourceSha256, target, runtime: {name: 'node', version: releaseNodeVersion}});

  const env: NodeJS.ProcessEnv = {
    ...process.env, WOMBAT_AUTO_PRICES: '0', WOMBAT_DATA_HOME: path.join(scratch, 'data'),
    CODEX_HOME: path.join(scratch, 'source'), NO_COLOR: '1', PATH: '',
  };
  delete env.WOMBAT_CORE_BIN; delete env.NODE_OPTIONS; delete env.NODE_PATH;
  const run = (program: string, args: string[], status = 0, runEnv = env) => {
    const result = spawnSync(program, args, {cwd: scratch, env: runEnv, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
      windowsVerbatimArguments: process.platform === 'win32' && /cmd\.exe$/i.test(program)});
    assert.ifError(result.error); assert.equal(result.status, status, result.stderr + result.stdout); return result.stdout;
  };
  const query = (args: string[], status = 0) => JSON.parse(run(runtime, [cli, ...args, '--json'], status));
  assert.equal(query(['--version']).version, set.version);
  assert.equal(query(['usage', '--cached'], 1).error.code, 'NO_SNAPSHOT');
  const sessions = path.join(env.CODEX_HOME!, 'sessions'); mkdirSync(sessions, {recursive: true});
  const log = path.join(sessions, 'synthetic.jsonl');
  const row = (id: string) => JSON.stringify({timestamp: new Date().toISOString(), type: 'event_msg', payload: {type: 'token_usage_record', thread_id: 'thread', turn_id: 'turn', response_id: id, usage: {input_tokens: 100, cached_input_tokens: 0, output_tokens: 10, total_tokens: 110}}}) + '\n';
  writeFileSync(log, JSON.stringify({type: 'session_meta', payload: {id: 'thread'}}) + '\n' + JSON.stringify({type: 'turn_context', payload: {turn_id: 'turn', model: 'gpt-5.4', model_provider: 'openai'}}) + '\n' + row('one'));
  assert.equal(query(['usage', '--fresh']).summary.tokens.total, 110);
  const snapshot = query(['refresh']); appendFileSync(log, row('two'));
  assert.equal(query(['usage', '--fresh']).summary.tokens.total, 220);
  assert.equal(query(['usage', '--snapshot', snapshot.snapshotRef.snapshotId]).summary.tokens.total, 110);
  assert.equal(query(['threads', '--fresh']).summary.tokens.total, 220);

  if (process.platform === 'win32') {
    const command = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe');
    assert.equal(JSON.parse(run(command, ['/d', '/s', '/c', `""${launcher}" --version --json"`])).version, set.version);
  } else assert.equal(JSON.parse(run(launcher, ['--version', '--json'])).version, set.version);

  run(process.execPath, ['--test', fileURLToPath(new URL('../tests/e2e/web.test.ts', import.meta.url))], 0,
    {...env, WOMBAT_WEB_TEST_ENTRY: cli, WOMBAT_WEB_TEST_CORE: core, WOMBAT_WEB_TEST_NODE: runtime});
  console.log(JSON.stringify({version: set.version, source: set.source, target, runtime: run(runtime, ['--version']).trim(),
    archive: asset.archive, archiveBytes: asset.bytes, installedBytes: inventory(installed).reduce((total, file) => total + file.size, 0),
    extractMs: installMs, launcher: true, emptyAppPath: true, live: true, append: true, fixedSnapshot: true, web: true}));
} finally {
  rmSync(scratch, {recursive: true, force: true, maxRetries: 20, retryDelay: 500});
}
