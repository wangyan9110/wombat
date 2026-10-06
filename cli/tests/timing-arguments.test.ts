import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseTimingArgs } from '../src/timing-cli.js';

const target = ['--thread', 'thread', '--turn', 'turn'];
test('timing summary is the default JSON operation with explicit text and sharing', () => {
  const base = parseTimingArgs(target);
  assert.equal(base.format, 'json'); assert.equal(base.help, false);
  assert.deepEqual(base, parseTimingArgs(['summary', ...target, '--json']));
  const invocation = parseTimingArgs([...target, '--text', '--share', '--root', 'one', '--root=two', '--source', 'source', '--cached']);
  assert.equal(invocation.format, 'text'); assert.equal(invocation.help, false);
  if (!invocation.help && invocation.request.action === 'summary') {
    assert.equal(invocation.request.mode, 'cached'); assert.equal(invocation.request.privacyProfile, 'share-v1');
    assert.deepEqual(invocation.request.roots, [path.resolve('one'), path.resolve('two')]);
    assert.deepEqual(invocation.request.scope, { sourceInstanceId: 'source' });
  } else assert.fail('expected summary');
});
test('evidence retains exact snapshot target source and an opaque page cursor', () => {
  const invocation = parseTimingArgs(['evidence', ...target, '--snapshot', 'live:scope:fixed', '--limit', '200', '--cursor', 'opaque', '--root', 'one', '--source', 'source']);
  assert.equal(invocation.format, 'json');
  if (!invocation.help && invocation.request.action === 'evidence') {
    assert.equal(invocation.request.snapshotId, 'live:scope:fixed'); assert.equal(invocation.request.limit, 200);
    assert.deepEqual(invocation.request.cursor, { token: 'opaque' });
    assert.deepEqual(invocation.request.scope, { sourceInstanceId: 'source' });
    assert.deepEqual(invocation.request.roots, [path.resolve('one')]);
  } else assert.fail('expected evidence');
  const defaultPage = parseTimingArgs(['evidence', ...target, '--snapshot', 'stored']);
  assert.ok(!defaultPage.help && defaultPage.request.action === 'evidence'); assert.equal(defaultPage.request.limit, 50);
});
test('capabilities has no target source paths or selection mode', () => {
  assert.deepEqual(parseTimingArgs(['capabilities']), { help: false, format: 'json', request: { action: 'capabilities', privacyProfile: 'local' } });
  assert.deepEqual(parseTimingArgs(['capabilities', '--share', '--text']), { help: false, format: 'text', request: { action: 'capabilities', privacyProfile: 'share-v1' } });
  for (const args of [target, ['--root', 'one'], ['--source', 'source'], ['--snapshot', 'stored'], ['--fresh'], ['--cached'], ['--cursor', 'token'], ['--limit', '1']])
    assert.throws(() => parseTimingArgs(['capabilities', ...args]), { code: 'INVALID_ARGUMENT' });
});
test('timing rejects missing identities ambiguous formats and whole-turn fragmentation', () => {
  for (const args of [
    [], ['--thread', 'thread'], ['--turn', 'turn'], ['evidence', ...target],
    [...target, '--json', '--text'], [...target, '--fresh', '--cached'], [...target, '--fresh', '--snapshot', 'stored'],
    [...target, '--thread', 'other'], [...target, '--root'], [...target, '--json=true'], [...target, '--share=true'],
    [...target, '--limit', '1'], [...target, '--cursor', 'token'], [...target, '--since', '2026-10-01'],
    [...target, '--until', '2026-10-02'], [...target, '--timezone', 'UTC'], [...target, '--offset', '0'],
    [...target, '--cost', '0'], [...target, '--tokens', '1'], [...target, '--verify'], [...target, '--watch'],
    ['compare', ...target], ['evidence', ...target, '--snapshot', 'stored', '--share'],
    ['evidence', ...target, '--snapshot', 'stored', '--fresh'], ['evidence', ...target, '--snapshot', 'stored', '--cached'],
    ...['0', '201', '-1', '1.5', '9007199254740992'].map(limit => ['evidence', ...target, '--snapshot', 'stored', '--limit', limit]),
  ]) assert.throws(() => parseTimingArgs(args), { code: 'INVALID_ARGUMENT' }, args.join(' '));
});
test('help requires no fabricated business request', () => {
  assert.deepEqual(parseTimingArgs(['--help']), { help: true, format: 'json' });
  assert.deepEqual(parseTimingArgs(['evidence', '--help', '--text']), { help: true, format: 'text' });
});
test('object evidence keeps the fixed view and validates collection-specific selection', () => {
  const base = ['evidence', ...target, '--snapshot', 'fixed'];
  const result = parseTimingArgs([...base, '--collection', 'use_records', '--object', 'object-1', '--cursor', 'opaque']);
  assert.ok(!result.help && result.request.action === 'evidence');
  assert.equal(result.request.collection, 'use_records'); assert.equal(result.request.objectRef, 'object-1');
  assert.equal(result.request.snapshotId, 'fixed'); assert.deepEqual(result.request.cursor, { token: 'opaque' });
  const objects = parseTimingArgs([...base, '--collection', 'use_objects']);
  assert.ok(!objects.help && objects.request.action === 'evidence'); assert.equal(objects.request.collection, 'use_objects');
  for (const args of [
    [...base, '--object', 'object-1'], [...base, '--collection', 'use_objects', '--object', 'object-1'],
    [...base, '--collection', 'arbitrary'], [...target, '--collection', 'use_objects'],
    ['capabilities', '--collection', 'use_records'],
  ]) assert.throws(() => parseTimingArgs(args), { code: 'INVALID_ARGUMENT' });
});
