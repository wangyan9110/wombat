// Prepare a platform-specific npm archive candidate without publishing it.
// The repository root remains private and is never uploaded.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, copyFileSync, chmodSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { npmReadme } from './npm-readme.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ args: process.argv.slice(2).filter(arg => arg !== '--'),
  options: { name: { type: 'string' }, 'public-ref': { type: 'string', default: 'main' } } });
const name = values.name;
if (!name) throw new Error('Usage: node scripts/prepare-npm-package.mjs --name @your-scope/wombat [--public-ref <tag-or-commit>]');
const publicRef = values['public-ref'];
npmReadme('', publicRef);
const validPart = '[a-z0-9][a-z0-9._~-]*';
if (name === 'wombat' || !new RegExp(`^(?:@${validPart}/)?${validPart}$`).test(name))
  throw new Error('Choose a valid npm name that you own; the unscoped wombat name is already occupied');
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('This initial npm package is verified only for macOS Apple Silicon');

function run(program, argv, options = {}) {
  const result = spawnSync(program, argv, {
    cwd: options.cwd ?? root, env: options.env ?? process.env, encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    timeout: 900_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== (options.status ?? 0))
    throw new Error(`${program} ${argv.join(' ')} failed: ${result.error?.message ?? (result.stderr || `exit ${result.status}`)}`);
  return result.stdout;
}
run('corepack', ['pnpm', 'release:check']);
const source = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const listing = JSON.parse(run('npm', ['pack', '--dry-run', '--ignore-scripts', '--json',
  '--cache', path.join(os.tmpdir(), 'wombat-npm-pack-cache')], { capture: true }));
if (listing.length !== 1) throw new Error('Expected one source package inventory');
const destination = path.join(root, 'dist', 'npm');
mkdirSync(destination, { recursive: true });
const output = mkdtempSync(path.join(destination, `${name.replace(/^@/, '').replace(/[^a-z0-9-]/g, '-')}-${source.version}-darwin-arm64-`));
const stage = path.join(output, 'package');
mkdirSync(stage);
let complete = false;
try {
  for (const { path: relative } of listing[0].files) {
    if (relative === 'package.json') continue;
    const from = path.resolve(root, relative);
    if (!from.startsWith(root + path.sep)) throw new Error(`Unsafe package path: ${relative}`);
    const to = path.join(stage, relative);
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
    chmodSync(to, statSync(from).mode & 0o777);
  }
  const metadata = {
    name, version: source.version,
    description: source.description,
    keywords: source.keywords,
    repository: source.repository,
    homepage: source.homepage,
    bugs: source.bugs,
    type: 'module', license: source.license,
    engines: source.engines,
    os: ['darwin'], cpu: ['arm64'],
    bin: { wombat: './dist/wombat.js' },
    files: source.files,
    dependencies: source.dependencies,
    publishConfig: { access: 'public' },
  };
  writeFileSync(path.join(stage, 'package.json'), JSON.stringify(metadata, null, 2) + '\n');
  for (const file of ['README.md', 'README.zh-CN.md']) {
    const destination = path.join(stage, file);
    writeFileSync(destination, npmReadme(readFileSync(destination, 'utf8'), publicRef));
  }
  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output,
    '--cache', path.join(output, '.npm-cache')], { cwd: stage, capture: true }));
  if (packed.length !== 1 || !packed[0].filename) throw new Error('npm pack produced no public archive');
  const archive = path.join(output, packed[0].filename);
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'wombat-npm-install-'));
  try {
    run('npm', ['install', '--engine-strict', '--ignore-scripts', '--no-audit', '--no-fund',
      '--fetch-retries=0', '--cache', path.join(scratch, 'npm-cache'), '--prefix', scratch, archive]);
    const installed = path.join(scratch, 'node_modules', ...name.split('/'));
    const cli = path.join(installed, 'dist', 'wombat.js');
    const binary = path.join(installed, 'dist', 'wombat-core');
    const command = path.join(scratch, 'node_modules', '.bin', 'wombat');
    if (![cli, binary, command].every(existsSync) || !(statSync(binary).mode & 0o111))
      throw new Error('Public npm archive did not install an executable CLI and core');
    const env = { ...process.env, CODEX_HOME: path.join(scratch, 'empty-source'),
      WOMBAT_DATA_HOME: path.join(scratch, 'empty-data'), NO_COLOR: '1' };
    delete env.WOMBAT_CORE_BIN;
    const version = JSON.parse(run(command, ['--version', '--json'], { cwd: scratch, env, capture: true }));
    if (version.version !== source.version) throw new Error('Installed npm package version mismatch');
    const result = JSON.parse(run(command, ['usage', '--cached', '--json'], { cwd: scratch, env, capture: true, status: 1 }));
    if (result.error?.code !== 'NO_SNAPSHOT') throw new Error('Installed npm package did not reach its core');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  rmSync(stage, { recursive: true, force: true });
  rmSync(path.join(output, '.npm-cache'), { recursive: true, force: true });
  complete = true;
  console.log(`npm archive candidate checked (not published): ${archive}\nPackage: ${name}@${source.version} · darwin/arm64`);
  console.log(`README links target ${publicRef}; public image accessibility must be verified before publication.`);
} finally {
  if (!complete) rmSync(output, { recursive: true, force: true });
}
