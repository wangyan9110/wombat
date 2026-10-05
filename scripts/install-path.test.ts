import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const installer = readFileSync(new URL('../install.sh', import.meta.url), 'utf8');
const functionMatch = installer.match(/(configure_path\(\) \{[\s\S]*?\n\})\nconfigure_path\n/);
const functionSource = functionMatch?.[1];
assert(functionSource, 'install.sh must expose the tested configure_path function');

test('POSIX installer retries every download error over HTTP/1.1', () => {
  assert.match(installer, /curl -fL --http1\.1 --retry 3 --retry-all-errors --retry-delay 2 --connect-timeout 15/);
  assert.equal(installer.match(/^download "\$base\//gm)?.length, 2);
});

function exercise(home: string, shell: string, modifyPath: boolean, prefix = path.join(home, '.local')): string {
  const script = `${functionSource}\nconfigure_path\n`;
  const file = path.join(home, 'path-test.sh'); writeFileSync(file, script);
  return execFileSync('sh', [file], {encoding: 'utf8', env: {
    HOME: home, SHELL: shell, PATH: '/usr/bin:/bin', bin_dir: path.join(prefix, 'bin'), prefix,
    modify_path: modifyPath ? '1' : '0',
  }});
}

test('POSIX installer adds the default bin directory once to the active shell profile', t => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'wombat-install-path-'));
  t.after(() => rmSync(home, {recursive: true, force: true}));
  exercise(home, '/bin/zsh', true); exercise(home, '/bin/zsh', true);
  const profile = readFileSync(path.join(home, '.zshrc'), 'utf8');
  assert.equal(profile.match(/# Wombat PATH/g)?.length, 1);
  assert.match(profile, /export PATH="\$HOME\/\.local\/bin:\$PATH"/);
});

test('POSIX installer respects path opt-out and does not edit profiles for custom prefixes', t => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'wombat-install-path-'));
  t.after(() => rmSync(home, {recursive: true, force: true}));
  assert.match(exercise(home, '/bin/bash', false), /Add .* to PATH/);
  assert.match(exercise(home, '/bin/bash', true, path.join(home, 'custom')), /Add .* to PATH/);
  assert.throws(() => readFileSync(path.join(home, '.bashrc'), 'utf8'), /ENOENT/);
});
