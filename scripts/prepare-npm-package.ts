// Build a universal npm candidate, or an explicitly labelled host-only test candidate.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { npmReadme } from './npm-readme.ts';
import { checkedSourceRevision, currentNativeTarget, inspectNative, nativeBinary, nativeTargets } from './native-platforms.ts';
import { toolCommand } from './run-tool.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ args: process.argv.slice(2).filter(arg => arg !== '--'), options: {
  name: { type: 'string' }, 'public-ref': { type: 'string', default: 'main' },
  'native-dir': { type: 'string' }, 'current-platform': { type: 'boolean', default: false },
} });
const name = values.name;
if (!name || name === 'wombat' || !/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(name))
  throw new Error('Supply --name with an npm package name you own');
if (Boolean(values['native-dir']) === values['current-platform'])
  throw new Error('Choose --native-dir <five-platform-artifacts> or --current-platform (local candidate only)');
const publicRef = values['public-ref']!;
npmReadme('', publicRef);
const host = currentNativeTarget();
function run(program: string, argv: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; status?: number; capture?: boolean } = {}): string {
  const result = spawnSync(...toolCommand(program, argv), {
    cwd: options.cwd ?? root, env: options.env ?? process.env, encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit', timeout: 900_000, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== (options.status ?? 0))
    throw new Error(`${program} failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  return result.stdout ?? '';
}
const source = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const revision = run('git', ['rev-parse', 'HEAD'], { capture: true }).trim();
const targets = values['current-platform'] ? [host] : [...nativeTargets];
const nativeDirectory = values['native-dir'] ? path.resolve(values['native-dir']) : undefined;
if (nativeDirectory) checkedSourceRevision();
// Fail before rebuilding when the matrix is incomplete or contains mixed revisions.
if (nativeDirectory) for (const target of targets) inspectNative(nativeDirectory, target, source.version, revision);
run('corepack', ['pnpm', 'release:check']);
const listing = JSON.parse(run('npm', ['pack', '--dry-run', '--ignore-scripts', '--json', '--cache', path.join(os.tmpdir(), 'wombat-npm-pack-cache')], { capture: true }));
if (listing.length !== 1) throw new Error('Expected one source package inventory');
const destination = path.join(root, 'dist/npm'); mkdirSync(destination, { recursive: true });
const output = mkdtempSync(path.join(destination, `${name.replace(/[^a-z0-9-]/g, '-')}-${source.version}-`));
const stage = path.join(output, 'package'); mkdirSync(stage);
let complete = false;
try {
  for (const { path: relative } of listing[0].files) {
    if (relative === 'package.json' || /^dist\/(?:native\/|wombat-core(?:\.exe)?$)/.test(relative)) continue;
    const from = path.resolve(root, relative);
    if (!from.startsWith(root + path.sep)) throw new Error(`Unsafe package path: ${relative}`);
    const to = path.join(stage, relative); mkdirSync(path.dirname(to), { recursive: true }); copyFileSync(from, to);
  }
  for (const target of targets) {
    const folder = path.join(stage, 'dist/native', target); mkdirSync(folder, { recursive: true });
    if (nativeDirectory) {
      for (const file of [nativeBinary(target), 'manifest.json', 'licenses/node-dependencies.txt', 'licenses/rust-dependencies.txt', 'licenses/inventory.json']) {
        const to = path.join(folder, file); mkdirSync(path.dirname(to), { recursive: true });
        copyFileSync(path.join(nativeDirectory, target, file), to);
      }
    }
    else copyFileSync(path.join(root, 'dist', nativeBinary(target)), path.join(folder, nativeBinary(target)));
    chmodSync(path.join(folder, nativeBinary(target)), 0o755);
  }
  chmodSync(path.join(stage, 'dist/wombat.js'), 0o755);
  const metadata = { name, version: source.version, description: source.description, keywords: source.keywords,
    repository: source.repository, homepage: source.homepage, bugs: source.bugs, type: 'module', license: source.license,
    engines: source.engines, os: [...new Set(targets.map(t => t.split('-')[0]))], cpu: [...new Set(targets.map(t => t.split('-')[1]))],
    bin: { wombat: './dist/wombat.js' }, files: [...source.files, 'dist/native/'], dependencies: source.dependencies,
    publishConfig: { access: 'public' }, wombat: { targets, source: revision, candidateOnly: values['current-platform'] },
  };
  writeFileSync(path.join(stage, 'package.json'), JSON.stringify(metadata, null, 2) + '\n');
  for (const file of ['README.md', 'README.zh-CN.md']) writeFileSync(path.join(stage, file), npmReadme(readFileSync(path.join(stage, file), 'utf8'), publicRef));
  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output, '--cache', path.join(output, '.npm-cache')], { cwd: stage, capture: true }));
  const archive = path.join(output, packed[0].filename);
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'wombat-npm-install-'));
  try {
    run('npm', ['install', '--engine-strict', '--ignore-scripts', '--no-audit', '--no-fund', '--fetch-retries=0', '--fetch-timeout=15000', '--cache', path.join(scratch, 'cache'), '--prefix', scratch, archive]);
    const installed = path.join(scratch, 'node_modules', ...name.split('/'));
    const cli = path.join(installed, 'dist/wombat.js');
    const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: path.join(scratch, 'source'), WOMBAT_DATA_HOME: path.join(scratch, 'data'), WOMBAT_AUTO_PRICES: '0', NO_COLOR: '1' }; delete env.WOMBAT_CORE_BIN;
    const query = (args: string[], status = 0) => JSON.parse(run(process.execPath, [cli, ...args, '--json'], { cwd: scratch, env, status, capture: true }));
    if (query(['--version']).version !== source.version) throw new Error('Installed version mismatch');
    if (query(['usage', '--cached'], 1).error?.code !== 'NO_SNAPSHOT') throw new Error('Packaged native core not reached');
    const live = query(['usage', '--fresh']);
    if (live.freshness?.status !== 'current' || live.summary.measurementCount !== 0) throw new Error('Packaged live service failed');
    run(process.execPath, ['--test', path.join(root, 'tests/e2e/web.test.ts')], { cwd: scratch, env: { ...env, WOMBAT_WEB_TEST_ENTRY: cli } });
    if (!existsSync(path.join(scratch, 'node_modules/.bin', process.platform === 'win32' ? 'wombat.cmd' : 'wombat'))) throw new Error('Missing command link');
  } finally { rmSync(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 1000 }); }
  rmSync(stage, { recursive: true, force: true }); rmSync(path.join(output, '.npm-cache'), { recursive: true, force: true });
  complete = true;
  console.log(`npm candidate checked, not published: ${archive}\nTargets: ${targets.join(', ')}; installed verification: ${host}\nREADME public reference: ${publicRef}`);
} finally { if (!complete) rmSync(output, { recursive: true, force: true }); }
