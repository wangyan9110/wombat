import assert from 'node:assert/strict';
import { test } from 'node:test';
import { options, shareWhitelist } from './event-upgrade-browser/policy.ts';
import { playwrightExport } from './event-upgrade-browser/playwright.ts';

test('browser runtime accepts maintained ESM and CommonJS export shapes and rejects incomplete APIs', () => {
  const api = { chromium: { launchServer() {}, connect() {} } };
  assert.equal(playwrightExport(api), api); assert.equal(playwrightExport({ default: api }), api);
  for (const value of [null, {}, { chromium: {} }, { default: { chromium: { launchServer() {} } } }])
    assert.throws(() => playwrightExport(value), /must export Playwright/);
});

test('browser acceptance requires an explicit Playwright module and rejects malformed options', () => {
  assert.deepEqual(options(['--', '--playwright-module', 'runtime/index.mjs', '--browser-executable', 'runtime/chromium'], {}), { module: 'runtime/index.mjs', executable: 'runtime/chromium' });
  assert.deepEqual(options([], { WOMBAT_PLAYWRIGHT_MODULE: 'runtime/index.mjs' }), { module: 'runtime/index.mjs', executable: undefined });
  assert.throws(() => options([], {}), /Playwright is required/);
  for (const args of [['--unknown', 'value'], ['--playwright-module'], ['--playwright-module', '--browser-executable'], ['--playwright-module', 'a', '--playwright-module', 'b']])
    assert.throws(() => options(args, {}), /Usage:/);
});

function share(): Record<string, unknown> {
  return { profile: 'share-v1', outputVersion: 2, action: 'summary', methodVersion: 'timing-1', basisCollections: [], privacy: {}, scope: {}, capabilities: {}, relativeAnchors: {}, time: {}, context: {}, work: {}, uses: {}, findings: [], coverage: {}, quality: {}, freshness: {} };
}
test('browser share oracle accepts its closed aggregate shape and rejects local fields or private content', () => {
  shareWhitelist(share(), ['SYNTHETIC_PRIVATE']);
  for (const key of ['path', 'snapshotId', 'threadId', 'server', 'tool', 'title', 'objects', 'rows', 'nextCursor', 'nativeId']) {
    const value = share(); value.uses = { nested: [{ [key]: 'synthetic-local-value' }] };
    assert.throws(() => shareWhitelist(value, []), /Share contains local/);
  }
  const extra = share(); extra.unreviewed = 1; assert.throws(() => shareWhitelist(extra, []));
  const privateValue = share(); privateValue.findings = [{ note: 'SYNTHETIC_PRIVATE' }]; assert.throws(() => shareWhitelist(privateValue, ['SYNTHETIC_PRIVATE']), /private marker/);
  const wrongProfile = share(); wrongProfile.profile = 'local'; assert.throws(() => shareWhitelist(wrongProfile, []));
});
