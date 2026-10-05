import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { releaseArchive } from './github-release.ts';
import { nativeTargets } from './native-platforms.ts';
import { validateVersion } from './prepare-release.ts';
import { repositorySlug } from './release-policy.ts';
import { toolCommand } from './run-tool.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiVersion = '2026-03-10';
const managedReleaseFiles = new Set([
  'README.i18n.json', 'README.md', 'README.zh-CN.md',
  'cli/package.json', 'client/package.json', 'core/Cargo.lock', 'core/Cargo.toml',
  'docs/dependency-licenses.json', 'docs/guides/installation.en.md',
  'docs/guides/installation.i18n.json', 'docs/guides/installation.md',
  'install.sh', 'package.json', 'ui/package.json', 'web/package.json',
]);

export interface PublishOptions {
  version: string;
  branch: string;
  repository?: string;
}

export interface WorkflowRun {
  conclusion: string;
  databaseId: number;
  event: string;
  headBranch: string;
  headSha: string;
  status: string;
  url: string;
}

interface ReleaseView {
  assets: Array<{ name: string; size: number }>;
  isDraft: boolean;
  isImmutable: boolean;
  isPrerelease: boolean;
  tagName: string;
  url: string;
}

interface ReleaseSet {
  format: number;
  version: string;
  source: string;
  candidateOnly: boolean;
  targets: string[];
  assets: Array<{ archive: string; bytes: number; sha256: string; target: string }>;
}

function usage(): never {
  throw new Error('Usage: corepack pnpm release:publish -- --version <semver> [--branch main] [--repo owner/repo]');
}

export function parsePublishArgs(argv: string[]): PublishOptions {
  const args = argv.filter(arg => arg !== '--');
  let version = '';
  let branch = 'main';
  let repository: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg !== '--version' && arg !== '--branch' && arg !== '--repo') usage();
    const value = args[++index];
    if (!value || value.startsWith('-')) usage();
    if (arg === '--version') version = value;
    else if (arg === '--branch') branch = value;
    else repository = value;
  }
  if (!version) usage();
  validateVersion(version);
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith('/') || branch.endsWith('/')) {
    throw new Error(`Invalid release branch: ${branch}`);
  }
  if (repository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(`Invalid GitHub repository: ${repository}`);
  }
  return { version, branch, repository };
}

export function expectedReleaseAssets(): string[] {
  return [
    ...nativeTargets.map(releaseArchive),
    'SHA256SUMS', 'release-set.json', 'install.sh', 'install.ps1',
  ].sort();
}

export function selectWorkflowRun(
  runs: WorkflowRun[], source: string, headBranch: string,
): WorkflowRun | undefined {
  return runs.find(run => run.event === 'push' && run.headSha === source && run.headBranch === headBranch);
}

export function publishedReleaseErrors(view: ReleaseView, version: string): string[] {
  const tag = `v${version}`;
  const errors: string[] = [];
  if (view.tagName !== tag) errors.push(`Release tag is ${view.tagName}, expected ${tag}`);
  if (view.isDraft) errors.push('Release is still a draft');
  if (!view.isImmutable) errors.push('Release is not immutable');
  if (view.isPrerelease !== version.includes('-')) errors.push('Release prerelease state does not match the version');
  const actual = view.assets.map(asset => asset.name).sort();
  const expected = expectedReleaseAssets();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`Release assets differ: expected ${expected.join(', ')}, found ${actual.join(', ')}`);
  }
  for (const asset of view.assets) if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
    errors.push(`Release asset has an invalid size: ${asset.name}`);
  }
  return errors;
}

function stage(name: string): void {
  console.log(`\n=== ${name} ===`);
}

