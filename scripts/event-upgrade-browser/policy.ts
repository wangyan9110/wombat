import assert from 'node:assert/strict';
export interface Options { module: string; executable?: string }
export function options(args: string[], env: NodeJS.ProcessEnv): Options {
  const values = new Map<string, string>();
  if (args[0] === '--') args = args.slice(1);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!['--playwright-module', '--browser-executable'].includes(key) || values.has(key) || !value || value.startsWith('--'))
      throw new Error('Usage: pnpm verify:event-upgrade:browser -- --playwright-module PATH [--browser-executable PATH]');
    values.set(key, value);
  }
  const module = values.get('--playwright-module') ?? env.WOMBAT_PLAYWRIGHT_MODULE;
  if (!module) throw new Error('Playwright is required: pass --playwright-module PATH or WOMBAT_PLAYWRIGHT_MODULE; no browser checks were run');
  return { module, executable: values.get('--browser-executable') };
}
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function shareWhitelist(value: unknown, sensitive: string[]): void {
  assert.ok(record(value)); assert.equal(value.profile, 'share-v1');
  assert.deepEqual(Object.keys(value).sort(), ['action', 'basisCollections', 'capabilities', 'context', 'coverage', 'findings', 'freshness', 'methodVersion', 'outputVersion', 'privacy', 'profile', 'quality', 'relativeAnchors', 'scope', 'time', 'uses', 'work'].sort());
  const forbidden = new Set(['readView', 'snapshotId', 'sourceInstanceId', 'threadId', 'turnId', 'path', 'project', 'server', 'tool', 'title', 'name', 'objects', 'rows', 'cursor', 'nextCursor', 'objectRef', 'nativeId', 'callId', 'itemId', 'collectedAt', 'timestampMs', 'requestFingerprint', 'receiverOwner', 'operationId', 'afterFailurePredecessor', 'successfulReadPredecessors', 'readTargets']);
  const walk = (child: unknown) => {
    if (Array.isArray(child)) child.forEach(walk);
    else if (record(child)) for (const [key, entry] of Object.entries(child)) { assert.ok(!forbidden.has(key), `Share contains local ${key}`); walk(entry); }
  };
  walk(value);
  const text = JSON.stringify(value);
  for (const marker of sensitive) assert.ok(!text.includes(marker), `Share contains synthetic private marker ${marker}`);
}
