import test from 'node:test';
import assert from 'node:assert/strict';
import { CoreError, type TimingRequest, type TimingResult } from '@wombat/client';
import { runTimingCli, timingErrorOutput } from '../src/timing-cli.js';
import { runUsageCli, usageHelp } from '../src/usage-app-cli.js';
import { local, share, capabilityResult } from './timing-fixtures.js';

const target = ['--thread', 'thread', '--turn', 'turn'];
function capture() {
  const out: string[] = [], err: string[] = [];
  return { out, err, stdout: (text: string) => { out.push(text); }, stderr: (text: string) => { err.push(text); } };
}
test('timing runner emits exactly one unmodified JSON projection and uses only the offline typed transport', async () => {
  for (const [args, response] of [[target, local], [[...target, '--share'], share], [['capabilities'], capabilityResult]] as const) {
    const io = capture(); let calls = 0;
    const code = await runTimingCli([...args], { ...io, createClient: options => {
      assert.deepEqual(options, { automaticPrices: false });
      return { timing: async (request, query) => {
        calls++; assert.equal(request.action, response.action); assert.ok(query?.signal);
        query?.onProgress?.('private-source-path'); return response;
      } };
    } });
    assert.equal(code, response.action === 'summary' ? 2 : 0); assert.equal(calls, 1);
    assert.equal(io.out.length, 1); assert.equal(io.out[0], JSON.stringify(response) + '\n');
    assert.equal(io.err.length, 1); assert.doesNotMatch(io.err.join(''), /private-source-path/);
  }
});
test('CLI evidence follows the caller supplied fixed snapshot and cursor without advancing or reparsing it', async () => {
  const io = capture(), seen: TimingRequest[] = [];
  const response: TimingResult = { outputVersion: 6, action: 'evidence', collection: 'turn_events', methodVersion: local.methodVersion, profile: 'local', snapshotId: 'live:scope:fixed',
    scope: local.scope, total: { value: 3, status: 'observed', basis: 'safe_event_count', evidenceRefs: [] }, rows: [], nextCursor: { token: 'next-page' } };
  const host = { ...io, createClient: () => ({ timing: async (request: TimingRequest) => { seen.push(request); return response; } }) };
  assert.equal(await runTimingCli(['evidence', ...target, '--snapshot', response.snapshotId, '--limit', '1'], host), 0);
  assert.equal(await runTimingCli(['evidence', ...target, '--snapshot', response.snapshotId, '--limit', '1', '--cursor', 'next-page'], host), 0);
  assert.ok(seen[0].action === 'evidence' && seen[1].action === 'evidence');
  assert.equal(seen[0].snapshotId, seen[1].snapshotId); assert.deepEqual(seen[1].cursor, { token: 'next-page' });
  assert.equal(JSON.parse(io.out[1]).nextCursor.token, 'next-page');
});
test('invalid arguments help and safe errors require no source or service operation', async () => {
  for (const [args, expected] of [[[], 1], [['--help'], 0], [['capabilities', '--root', '/private/canary'], 1], [['--lang', 'bad', ...target], 1]] as const) {
    const io = capture(); let called = false;
    assert.equal(await runTimingCli([...args], { ...io, createClient: () => { called = true; throw new Error('must not run'); } }), expected);
    assert.equal(called, false); const output = JSON.parse(io.out.join(''));
    assert.equal(output.outputVersion, 1); assert.doesNotMatch(io.out.join(''), /private\/canary|must not run/);
  }
  const error = timingErrorOutput(new CoreError('/private/canary', 'private contents', { path: '/private/canary' }));
  assert.equal(error.error.code, 'INTERNAL_ERROR'); assert.doesNotMatch(JSON.stringify(error), /private|contents|path/);
});
test('operation errors and cancellation have safe v1 envelopes with complete signal cleanup', async () => {
  const before = ['SIGINT', 'SIGTERM'].map(name => process.listenerCount(name));
  for (const [error, expected] of [[new CoreError('NOT_FOUND', '/private/canary'), 1], [new CoreError('VIEW_EXPIRED', '/private/canary'), 1], [new CoreError('CANCELLED', '/private/canary'), 130]] as const) {
    const io = capture();
    assert.equal(await runTimingCli(target, { ...io, createClient: () => ({ timing: async () => { throw error; } }) }), expected);
    const result = JSON.parse(io.out.join('')); assert.equal(result.outputVersion, 1); assert.equal(result.error.code, error.code);
    assert.doesNotMatch(io.out.join(''), /private\/canary/);
  }
  const controller = new AbortController(), io = capture();
  assert.equal(await runTimingCli(target, { ...io, signal: controller.signal, createClient: () => ({ timing: async () => { controller.abort(); return local; } }) }), 130);
  assert.equal(JSON.parse(io.out.join('')).error.code, 'CANCELLED'); assert.doesNotMatch(io.out.join(''), /readView/);
  assert.deepEqual(['SIGINT', 'SIGTERM'].map(name => process.listenerCount(name)), before);
});
test('explicit text localizes human copy while default JSON keeps protocol values', async () => {
  for (const [language, expected] of [['en', 'Whole-turn timing'], ['zh', '整轮耗时']] as const) {
    const io = capture();
    assert.equal(await runTimingCli([...target, '--text', '--lang', language], { ...io, createClient: () => ({ timing: async () => local }) }), 2);
    assert.match(io.out.join(''), new RegExp(expected)); assert.doesNotMatch(io.out.join(''), /"outputVersion"/);
  }
});
test('pre-cancelled calls do not start a host and SIGINT cancels only the current request', async () => {
  const stopped = new AbortController(); stopped.abort();
  const first = capture(); let started = false;
  assert.equal(await runTimingCli(target, { ...first, signal: stopped.signal, createClient: () => {
    started = true; return { timing: async () => local };
  } }), 130);
  assert.equal(started, false); assert.equal(JSON.parse(first.out.join('')).error.code, 'CANCELLED');
  const second = capture(); const before = process.listenerCount('SIGINT');
  assert.equal(await runTimingCli(target, { ...second, createClient: () => ({ timing: async (_request, options) => {
    assert.equal(options?.signal?.aborted, false);
    process.emit('SIGINT');
    assert.equal(options?.signal?.aborted, true);
    throw new CoreError('CANCELLED', '/private/canary');
  } }) }), 130);
  assert.equal(process.listenerCount('SIGINT'), before);
  assert.equal(JSON.parse(second.out.join('')).error.code, 'CANCELLED');
  assert.doesNotMatch(second.out.join(''), /private\/canary|readView/);
});
test('public dispatch includes timing and language errors retain its default safe JSON envelope', async () => {
  const writes: string[] = [], original = process.stdout.write;
  process.stdout.write = ((text: string | Uint8Array) => { writes.push(String(text)); return true; }) as typeof original;
  try {
    assert.equal(await runUsageCli(['timing', ...target, '--lang', 'bad']), 1);
    assert.equal(JSON.parse(writes.pop()!).outputVersion, 1);
    assert.equal(await runUsageCli(['--lang', 'en', 'timing', '--help']), 0);
    assert.match(JSON.parse(writes.pop()!).help, /wombat timing evidence/);
    assert.match(usageHelp(), /wombat timing/);
  } finally { process.stdout.write = original; }
});
