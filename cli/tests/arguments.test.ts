import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUsageArgs } from '../src/usage-app-cli.js';

test('v1 arguments enforce action-specific flags and exact independent filters', () => {
  assert.deepEqual(parseUsageArgs(['usage', '--since', '2026-09-29', '--until', '2026-09-30', '--model', 'gpt-5.4', '--effort', 'high', '--timezone', 'Asia/Shanghai', '--json']).request, { action: 'usage', scope: { since: '2026-09-29', until: '2026-09-30', timezone: 'Asia/Shanghai', model: 'gpt-5.4', reasoningEffort: 'high' } });
  assert.deepEqual(parseUsageArgs(['refresh', '--root', '/tmp/a', '--root=/tmp/b']).request, { action: 'refresh', roots: ['/tmp/a', '/tmp/b'] });
  assert.equal(parseUsageArgs(['--version']).version, true);
  assert.deepEqual(parseUsageArgs(['threads','--agent','codex','--source','s','--locate-thread','id']).request, { action:'threads',locateThreadId:'id',scope:{agentKind:'codex',sourceInstanceId:'s'} });
  assert.throws(() => parseUsageArgs(['--version', '--since', '2026-09-01']));
  assert.equal(parseUsageArgs([], true).interactive, true);
  assert.equal(parseUsageArgs([], false).request.action, 'usage');
  assert.equal(parseUsageArgs(['--json'], true).interactive, false);
  for (const args of [['usage', '--sort', 'recent'], ['threads', '--presentation', 'distribution'], ['usage', '--presentation', 'graph'], ['refresh', '--model', 'x'], ['usage', '--fresh', '--cached'], ['steps', '--thread', 'x'], ['turns'], ['threads', '--sort', 'time'], ['turns', '--thread', 'x', '--sort', 'recent'], ['refresh', '--agent', 'codex'], ['scan'], ['usage', '--limit', '501'], ['usage', '--limit', '1.5'], ['usage', '--offset', '-1'], ['usage', '--since', '2026-02-30'], ['usage', '--since', '2026-09-30', '--until', '2026-09-30'], ['usage', '--timezone', 'Not/AZone'], ['usage', '--model', 'a', '--model', 'b'], ['usage', '--json', '--json'], ['usage', 'other']])
    assert.throws(() => parseUsageArgs(args), args.join(' '));
});

test('distribution and cost sorting use the shared public request', () => {
  assert.deepEqual(parseUsageArgs(['usage','--presentation','distribution','--sort','cost']).request, { action: 'usage', presentation: 'distribution', sort: 'cost' });
  assert.equal(parseUsageArgs(['threads','--sort','cost']).request.sort, 'cost');
  assert.equal(parseUsageArgs(['turns','--thread','fixture','--sort','cost']).request.sort, 'cost');
});

test('unknown dimensions remain distinct from explicit names and dates', () => {
  assert.deepEqual(parseUsageArgs(['threads', '--model-unknown', '--effort-unknown', '--undated']).request.scope, { undated: true, modelUnknown: true, effortUnknown: true });
  assert.throws(() => parseUsageArgs(['threads', '--model-unknown', '--model', 'gpt-5.4']));
  assert.throws(() => parseUsageArgs(['usage', '--undated', '--since', '2026-09-29']));
});

test('live flags keep cached, fixed and watched queries distinct', () => {
  assert.equal(parseUsageArgs(['usage','--fresh']).mode,'fresh');
  assert.equal(parseUsageArgs(['usage','--cached']).mode,'cached');
  assert.equal(parseUsageArgs(['usage','--watch','--json']).watch,true);
  assert.equal(parseUsageArgs(['refresh','--verify']).verify,true);
  assert.deepEqual(parseUsageArgs(['usage','--root','/tmp/a']).request.roots,['/tmp/a']);
  for (const args of [['usage','--watch','--cached'],['usage','--snapshot','x','--fresh'],['threads','--watch'],['usage','--verify'],['refresh','--cached']]) assert.throws(()=>parseUsageArgs(args));
});
