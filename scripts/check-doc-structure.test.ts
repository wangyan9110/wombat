import assert from 'node:assert/strict';
import test from 'node:test';

import { audienceBoundaryErrors } from './check-doc-structure.ts';

test('keeps internal release operations out of user documentation', () => {
  assert.deepEqual(audienceBoundaryErrors({
    'README.md': '# Wombat\n\nInstall and open Wombat.\n',
    'docs/guides/installation.en.md': '# Install\n\nRun the installer.\n',
    'docs/development/workflow.en.md': '# Workflow\n\ncorepack pnpm release:publish\n',
  }), []);

  const errors = audienceBoundaryErrors({
    'README.md': '# Wombat\n\nSee .agents/skills/wombat-release for release-set.json.\n',
    'docs/guides/installation.en.md': '# Install\n\nRun corepack pnpm github:pack.\n',
  });
  assert.equal(errors.length, 3);
  assert.ok(errors.every(error => error.includes('internal release material')));
});
