// Copied beside the release archive. Run with Node.js on the target machine.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bundle = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(bundle, 'release.json'), 'utf8'));
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === '--prefix'))
  throw new Error('Usage: node install.mjs [--prefix ABSOLUTE_DIRECTORY]');
const target = args.length ? path.resolve(args[1]) : path.join(os.homedir(), '.local', 'share', 'wombat');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 26 || (major === 26 && minor < 4))
  throw new Error('Wombat requires Node.js 26.4.0 or newer, including npm');
if (manifest.platform !== process.platform || manifest.arch !== process.arch)
  throw new Error(`This bundle targets ${manifest.platform}/${manifest.arch}; this machine is ${process.platform}/${process.arch}`);
const archive = path.join(bundle, manifest.archive);
const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
if (digest !== manifest.sha256) throw new Error('Release archive hash mismatch');
if (existsSync(target)) {
  const marker = path.join(target, 'wombat-install.json');
  if (!existsSync(marker)) throw new Error(`Refusing to replace an unrelated directory: ${target}`);
}
const parent = path.dirname(target);
mkdirSync(parent, { recursive: true });
const stage = mkdtempSync(path.join(parent, '.wombat-stage-'));
const cache = mkdtempSync(path.join(os.tmpdir(), 'wombat-npm-cache-'));
const backup = `${stage}-previous`;
let movedPrevious = false;
let installed = false;
function run(program, argv, options = {}) {
  const result = spawnSync(program, argv, {
    cwd: options.cwd ?? stage, env: options.env ?? process.env, encoding: 'utf8',
    timeout: 180_000, maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== (options.status ?? 0))
    throw new Error(`${program} failed: ${result.error?.message ?? (result.stderr + result.stdout).slice(-2000)}`);
  return result.stdout;
}
try {
  run('npm', ['install', '--global', '--ignore-scripts', '--engine-strict', '--no-audit', '--no-fund',
    '--fetch-retries=0', '--cache', cache, '--prefix', stage, archive]);
  const command = path.join(stage, 'bin', process.platform === 'win32' ? 'wombat.cmd' : 'wombat');
  if (!existsSync(command)) throw new Error('npm did not install the wombat command');
  const env = { ...process.env, CODEX_HOME: path.join(stage, 'empty-source'),
    WOMBAT_DATA_HOME: path.join(stage, 'empty-data'), NO_COLOR: '1' };
  delete env.WOMBAT_CORE_BIN;
  const version = JSON.parse(run(command, ['--version', '--json'], { env }));
  if (version.version !== manifest.version) throw new Error('Installed version mismatch');
  const noSnapshot = JSON.parse(run(command, ['usage', '--json'], { env, status: 1 }));
  if (noSnapshot.error?.code !== 'NO_SNAPSHOT') throw new Error('Installed core smoke failed');
  writeFileSync(path.join(stage, 'wombat-install.json'), JSON.stringify({
    version: manifest.version, platform: manifest.platform, arch: manifest.arch, sha256: manifest.sha256,
  }, null, 2) + '\n');
  if (existsSync(target)) { renameSync(target, backup); movedPrevious = true; }
  renameSync(stage, target);
  installed = true;
  const installedCommand = path.join(target, 'bin', process.platform === 'win32' ? 'wombat.cmd' : 'wombat');
  try {
    const installedEnv = { ...env, CODEX_HOME: path.join(target, 'empty-source'),
      WOMBAT_DATA_HOME: path.join(target, 'empty-data') };
    const afterMove = JSON.parse(run(installedCommand, ['usage', '--json'], { cwd: target, env: installedEnv, status: 1 }));
    if (afterMove.error?.code !== 'NO_SNAPSHOT') throw new Error('Installed core failed after placement');
  } catch (error) {
    rmSync(target, { recursive: true, force: true });
    installed = false;
    if (movedPrevious) { renameSync(backup, target); movedPrevious = false; }
    throw error;
  }
  if (movedPrevious) rmSync(backup, { recursive: true, force: true });
  console.log(`Wombat ${manifest.version} installed and verified: ${installedCommand}`);
  if (process.platform !== 'win32') console.log(`To use 'wombat' directly, add ${path.join(target, 'bin')} to PATH.`);
} catch (error) {
  if (movedPrevious && !installed && !existsSync(target)) renameSync(backup, target);
  throw error;
} finally {
  if (!installed) rmSync(stage, { recursive: true, force: true });
  rmSync(cache, { recursive: true, force: true });
}
