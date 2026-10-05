import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { consistencyErrors, validateVersion } from './prepare-release.ts';
import {
  actionPinErrors,
  type CiRun,
  repositorySlug,
  rootReadmeReleaseErrors,
  successfulCiRun,
} from './release-policy.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface Options {
  version: string;
  branch: string;
  repository?: string;
  json: boolean;
}

interface RepositoryView {
  defaultBranchRef: { name: string } | null;
  isArchived: boolean;
  nameWithOwner: string;
  url: string;
  visibility: string;
}

function usage(): never {
  throw new Error('Usage: corepack pnpm release:preflight -- --version <semver> [--branch main] [--repo owner/repo] [--json]');
}

export function parseArgs(argv: string[]): Options {
  const args = argv.filter(arg => arg !== '--');
  let version = '';
  let branch = 'main';
  let repository: string | undefined;
  let json = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json') json = true;
    else if (arg === '--version' || arg === '--branch' || arg === '--repo') {
      const value = args[++index];
      if (!value || value.startsWith('-')) usage();
      if (arg === '--version') version = value;
      else if (arg === '--branch') branch = value;
      else repository = value;
    } else usage();
  }
  if (!version) usage();
  validateVersion(version);
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith('/') || branch.endsWith('/')) {
    throw new Error(`Invalid release branch: ${branch}`);
  }
  if (repository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(`Invalid GitHub repository: ${repository}`);
  }
  return { version, branch, repository, json };
}

function command(program: string, args: string[], timeout = 60_000) {
  return spawnSync(program, args, {
    cwd: root,
    encoding: 'utf8',
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function required(program: string, args: string[], timeout?: number): string {
  const result = command(program, args, timeout);
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr.trim() || `exit ${result.status}`;
    throw new Error(`${program} ${args.join(' ')} failed: ${detail}`);
  }
  return result.stdout.trim();
}

function parsedJson(program: string, args: string[]): unknown {
  const output = required(program, args);
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
  const pkg: unknown = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!record(pkg) || typeof pkg.version !== 'string') throw new Error('package.json version is missing');
  const repository = typeof pkg.repository === 'string' ? pkg.repository
    : record(pkg.repository) && typeof pkg.repository.url === 'string' ? pkg.repository.url : undefined;
  if (!repository) throw new Error('package.json repository URL is missing');
  return { version: pkg.version, repository };
}

function repositoryView(repository: string): RepositoryView {
  const value = parsedJson('gh', [
    'repo', 'view', repository, '--json', 'defaultBranchRef,isArchived,nameWithOwner,url,visibility',
  ]);
  const defaultBranch = record(value) ? value.defaultBranchRef : undefined;
  if (!record(value) || typeof value.isArchived !== 'boolean' || typeof value.nameWithOwner !== 'string'
    || typeof value.url !== 'string' || typeof value.visibility !== 'string'
    || !(defaultBranch === null || (record(defaultBranch) && typeof defaultBranch.name === 'string'))) {
    throw new Error('gh repo view returned an invalid repository response');
  }
  const defaultBranchRef = defaultBranch === null ? null : { name: String(defaultBranch.name) };
  return {
    defaultBranchRef,
    isArchived: value.isArchived,
    nameWithOwner: value.nameWithOwner,
    url: value.url,
    visibility: value.visibility,
  };
}

function ciRuns(repository: string, source: string, branch: string): CiRun[] {
  const value = parsedJson('gh', [
    'run', 'list', '--repo', repository, '--workflow', 'ci.yml', '--commit', source, '--branch', branch,
    '--limit', '20', '--json', 'conclusion,event,headBranch,headSha,status,url',
  ]);
  if (!Array.isArray(value)) throw new Error('gh run list returned an invalid run list');
  return value.map((run, index) => {
    if (!record(run) || !['conclusion', 'event', 'headBranch', 'headSha', 'status', 'url']
      .every(field => typeof run[field] === 'string')) {
      throw new Error(`gh run list returned an invalid run at index ${index}`);
    }
    return {
      conclusion: String(run.conclusion), event: String(run.event), headBranch: String(run.headBranch),
      headSha: String(run.headSha), status: String(run.status), url: String(run.url),
    };
  });
}

function rejectInProgressGitOperation(): void {
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'rebase-merge', 'rebase-apply']) {
    const file = required('git', ['rev-parse', '--git-path', marker]);
    if (existsSync(path.resolve(root, file))) throw new Error(`Git operation is still in progress: ${marker}`);
  }
}

