import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkoutScope } from '../.agents/skills/wombat-review/scripts/scope.ts';
import { verificationPlan, verify } from '../.agents/skills/wombat-verify/scripts/verify.ts';

test('checkout inventory retains staged, unstaged and unusual untracked identities without mutation', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wombat-skill-scope-'));
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 });
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr); return result.stdout;
  };
  try {
    git('init', '-b', 'test');
    writeFileSync(path.join(root, 'tracked'), 'before\n'); git('add', 'tracked');
    git('-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-m', 'Synthetic baseline');
    writeFileSync(path.join(root, 'tracked'), 'staged\n'); git('add', 'tracked');
    writeFileSync(path.join(root, 'tracked'), 'unstaged\n');
    const untracked = process.platform === 'win32' ? 'space file' : 'space\nfile';
    writeFileSync(path.join(root, untracked), 'synthetic\n');
    const before = git('status', '--porcelain=v1', '-z');
    const scope = checkoutScope(root);
    assert.equal(scope.branch, 'test'); assert.equal(scope.tracking, null);
    assert.ok(scope.status.includes('?? ' + untracked));
    assert.deepEqual(scope.staged, ['M', 'tracked']); assert.deepEqual(scope.unstaged, ['M', 'tracked']);
    assert.equal(git('status', '--porcelain=v1', '-z'), before);
    git('checkout', '--detach'); assert.equal(checkoutScope(root).branch, null);
    const script = path.join(root, '.agents/skills/wombat-review/scripts/scope.ts');
    mkdirSync(path.dirname(script), { recursive: true });
    copyFileSync(fileURLToPath(new URL('../.agents/skills/wombat-review/scripts/scope.ts', import.meta.url)), script);
    const invoke = (args: string[]) => spawnSync(process.execPath, [script, ...args], {
      cwd: os.tmpdir(), encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
    });
    const independent = invoke([]); assert.ifError(independent.error);
    assert.equal(independent.status, 0, independent.stderr);
    assert.equal(JSON.parse(independent.stdout).head, scope.head);
    assert.equal(invoke(['--unknown']).status, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('checkout inventory fails outside a repository', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wombat-skill-missing-'));
  try { assert.throws(() => checkoutScope(root), /failed/); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test('verification enforces build prerequisites, rejects invalid scope, and stops dependent stages', () => {
  assert.deepEqual(verificationPlan('repository').map(stage => stage.args), [['pnpm', 'run', 'repo:check'], ['diff', '--check']]);
  const full = verificationPlan('full').map(stage => stage.args.at(-1));
  assert.deepEqual(full, ['build', 'typecheck', 'test', 'repo:check', '--check']);
  let invoked = 0;
  assert.throws(() => verify('unknown', () => { invoked++; })); assert.equal(invoked, 0);
  const visited: string[] = [];
  assert.throws(() => verify('full', stage => {
    visited.push(stage.args.at(-1)!);
    if (visited.length === 2) throw new Error('Synthetic type failure');
  }), /Stopped at/);
  assert.deepEqual(visited, ['build', 'typecheck']);
  assert.equal(verify('client', () => {}).length, 3);
});
