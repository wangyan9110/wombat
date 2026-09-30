import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePricingArgs } from '../src/prices-cli.js';
test('price commands accept only status/update and output flags', () => {
  assert.deepEqual(parsePricingArgs([]), { request: { action: 'status' }, json: false, help: false });
  assert.deepEqual(parsePricingArgs(['update', '--json']), { request: { action: 'update' }, json: true, help: false });
  for (const args of [['update', 'status'], ['--root', '/tmp'], ['--url', 'https://example.com'], ['--json', '--json'], ['update', '--model', 'gpt-6-sol']]) {
    assert.throws(() => parsePricingArgs(args), /无效价表参数/);
  }
});