function command(program: string, args: string[], timeout = 60_000, inherit = false) {
  return spawnSync(...toolCommand(program, args), {
    cwd: root,
    encoding: inherit ? undefined : 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function failure(program: string, args: string[], result: ReturnType<typeof command>): string {
  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
  return result.error?.message || stderr || `exit ${String(result.status)}`;
}

function required(program: string, args: string[], timeout?: number): string {
  const result = command(program, args, timeout);
  if (result.error || result.status !== 0) {
    throw new Error(`${program} ${args.join(' ')} failed: ${failure(program, args, result)}`);
  }
  return String(result.stdout ?? '').trim();
}

function run(program: string, args: string[], timeout = 60_000): void {
  console.log(`+ ${program} ${args.join(' ')}`);
  const result = command(program, args, timeout, true);
  if (result.error || result.status !== 0) {
    throw new Error(`${program} ${args.join(' ')} failed: ${failure(program, args, result)}`);
  }
}

function parsedJson(program: string, args: string[], timeout?: number): unknown {
  const output = required(program, args, timeout);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${program} returned invalid JSON for ${args.join(' ')}`);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function packageMetadata(): { version: string; repository: string } {
  const value: unknown = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!record(value) || typeof value.version !== 'string') throw new Error('package.json version is missing');
  const repository = typeof value.repository === 'string' ? value.repository
    : record(value.repository) && typeof value.repository.url === 'string' ? value.repository.url : undefined;
  if (!repository) throw new Error('package.json repository URL is missing');
  return { version: value.version, repository };
}

function changedFiles(): string[] {
  const values = [
    required('git', ['diff', '--name-only', '-z']),
    required('git', ['diff', '--cached', '--name-only', '-z']),
    required('git', ['ls-files', '--others', '--exclude-standard', '-z']),
  ];
  return [...new Set(values.flatMap(value => value.split('\0')).filter(Boolean))].sort();
}

function assertBranch(branch: string): void {
  const current = required('git', ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (current !== branch) throw new Error(`Release must run from ${branch}; current branch is ${current}`);
}

function remoteRef(ref: string): string | undefined {
  const value = required('git', ['ls-remote', 'origin', ref], 120_000);
  if (!value) return undefined;
  const source = value.split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(source)) throw new Error(`Invalid remote ref response for ${ref}`);
  return source;
}

function workflowRuns(repository: string, workflow: string, source: string): WorkflowRun[] {
  const value = parsedJson('gh', [
    'run', 'list', '--repo', repository, '--workflow', workflow, '--commit', source, '--limit', '20',
    '--json', 'conclusion,databaseId,event,headBranch,headSha,status,url',
  ]);
  if (!Array.isArray(value)) throw new Error(`gh run list returned an invalid list for ${workflow}`);
  return value.map((item, index) => {
    if (!record(item) || typeof item.conclusion !== 'string' || typeof item.databaseId !== 'number'
      || typeof item.event !== 'string' || typeof item.headBranch !== 'string'
      || typeof item.headSha !== 'string' || typeof item.status !== 'string' || typeof item.url !== 'string') {
      throw new Error(`gh run list returned an invalid ${workflow} run at index ${index}`);
    }
    return item as unknown as WorkflowRun;
  });
}

function waitForRun(repository: string, workflow: string, source: string, headBranch: string): WorkflowRun {
  const deadline = Date.now() + 180_000;
  let selected: WorkflowRun | undefined;
  while (Date.now() < deadline) {
    selected = selectWorkflowRun(workflowRuns(repository, workflow, source), source, headBranch);
    if (selected) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3_000);
  }
  if (!selected) throw new Error(`No ${workflow} push run appeared for ${source} on ${headBranch}`);
  if (selected.status !== 'completed') {
    run('gh', ['run', 'watch', String(selected.databaseId), '--repo', repository, '--compact', '--exit-status'], 90 * 60_000);
    selected = selectWorkflowRun(workflowRuns(repository, workflow, source), source, headBranch);
  }
  if (!selected || selected.status !== 'completed' || selected.conclusion !== 'success') {
    throw new Error(`${workflow} did not complete successfully: ${selected?.url ?? 'unknown run'}`);
  }
  console.log(`${workflow}: ${selected.url}`);
  return selected;
}

function immutableReleasesEnabled(repository: string): void {
  const value = parsedJson('gh', [
    'api', '-H', 'Accept: application/vnd.github+json', '-H', `X-GitHub-Api-Version: ${apiVersion}`,
    `repos/${repository}/immutable-releases`,
  ]);
  if (!record(value) || value.enabled !== true) throw new Error('GitHub immutable Releases must be enabled before tagging');
}

function remoteTagSource(tag: string): string | undefined {
  const peeled = remoteRef(`refs/tags/${tag}^{}`);
  return peeled ?? remoteRef(`refs/tags/${tag}`);
}

function releaseView(repository: string, tag: string): ReleaseView {
  const value = parsedJson('gh', [
    'release', 'view', tag, '--repo', repository,
    '--json', 'assets,isDraft,isImmutable,isPrerelease,tagName,url',
  ]);
  if (!record(value) || !Array.isArray(value.assets) || typeof value.isDraft !== 'boolean'
    || typeof value.isImmutable !== 'boolean' || typeof value.isPrerelease !== 'boolean'
    || typeof value.tagName !== 'string' || typeof value.url !== 'string') {
    throw new Error('gh release view returned an invalid response');
  }
  const assets = value.assets.map((asset, index) => {
    if (!record(asset) || typeof asset.name !== 'string' || typeof asset.size !== 'number') {
      throw new Error(`gh release view returned an invalid asset at index ${index}`);
    }
    return { name: asset.name, size: asset.size };
  });
  return { ...value, assets } as ReleaseView;
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function verifyDownloadedRelease(directory: string, version: string, source: string): string[] {
  const value: unknown = JSON.parse(readFileSync(path.join(directory, 'release-set.json'), 'utf8'));
  if (!record(value) || value.format !== 1 || value.version !== version || value.source !== source
    || value.candidateOnly !== false || !Array.isArray(value.targets) || !Array.isArray(value.assets)) {
    throw new Error('Published release-set.json has an invalid release identity');
  }
  const set = value as unknown as ReleaseSet;
  if (JSON.stringify([...set.targets].sort()) !== JSON.stringify([...nativeTargets].sort())) {
    throw new Error(`Published targets differ: ${set.targets.join(', ')}`);
  }
  const identities = set.assets.map(asset => `${asset.target}:${asset.archive}`).sort();
  const expectedIdentities = nativeTargets.map(target => `${target}:${releaseArchive(target)}`).sort();
  if (JSON.stringify(identities) !== JSON.stringify(expectedIdentities)) {
    throw new Error(`Published release asset identities differ: ${identities.join(', ')}`);
  }
  const archives: string[] = [];
  for (const asset of set.assets) {
    if (!asset || typeof asset.archive !== 'string' || typeof asset.sha256 !== 'string'
      || typeof asset.bytes !== 'number' || typeof asset.target !== 'string') {
      throw new Error('Published release-set.json contains an invalid asset');
    }
    const file = path.join(directory, asset.archive);
    if (statSync(file).size !== asset.bytes || sha256(file) !== asset.sha256) {
      throw new Error(`Published archive hash or size mismatch: ${asset.archive}`);
    }
    archives.push(file);
  }
  const checksums = readFileSync(path.join(directory, 'SHA256SUMS'), 'utf8').trim().split('\n').sort();
  const expected = set.assets.map(asset => `${asset.sha256}  ${asset.archive}`).sort();
  if (JSON.stringify(checksums) !== JSON.stringify(expected)) throw new Error('Published SHA256SUMS differs from release-set.json');
  return archives;
}

async function cleanInstall(version: string, scratch: string, releaseDirectory: string): Promise<void> {
  const prefix = path.join(scratch, 'install');
  const baseUrl = pathToFileURL(releaseDirectory).href.replace(/\/$/, '');
  let entryFile: string;
  if (process.platform === 'win32') {
    run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'install.ps1'),
      '-Version', version, '-Prefix', prefix, '-BaseUrl', baseUrl], 10 * 60_000);
    const installRoot = path.join(prefix, 'lib', 'wombat');
    const releaseId = readFileSync(path.join(installRoot, 'current.txt'), 'utf8').trim();
    if (!/^[0-9A-Za-z._-]+$/.test(releaseId)) throw new Error('Windows installation pointer is invalid');
    const installed = path.join(installRoot, 'versions', releaseId);
    const runtime = path.join(installed, 'runtime', 'node.exe');
    entryFile = path.join(installed, 'lib', 'wombat.js');
    run(runtime, [entryFile, '--version', '--json']);
  } else {
    run('sh', [path.join(root, 'install.sh'), '--version', version, '--prefix', prefix, '--base-url', baseUrl], 10 * 60_000);
    const launcher = path.join(prefix, 'bin', 'wombat');
    run(launcher, ['--version', '--json']);
    const installRoot = path.join(prefix, 'lib', 'wombat');
    const releaseId = readFileSync(path.join(installRoot, 'current.txt'), 'utf8').trim();
    if (!/^[0-9A-Za-z._-]+$/.test(releaseId)) throw new Error('Installation pointer is invalid');
    entryFile = path.join(installRoot, 'versions', releaseId, 'lib', 'wombat.js');
  }
  const clientEntry = path.join(root, 'client', 'dist', 'index.js');
  if (!existsSync(clientEntry)) run('corepack', ['pnpm', '--filter', '@wombat/client', 'build'], 10 * 60_000);
  const { updateInstalled } = await import('../cli/src/update-cli.ts');
  const update = await updateInstalled({ version, check: true, entryFile, baseUrl });
  if (!update.checked || update.updated || update.updateAvailable
    || update.currentVersion !== version || update.availableVersion !== version) {
    throw new Error(`Clean update check returned an invalid result: ${JSON.stringify(update)}`);
  }
  console.log(JSON.stringify(update));
}

async function main(): Promise<void> {
  if (process.argv.slice(2).some(arg => arg === '-h' || arg === '--help')) {
    console.log('Usage: corepack pnpm release:publish -- --version <semver> [--branch main] [--repo owner/repo]');
    return;
  }
  const options = parsePublishArgs(process.argv.slice(2));
  const tag = `v${options.version}`;
  assertBranch(options.branch);
  run('gh', ['auth', 'status'], 60_000);

  let metadata = packageMetadata();
  const repository = options.repository ?? repositorySlug(metadata.repository);
  const origin = required('git', ['remote', 'get-url', 'origin']);
  if (repositorySlug(origin) !== repository) throw new Error(`origin ${origin} does not match ${repository}`);

  if (metadata.version !== options.version) {
    const dirty = changedFiles();
    if (dirty.length) throw new Error(`Start a new release from a clean tree; found: ${dirty.join(', ')}`);
    stage('Prepare version');
    run('corepack', ['pnpm', 'release:prepare', '--', '--version', options.version], 10 * 60_000);
    metadata = packageMetadata();
  }
  if (metadata.version !== options.version) throw new Error(`package.json remains at ${metadata.version}`);

  const existingTag = remoteTagSource(tag);
  let source: string;
  let ci: WorkflowRun;
  if (existingTag) {
    const dirty = changedFiles();
    if (dirty.length) throw new Error(`Resume an existing release from a clean tree; found: ${dirty.join(', ')}`);
    const remoteMain = remoteRef(`refs/heads/${options.branch}`);
    if (!remoteMain || command('git', ['merge-base', '--is-ancestor', existingTag, remoteMain]).status !== 0) {
      throw new Error(`${tag} source ${existingTag} is not on origin/${options.branch}`);
    }
    source = existingTag;
    stage('Resume existing immutable release identity');
    ci = waitForRun(repository, 'ci.yml', source, options.branch);
    immutableReleasesEnabled(repository);
  } else {
    let dirty = changedFiles();
    const unexpected = dirty.filter(file => !managedReleaseFiles.has(file));
    if (unexpected.length) throw new Error(`Release automation will not commit unrelated files: ${unexpected.join(', ')}`);
    const remoteMainBefore = remoteRef(`refs/heads/${options.branch}`);
    source = required('git', ['rev-parse', 'HEAD']);
    if (dirty.length || remoteMainBefore !== source) {
      stage('Local release gate');
      run('corepack', ['pnpm', 'release:prepare', '--', '--check'], 10 * 60_000);
      run('corepack', ['pnpm', 'release:check'], 90 * 60_000);
    }
    dirty = changedFiles();
    if (dirty.length) {
      stage('Commit release candidate');
      run('git', ['add', '--', ...dirty]);
      run('git', ['diff', '--cached', '--check']);
      run('git', ['commit', '-m', `Prepare ${tag}`]);
      source = required('git', ['rev-parse', 'HEAD']);
    }
    const remoteMain = remoteRef(`refs/heads/${options.branch}`);
    if (remoteMain !== source) {
      if (remoteMain && command('git', ['merge-base', '--is-ancestor', remoteMain, source]).status !== 0) {
        throw new Error(`Local ${options.branch} is not a fast-forward of origin/${options.branch}`);
      }
      stage('Push release candidate');
      run('git', ['push', 'origin', `${options.branch}:${options.branch}`], 5 * 60_000);
    }
    if (changedFiles().length) throw new Error('Working tree changed during release preparation');
    stage('Wait for exact-source CI');
    ci = waitForRun(repository, 'ci.yml', source, options.branch);
    immutableReleasesEnabled(repository);
    stage('Pre-tag verification');
    run('corepack', ['pnpm', 'release:preflight', '--', '--version', options.version, '--branch', options.branch, '--repo', repository], 5 * 60_000);
    stage('Create and push immutable release tag');
    if (command('git', ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`]).status !== 0) {
      run('git', ['tag', '-a', tag, '-m', `Wombat ${tag}`]);
    } else if (required('git', ['rev-list', '-n', '1', tag]) !== source) {
      throw new Error(`Local ${tag} does not point to ${source}`);
    }
    run('git', ['push', 'origin', `refs/tags/${tag}`], 5 * 60_000);
  }

  stage('Wait for GitHub Release');
  const releaseRun = waitForRun(repository, 'release.yml', source, tag);
  const view = releaseView(repository, tag);
  const releaseErrors = publishedReleaseErrors(view, options.version);
  if (releaseErrors.length) throw new Error(releaseErrors.join('\n'));

  stage('Verify published assets and attestations');
  run('gh', ['release', 'verify', tag, '--repo', repository], 5 * 60_000);
  const scratch = mkdtempSync(path.join(os.tmpdir(), `wombat-${tag}-`));
  try {
    const download = path.join(scratch, 'release');
    mkdirSync(download, { recursive: true });
    run('gh', ['release', 'download', tag, '--repo', repository, '--dir', download], 15 * 60_000);
    const archives = verifyDownloadedRelease(download, options.version, source);
    for (const archive of archives) {
      run('gh', ['attestation', 'verify', archive, '--repo', repository], 5 * 60_000);
    }
    stage('Clean install and update check');
    await cleanInstall(options.version, scratch, download);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  console.log(JSON.stringify({
    version: options.version, tag, source, repository, ciUrl: ci.url,
    releaseRunUrl: releaseRun.url, releaseUrl: view.url, immutable: view.isImmutable,
    assets: view.assets.map(asset => asset.name).sort(),
  }, null, 2));
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (entry === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
