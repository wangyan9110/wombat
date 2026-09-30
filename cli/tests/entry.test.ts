import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUsageArgs } from '../src/usage-app-cli.js';
import { supportsTerminalRuntime, terminalProcessArgs } from '../src/interactive.js';

test('only the implicit TTY entry opens the interface', () => {
  assert.equal(parseUsageArgs([], true).interactive, true);
  for (const args of [['--help'], ['--version'], ['--json'], ['usage'], ['refresh']]) {
    assert.equal(parseUsageArgs(args, true).interactive, false);
  }
  assert.equal(parseUsageArgs([], false).interactive, false);
});

test('interactive restart preserves the entry, loader and user arguments', () => {
  assert.deepEqual(terminalProcessArgs(['--import', 'tsx'], ['/node', '/wombat/cli/src/index.ts', '--timezone', 'Asia/Shanghai']),
    ['--import', 'tsx', '--experimental-ffi', '/wombat/cli/src/index.ts', '--timezone', 'Asia/Shanghai']);
  assert.deepEqual(terminalProcessArgs(['--no-experimental-ffi'], ['/node', '/wombat.js']), ['--experimental-ffi', '/wombat.js']);
  assert.equal(supportsTerminalRuntime('22.17.0'), false);
  assert.equal(supportsTerminalRuntime('26.3.1'), false);
  assert.equal(supportsTerminalRuntime('26.4.0'), true);
});
