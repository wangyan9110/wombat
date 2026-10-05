import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {pathToFileURL} from 'node:url';

test('Windows archive tools use the native executable despite a shadowing PATH and fail if it is absent', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wombat-tool-selection-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const systemRoot = path.join(root, 'Windows'), shadow = path.join(root, 'Git', 'usr', 'bin');
  mkdirSync(path.join(systemRoot, 'System32'), {recursive: true}); mkdirSync(shadow, {recursive: true});
  const native = path.join(systemRoot, 'System32', 'tar.exe');
  writeFileSync(native, 'native'); writeFileSync(path.join(shadow, 'tar.exe'), 'shadow');
  const moduleUrl = new URL('./run-tool.ts', import.meta.url).href;
  const exercise = () => spawnSync(process.execPath, ['--input-type=module', '-e', `
    import {toolCommand} from ${JSON.stringify(moduleUrl)};
    Object.defineProperty(process, 'platform', {value: 'win32'});
    console.log(JSON.stringify(toolCommand('tar', ['-tzf', 'C:\\\\archive with spaces.tar.gz'])));
  `], {env: {...process.env, SystemRoot: systemRoot, PATH: shadow}, encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024});
  const valid = exercise(); assert.ifError(valid.error); assert.equal(valid.status, 0, valid.stderr);
  const selected = JSON.parse(valid.stdout);
  assert.equal(pathToFileURL(selected[0]).href, pathToFileURL(native).href);
  assert.deepEqual(selected[1], ['-tzf', 'C:\\archive with spaces.tar.gz']);
  rmSync(native);
  const invalid = exercise(); assert.ifError(invalid.error); assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Windows tar\.exe is required/);
});
