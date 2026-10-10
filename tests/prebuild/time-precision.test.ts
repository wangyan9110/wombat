import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rfc3339Nanos } from '../helpers/rfc3339.ts';

test('Rust cutoff intervals retain nanoseconds across microsecond and day boundaries', () => {
  const before = '2026-10-09T23:59:59.999999499Z';
  const change = '2026-10-10T00:00:00.000000000Z';
  const after = '2026-10-10T00:00:00.000000501Z';
  assert.equal(rfc3339Nanos(change) - rfc3339Nanos(before), 501n);
  assert.equal(rfc3339Nanos(after) - rfc3339Nanos(change), 501n);
});

test('timestamp precision preserves timezone offsets, whole seconds and pre-epoch values', () => {
  assert.equal(rfc3339Nanos('1970-01-01T00:00:00Z'), 0n);
  assert.equal(rfc3339Nanos('1970-01-01T08:00:00.000000501+08:00'), 501n);
  assert.equal(rfc3339Nanos('1969-12-31T23:59:59.999999999Z'), -1n);
  assert.equal(rfc3339Nanos('1970-01-01T00:00:00.123456Z'), 123456000n);
  assert.throws(() => rfc3339Nanos('not-a-timestamp'), RangeError);
});
