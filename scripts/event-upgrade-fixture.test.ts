import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserFixtureEpoch } from './event-upgrade-browser/calendar.ts';

test('browser samples stay in the real UTC budget month across calendar boundaries', () => {
  for (const [now, expected] of [
    ['2026-10-10T00:00:00Z', '2026-10-01T00:00:00Z'],
    ['2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z'],
    ['2027-01-01T00:00:00Z', '2027-01-01T00:00:00Z'],
    ['2028-02-29T23:59:59Z', '2028-02-01T00:00:00Z'],
    ['2026-10-31T23:30:00-02:00', '2026-11-01T00:00:00Z'],
  ]) {
    const clock = new Date(now),
      epoch = browserFixtureEpoch(clock);
    assert.equal(new Date(epoch).toISOString(), new Date(expected).toISOString());
    assert.equal(new Date(epoch + 120_000).getUTCMonth(), clock.getUTCMonth());
  }
  assert.throws(() => browserFixtureEpoch(new Date(NaN)), /Invalid/);
});
