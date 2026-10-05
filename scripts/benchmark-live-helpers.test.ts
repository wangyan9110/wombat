import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  directoryBytes,
  isExpectedSyncTimeout,
  liveIndexPayloadFootprint,
  normalizeUsageOracle,
  snapshotFootprint,
  sourceTreeIdentity,
} from './benchmark-live-helpers.js';

test('source identity frames sorted relative names and exact bytes; directory size counts logical bytes', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wombat-live-helper-test-'));
  const first = path.join(root, 'first'); const second = path.join(root, 'second');
  try {
    mkdirSync(path.join(first, 'sessions'), { recursive: true });
    mkdirSync(path.join(second, 'sessions'), { recursive: true });
    writeFileSync(path.join(first, 'sessions', 'b.jsonl'), 'second\n');
    writeFileSync(path.join(first, 'sessions', 'a.jsonl'), 'first\n');
    writeFileSync(path.join(second, 'sessions', 'a.jsonl'), 'first\n');
    writeFileSync(path.join(second, 'sessions', 'b.jsonl'), 'second\n');
    const before = sourceTreeIdentity(first);
    assert.deepEqual(before, sourceTreeIdentity(second));
    assert.equal(before.files, 2);
    assert.equal(before.bytes, Buffer.byteLength('first\nsecond\n'));
    assert.equal(directoryBytes(first), before.bytes);
    writeFileSync(path.join(second, 'sessions', 'b.jsonl'), 'changed\n');
    assert.notEqual(sourceTreeIdentity(second).sha256, before.sha256);
    assert.equal(sourceTreeIdentity(second).bytes, before.bytes + 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('oracle normalization excludes only changing view headers and retains amounts, page totals and event time', () => {
  const base = {
    outputVersion: 4,
    action: 'usage',
    snapshotRef: { snapshotId: 'live:first', createdAt: '2026-10-01T00:00:00Z' },
    freshness: { status: 'current', revision: 'one', checkedAt: '2026-10-01T00:00:00Z' },
    capturedAt: '2026-10-01T00:00:00Z',
    scope: { allTime: true, timezone: 'UTC' },
    availableRange: { since: '2026-09-29', until: '2026-09-30' },
    summary: { measurementCount: 1, tokens: { total: 110 }, price: { knownCost: '0.000265', cost: '0.000265' } },
    items: [{ kind: 'usage', date: '2026-09-29', isSubtotal: true, timestamp: '2026-09-29T00:00:01Z', usage: { tokens: { total: 110 }, price: { knownCost: '0.000265' } } }],
    page: { offset: 0, limit: 100, total: 1, nextOffset: null },
    quality: { status: 'complete', sources: [{ source: { id: 'codex:synthetic', root: '/synthetic' }, adapterVersion: '1', sourceVersions: ['events:1'], capabilities: { events: true }, status: 'complete', filesRead: 1, bytesRead: 123, issues: [] }] },
    facets: { discoveredThreadCount: 1 },
    distribution: { peakTokenDates: ['2026-09-29'] },
    priceUpdate: { attemptedAt: '2026-10-01T00:00:00Z' },
  };
  const changedHeaders = {
    ...base,
    snapshotRef: { snapshotId: 'live:second', createdAt: '2026-10-02T00:00:00Z' },
    freshness: { status: 'current', revision: 'two', checkedAt: '2026-10-02T00:00:00Z' },
    capturedAt: '2026-10-02T00:00:00Z',
    priceUpdate: { attemptedAt: '2026-10-02T00:00:00Z' },
    quality: { ...base.quality, sources: [{ ...base.quality.sources[0], filesRead: 0, bytesRead: 0 }] },
  };
  assert.deepEqual(normalizeUsageOracle(base), normalizeUsageOracle(changedHeaders));
  assert.notDeepEqual(normalizeUsageOracle(base), normalizeUsageOracle({
    ...changedHeaders,
    quality: { ...base.quality, sources: [{ ...base.quality.sources[0], status: 'partial' }] },
  }));
  assert.notDeepEqual(normalizeUsageOracle(base), normalizeUsageOracle({
    ...changedHeaders,
    quality: { ...base.quality, sources: [{ ...base.quality.sources[0], issues: [{ code: 'incompleteTail' }] }] },
  }));
  assert.notDeepEqual(normalizeUsageOracle(base), normalizeUsageOracle({
    ...changedHeaders,
    summary: { ...base.summary, price: { ...base.summary.price, knownCost: '0.000530' } },
  }));
  assert.notDeepEqual(normalizeUsageOracle(base), normalizeUsageOracle({
    ...changedHeaders,
    items: [{ ...base.items[0], timestamp: '2026-09-29T00:00:02Z' }],
  }));
  assert.notDeepEqual(normalizeUsageOracle(base), normalizeUsageOracle({
    ...changedHeaders,
    page: { ...base.page, total: 2 },
  }));
});

test('only a structured SYNC_TIMEOUT is eligible for fresh-query retry', () => {
  assert.equal(isExpectedSyncTimeout(2, { error: { code: 'SYNC_TIMEOUT' } }), true);
  assert.equal(isExpectedSyncTimeout(0, { error: { code: 'SYNC_TIMEOUT' } }), true);
  assert.equal(isExpectedSyncTimeout(2, { error: { code: 'SOURCE_UNREADABLE' } }), false);
  assert.equal(isExpectedSyncTimeout(2, 'SYNC_TIMEOUT'), false);
  assert.equal(isExpectedSyncTimeout(null, { error: { code: 'SYNC_TIMEOUT' } }), false);
});

test('fixed snapshot footprint separates event, ledger, thread and manifest logical file lengths', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wombat-snapshot-helper-test-'));
  try {
    writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({
      ledger: { file: 'ledger.json' },
      events: { partitions: [{ chunks: [{ file: { file: 'events-0.json' } }] }] },
      threads: [{ file: { file: 'thread-0.jsonl' } }],
    }));
    writeFileSync(path.join(root, 'ledger.json'), 'ledger');
    writeFileSync(path.join(root, 'events-0.json'), 'events');
    writeFileSync(path.join(root, 'thread-0.jsonl'), 'thread');
    writeFileSync(path.join(root, 'other.bin'), 'other');
    assert.deepEqual(snapshotFootprint(root), {
      totalBytes: directoryBytes(root),
      manifestBytes: Buffer.byteLength(JSON.stringify({ ledger: { file: 'ledger.json' }, events: { partitions: [{ chunks: [{ file: { file: 'events-0.json' } }] }] }, threads: [{ file: { file: 'thread-0.jsonl' } }] })),
      ledgerBytes: 6,
      eventShardBytes: 6,
      threadShardBytes: 6,
      otherBytes: 5,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SQLite logical payload report distinguishes owned JSONB bytes from projection expansion', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wombat-index-helper-test-'));
  const databaseFile = path.join(root, 'index.sqlite');
  const database = new DatabaseSync(databaseFile);
  try {
    database.exec(`
      CREATE TABLE buckets (id INTEGER PRIMARY KEY, scope TEXT NOT NULL, field TEXT NOT NULL, UNIQUE(scope,field));
      CREATE TABLE entries (bucket INTEGER NOT NULL, id TEXT NOT NULL, payload BLOB, source_bucket INTEGER, member TEXT, PRIMARY KEY(bucket,id));
      INSERT INTO buckets VALUES (1,'parser:synthetic:1:1:facts','events');
      INSERT INTO buckets VALUES (2,'parser:synthetic:1:1:facts','measurements');
      INSERT INTO buckets VALUES (3,'parser:synthetic:1:1:facts','operations');
      INSERT INTO buckets VALUES (4,'projection:synthetic','events');
      INSERT INTO buckets VALUES (5,'projection:synthetic','operations');
      INSERT INTO buckets VALUES (6,'projection:synthetic','measurements');
    `);
    database.prepare('INSERT INTO entries(bucket,id,payload) VALUES(?,?,jsonb(?))').run(1, 'event-1', '{"kind":"message","text":"合成"}');
    database.prepare('INSERT INTO entries(bucket,id,payload) VALUES(?,?,jsonb(?))').run(2, 'measurement-1', '{"measurement":{"timestamp":"2026-10-01T00:00:01Z","tokens":{"total":7}}}');
    database.prepare('INSERT INTO entries(bucket,id,payload) VALUES(?,?,jsonb(?))').run(3, 'operation-1', '{"name":"read_file","callId":"synthetic"}');
    database.prepare('INSERT INTO entries(bucket,id,source_bucket,member) VALUES(?,?,?,?)').run(4, 'event-1', 1, '$');
    database.prepare('INSERT INTO entries(bucket,id,source_bucket,member) VALUES(?,?,?,?)').run(5, 'operation-1', 3, '$');
    database.prepare('INSERT INTO entries(bucket,id,source_bucket,member) VALUES(?,?,?,?)').run(6, 'measurement-1', 2, '$.measurement');
    const expectedStored = Object.fromEntries([1, 2, 3].map(bucket => [bucket, Number(database.prepare('SELECT length(payload) AS n FROM entries WHERE bucket=?').get(bucket)!.n)]));
    database.close();

    const footprint = liveIndexPayloadFootprint(databaseFile);
    assert.deepEqual(footprint, [
      { scopeKind: 'parserFacts', field: 'events', entries: 1, storedJsonbPayloadBytes: expectedStored[1], expandedJsonBytes: Buffer.byteLength('{"kind":"message","text":"合成"}') },
      { scopeKind: 'parserFacts', field: 'measurements', entries: 1, storedJsonbPayloadBytes: expectedStored[2], expandedJsonBytes: Buffer.byteLength('{"measurement":{"timestamp":"2026-10-01T00:00:01Z","tokens":{"total":7}}}') },
      { scopeKind: 'parserFacts', field: 'operations', entries: 1, storedJsonbPayloadBytes: expectedStored[3], expandedJsonBytes: Buffer.byteLength('{"name":"read_file","callId":"synthetic"}') },
      { scopeKind: 'projection', field: 'events', entries: 1, storedJsonbPayloadBytes: 0, expandedJsonBytes: Buffer.byteLength('{"kind":"message","text":"合成"}') },
      { scopeKind: 'projection', field: 'measurements', entries: 1, storedJsonbPayloadBytes: 0, expandedJsonBytes: Buffer.byteLength('{"timestamp":"2026-10-01T00:00:01Z","tokens":{"total":7}}') },
      { scopeKind: 'projection', field: 'operations', entries: 1, storedJsonbPayloadBytes: 0, expandedJsonBytes: Buffer.byteLength('{"name":"read_file","callId":"synthetic"}') },
    ]);
  } finally {
    try { database.close(); } catch { /* already closed before the read-only helper check */ }
    rmSync(root, { recursive: true, force: true });
  }
});