function assertReleaseAbsent(repository: string, tag: string): void {
  const result = command('gh', ['api', '--silent', `repos/${repository}/releases/tags/${tag}`]);
  if (result.status === 0) throw new Error(`GitHub Release already exists: ${tag}`);
  const detail = `${result.stdout}\n${result.stderr}`;
  if (!/HTTP 404|Not Found/i.test(detail)) {
    throw new Error(`Cannot confirm that GitHub Release ${tag} is absent: ${result.error?.message || result.stderr.trim() || `exit ${result.status}`}`);
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const pkg = packageMetadata();
  if (pkg.version !== options.version) {
    throw new Error(`Requested version ${options.version} does not match package.json ${pkg.version}`);
  }
  const consistency = consistencyErrors(root);
  if (consistency.length) throw new Error(consistency.join('\n'));

  const status = required('git', ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status) throw new Error(`Release preflight requires a clean working tree:\n${status}`);
  rejectInProgressGitOperation();

  const branch = required('git', ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (branch !== options.branch) throw new Error(`Release must start from ${options.branch}; current branch is ${branch}`);
  const source = required('git', ['rev-parse', 'HEAD']);
  const repository = options.repository ?? repositorySlug(pkg.repository);
  const readmeErrors = rootReadmeReleaseErrors({
    english: readFileSync(path.join(root, 'README.md'), 'utf8'),
    chinese: readFileSync(path.join(root, 'README.zh-CN.md'), 'utf8'),
  }, options.version, repository);
  if (readmeErrors.length) throw new Error(readmeErrors.join('\n'));
  const workflowRoot = path.join(root, '.github/workflows');
  const workflowErrors = actionPinErrors(Object.fromEntries(
    readdirSync(workflowRoot).filter(file => /\.ya?ml$/.test(file))
      .map(file => [`.github/workflows/${file}`, readFileSync(path.join(workflowRoot, file), 'utf8')]),
  ));
  if (workflowErrors.length) throw new Error(workflowErrors.join('\n'));
  const origin = required('git', ['remote', 'get-url', 'origin']);
  if (repositorySlug(origin) !== repository) throw new Error(`origin ${origin} does not match ${repository}`);

  const remoteLine = required('git', ['ls-remote', '--heads', 'origin', `refs/heads/${options.branch}`], 120_000);
  const remoteSource = remoteLine.split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(remoteSource)) throw new Error(`Remote branch origin/${options.branch} is missing`);
  if (remoteSource !== source) throw new Error(`HEAD ${source} does not match origin/${options.branch} ${remoteSource}`);

  const tag = `v${options.version}`;
  if (command('git', ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`]).status === 0) {
    throw new Error(`Local tag already exists: ${tag}`);
  }
  const remoteTag = required('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`], 120_000);
  if (remoteTag) throw new Error(`Remote tag already exists: ${tag}`);

  const repo = repositoryView(repository);
  if (repo.nameWithOwner.toLowerCase() !== repository.toLowerCase()) throw new Error(`GitHub resolved an unexpected repository: ${repo.nameWithOwner}`);
  if (repo.visibility !== 'PUBLIC') throw new Error(`GitHub repository must be public before release; visibility is ${repo.visibility}`);
  if (repo.isArchived) throw new Error('GitHub repository is archived');
  if (repo.defaultBranchRef?.name !== options.branch) {
    throw new Error(`GitHub default branch is ${repo.defaultBranchRef?.name ?? 'missing'}, expected ${options.branch}`);
  }
  assertReleaseAbsent(repository, tag);

  const runs = ciRuns(repository, source, options.branch);
  const ci = successfulCiRun(runs, source, options.branch);
  if (!ci) throw new Error(`No successful completed CI push run found for ${source} on ${options.branch}`);

  const evidence = {
    version: options.version,
    tag,
    source,
    branch: options.branch,
    repository,
    repositoryUrl: repo.url,
    ciUrl: ci.url,
    checks: ['version-consistency', 'root-readme-current', 'action-sha-pins', 'clean-tree', 'no-git-operation', 'origin-main', 'tag-absent',
      'release-absent', 'public-repository', 'successful-ci'],
  };
  if (options.json) console.log(JSON.stringify(evidence));
  else {
    console.log(`Release preflight passed for ${tag}.`);
    console.log(`Source: ${source}`);
    console.log(`Repository: ${repo.url}`);
    console.log(`CI: ${ci.url}`);
    console.log('No tag or Release was created.');
  }
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (entry === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
