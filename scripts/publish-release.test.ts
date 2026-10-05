import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

import {
  expectedReleaseAssets,
  parsePublishArgs,
  publishedReleaseErrors,
  selectWorkflowRun,
  type WorkflowRun,
  releaseRecoveryState,
} from './publish-release.ts';

test('parses one explicit release identity and rejects ambiguous input', () => {
  assert.deepEqual(parsePublishArgs([], '0.1.0-beta.1'), {
    version: '0.1.0-beta.1', branch: 'main', repository: undefined, status: false,
  });
  assert.deepEqual(parsePublishArgs(['--', '--version', '1.0.0', '--branch', 'release', '--repo', 'owner/repo', '--status'], '1.0.0'), {
    version: '1.0.0', branch: 'release', repository: 'owner/repo', status: true,
  });
  assert.throws(() => parsePublishArgs(['--version', 'v1.0.0']));
  assert.throws(() => parsePublishArgs(['--version', '1.0.0', '--unknown']));
  assert.throws(() => parsePublishArgs(['--version', '1.0.1'], '1.0.0'), /differs from package.json/);
  assert.throws(() => parsePublishArgs(['--version', '1.0.0', '--version', '1.0.0'], '1.0.0'), /Duplicate/);
});

test('the actual status entry permits only read operations and never treats network failures as absence', () => {
  const file = fileURLToPath(new URL('./publish-release.ts', import.meta.url));
  for (const networkFailure of [false, true]) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import childProcess from 'node:child_process';
      import {syncBuiltinESMExports} from 'node:module';
      import {pathToFileURL} from 'node:url';
      childProcess.spawnSync = (program, args) => {
        const key = program + ' ' + args.join(' ');
        const ok = stdout => ({status: 0, stdout, stderr: '', error: undefined});
        if (key === 'git symbolic-ref --quiet --short HEAD') return ok('main');
        if (key === 'git remote get-url origin') return ok('https://github.com/wangyan9110/wombat.git');
        if (key === 'git rev-parse HEAD') return ok('a'.repeat(40));
        if (['git diff --name-only -z', 'git diff --cached --name-only -z', 'git ls-files --others --exclude-standard -z'].includes(key)) return ok('');
        if (key === 'gh auth status') return ok('authenticated');
        if (program === 'gh' && args[0] === 'api' && /^(?:--silent )?repos\\/wangyan9110\\/wombat\\/(?:git\\/ref\\/tags|releases\\/tags)\\/v/.test(args.slice(1).join(' '))) {
          return {status: 1, stdout: '', stderr: ${networkFailure ? "'network unavailable'" : "'HTTP 404'"}};
        }
        throw new Error('Forbidden status operation: ' + key);
      };
      syncBuiltinESMExports();
      process.argv = [process.execPath, ${JSON.stringify(file)}, '--status'];
      await import(pathToFileURL(${JSON.stringify(file)}).href);
    `], {encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024});
    assert.ifError(result.error);
    assert.doesNotMatch(result.stderr, /Forbidden status operation/);
    if (networkFailure) {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /GitHub ref query failed: network unavailable/);
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /"recovery": "prepare"/);
    }
  }
});

test('selects only the exact push workflow run', () => {
  const run = (overrides: Partial<WorkflowRun>): WorkflowRun => ({
    conclusion: '', databaseId: 1, event: 'push', headBranch: 'main', headSha: 'a'.repeat(40),
    status: 'in_progress', url: 'https://github.com/owner/repo/actions/runs/1', ...overrides,
  });
  const expected = run({ databaseId: 4 });
  assert.equal(selectWorkflowRun([
    run({ databaseId: 2, event: 'workflow_dispatch' }),
    run({ databaseId: 3, headSha: 'b'.repeat(40) }),
    expected,
  ], 'a'.repeat(40), 'main'), expected);
});

test('requires the complete immutable release asset set', () => {
  const assets = expectedReleaseAssets().map(name => ({ name, size: 1, digest: `sha256:${'a'.repeat(64)}` }));
  const view = {
    assets, isDraft: false, isImmutable: true, isPrerelease: true,
    tagName: 'v0.1.0-beta.1', url: 'https://github.com/owner/repo/releases/tag/v0.1.0-beta.1',
  };
  assert.deepEqual(publishedReleaseErrors(view, '0.1.0-beta.1'), []);
  assert.match(publishedReleaseErrors({ ...view, isImmutable: false }, '0.1.0-beta.1').join('\n'), /not immutable/);
  assert.match(publishedReleaseErrors({ ...view, assets: assets.slice(1) }, '0.1.0-beta.1').join('\n'), /assets differ/);
});

test('resumes observed release states without replacing failed public identities', () => {
  const head = 'a'.repeat(40);
  const run: WorkflowRun = {headSha: head, headBranch: 'v1.0.0', databaseId: 1, event: 'push',
    conclusion: '', status: 'in_progress', url: 'https://example.test/run'};
  const release = {assets: [], isDraft: true, isImmutable: false, isPrerelease: false, tagName: 'v1.0.0', url: 'https://example.test/release'};
  assert.equal(releaseRecoveryState(head, undefined, undefined, undefined), 'prepare');
  assert.equal(releaseRecoveryState(head, head, undefined, undefined), 'wait');
  assert.equal(releaseRecoveryState(head, head, release, run), 'wait');
  assert.equal(releaseRecoveryState(head, head, {...release, isDraft: false}, {...run, status: 'completed', conclusion: 'success'}), 'verify');
  assert.throws(() => releaseRecoveryState(head, 'b'.repeat(40), undefined, run), /prepare a new version/);
  assert.throws(() => releaseRecoveryState(head, undefined, release, run), /without its remote tag/);
  for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
    assert.throws(() => releaseRecoveryState(head, head, release, {...run, status: 'completed', conclusion}), /do not retag/);
  }
  assert.throws(() => releaseRecoveryState(head, head, undefined, {...run, status: 'completed', conclusion: 'success'}), /no complete published Release/);
});
