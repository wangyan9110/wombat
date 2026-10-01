import { toolCommand } from './run-tool.ts';
// Verify the archive users install, using a temporary install and synthetic state.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const pkg = readJson('package.json');
const binary = process.platform === 'win32' ? 'wombat-core.exe' : 'wombat-core';
const digest = file => createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex');
const cargoVersion = readFileSync(path.join(root, 'core/Cargo.toml'), 'utf8')
  .match(/^version = "([^"]+)"$/m)?.[1];
for (const file of ['cli/package.json', 'client/package.json', 'tui/package.json']) {
  if (readJson(file).version !== pkg.version) throw new Error(`Version mismatch: ${file}`);
}
if (cargoVersion !== pkg.version) throw new Error('Version mismatch: core/Cargo.toml');
for (const file of [`dist/${binary}`, 'dist/wombat.js']) {
  if (!existsSync(path.join(root, file))) throw new Error(`Build first: missing ${file}`);
}
if (digest(`dist/${binary}`) !== digest(`core/target/release/${binary}`))
  throw new Error('Packaged core binary differs from the release build; run pnpm build');
for (const [source, packed] of [
  ['LICENSE', 'dist/licenses/wombat-MIT.txt'],
  ['THIRD_PARTY_NOTICES.md', 'dist/licenses/third-party-notices.md'],
  ['licenses/node-dependencies.txt', 'dist/licenses/node-dependencies.txt'],
  ['licenses/rust-dependencies.txt', 'dist/licenses/rust-dependencies.txt'],
]) {
  if (!existsSync(path.join(root, packed)) || digest(source) !== digest(packed))
    throw new Error(`Packaged notice is missing or stale: ${packed}; run pnpm build`);
}
if (process.platform !== 'win32' && !(statSync(path.join(root, `dist/${binary}`)).mode & 0o111))
  throw new Error(`dist/${binary} is not executable`);

function run(program, args, options = {}) {
  const result = spawnSync(...toolCommand(program, args), {
    cwd: options.cwd ?? root, env: options.env ?? process.env, encoding: 'utf8',
    input: options.input, timeout: options.timeout ?? 180_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== (options.status ?? 0)) {
    throw new Error(`${program} ${args.join(' ')} failed (exit ${result.status}): ${result.error?.message ?? (result.stderr + result.stdout).slice(-3000)}`);
  }
  return result.stdout;
}
const scratch = mkdtempSync(path.join(os.tmpdir(), 'wombat-package-check-'));
try {
  const pack = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch,
    '--cache', path.join(scratch, 'npm-cache')]));
  if (pack.length !== 1 || !pack[0].filename) throw new Error('npm pack did not produce one archive');
  const archive = path.join(scratch, pack[0].filename);
  const entries = new Set(pack[0].files.map(file => file.path));
  for (const file of ['dist/wombat.js', `dist/${binary}`, 'LICENSE',
    'THIRD_PARTY_NOTICES.md', 'dist/licenses/node-dependencies.txt', 'dist/licenses/rust-dependencies.txt']) {
    if (!entries.has(file)) throw new Error(`Archive is missing ${file}`);
  }
  const install = path.join(scratch, 'install');
  mkdirSync(install);
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--fetch-retries=0',
    '--fetch-timeout=15000', '--cache', path.join(scratch, 'npm-cache'), '--prefix', install, archive], {
    timeout: 180_000,
  });
  const installed = path.join(install, 'node_modules', pkg.name, 'dist', 'wombat.js');
  const installedCore = path.join(install, 'node_modules', pkg.name, 'dist', binary);
  const launcher = path.join(install, 'node_modules', '.bin', process.platform === 'win32' ? 'wombat.cmd' : 'wombat');
  if (!existsSync(installed) || !existsSync(installedCore) || !existsSync(launcher))
    throw new Error('Installed CLI, command link or core binary is missing');
  if (process.platform !== 'win32' && !(statSync(installedCore).mode & 0o111))
    throw new Error('Installed core binary is not executable');
  const env = {
    ...process.env,
    CODEX_HOME: path.join(scratch, 'empty-source'),
    WOMBAT_DATA_HOME: path.join(scratch, 'empty-data'),
    NO_COLOR: '1',
  };
  delete env.WOMBAT_CORE_BIN;
  const version = JSON.parse(run(process.execPath, [installed, '--version', '--json'], { cwd: install, env }));
  if (version.version !== pkg.version) throw new Error('Installed CLI version differs from package metadata');
  if (process.platform !== 'win32') {
    const commandVersion = JSON.parse(run(launcher, ['--version', '--json'], { cwd: install, env }));
    if (commandVersion.version !== pkg.version) throw new Error('Installed wombat command does not match the package');
  }
  const help = JSON.parse(run(process.execPath, [installed, '--help', '--json'], { cwd: install, env }));
  if (!help.commands?.includes('usage')) throw new Error('Installed CLI help is unavailable');
  const noSnapshot = JSON.parse(run(process.execPath, [installed, 'usage', '--cached', '--json'], { cwd: install, env, status: 1 }));
  if (noSnapshot.error?.code !== 'NO_SNAPSHOT') throw new Error('Installed CLI did not reach the packaged core');
  const live = JSON.parse(run(process.execPath, [installed, 'usage', '--fresh', '--json'], { cwd: install, env }));
  if (live.freshness?.status !== 'current' || live.summary?.measurementCount !== 0) throw new Error('Installed CLI live service failed');
  console.log(`Package verified: ${pack[0].filename}, ${entries.size} files, isolated install, CLI and core smoke passed (${process.platform}/${process.arch}). No publication performed.`);
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 1000 });
}
