import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfigArgs } from '../src/config-cli.js';
test('configuration arguments preserve scope and reject ambiguous flags', () => {
  const result = parseConfigArgs(['--root','/one','--root=/two','--project-root','/project','--kind','skill','--json']);
  assert.deepEqual(result.request.roots, ['/one','/two']);
  assert.deepEqual(result.request.projectRoots, ['/project']);
  assert.equal(result.request.kind, 'skill'); assert.equal(result.json, true);
  for (const args of [['--json=true'], ['--limit','0'], ['--limit','201'], ['--offset','1.5'], ['--kind','unknown'], ['--sort','name','--sort','size'], ['--write'], ['--project-root']]) assert.throws(() => parseConfigArgs(args));
});
