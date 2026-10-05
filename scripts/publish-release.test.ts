import assert from 'node:assert/strict';
import test from 'node:test';

import {
  expectedReleaseAssets,
  parsePublishArgs,
  publishedReleaseErrors,
  selectWorkflowRun,
  type WorkflowRun,
} from './publish-release.ts';

test('parses one explicit release identity and rejects ambiguous input', () => {
  assert.deepEqual(parsePublishArgs(['--', '--version', '0.1.0-beta.1']), {
    version: '0.1.0-beta.1', branch: 'main', repository: undefined,
  });
  assert.deepEqual(parsePublishArgs(['--version', '1.0.0', '--branch', 'release', '--repo', 'owner/repo']), {
    version: '1.0.0', branch: 'release', repository: 'owner/repo',
  });
  assert.throws(() => parsePublishArgs(['--version', 'v1.0.0']));
  assert.throws(() => parsePublishArgs(['--version', '1.0.0', '--unknown']));
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
  const assets = expectedReleaseAssets().map(name => ({ name, size: 1 }));
  const view = {
    assets, isDraft: false, isImmutable: true, isPrerelease: true,
    tagName: 'v0.1.0-beta.1', url: 'https://github.com/owner/repo/releases/tag/v0.1.0-beta.1',
  };
  assert.deepEqual(publishedReleaseErrors(view, '0.1.0-beta.1'), []);
  assert.match(publishedReleaseErrors({ ...view, isImmutable: false }, '0.1.0-beta.1').join('\n'), /not immutable/);
  assert.match(publishedReleaseErrors({ ...view, assets: assets.slice(1) }, '0.1.0-beta.1').join('\n'), /assets differ/);
});
