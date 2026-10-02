# Decision Note: compact live index and replacement algorithm

[中文](2026-10-02-compact-live-index.md) | English

Status: implemented

## Problem

The old index repeated scope text and JSON-encoded field/identity keys for each safe fact. Both parser candidates and committed projections must be restorable, so repeated keys grew with record counts. Whole-field replacement allocated encoded desired keys and copied all old keys. WAL files from initial large transactions could retain their peak size through later small appends.

## Decision

SQLite inside live-v1 independently uses user_version=2. A buckets dictionary uniquely maps(scope,field) to integers. Entries use a(bucket,id) composite primary key and WITHOUT ROWID, avoiding repeated scope/field text and JSON keys. SQLite itself encodes jsonb and decodes json; payloads remain opaque internal database BLOBs. Public DTOs, snapshotv1/v2/v3 and adapter versions are unchanged. JSONB saves space without claiming constant-time field access; see [SQLite documentation](https://www.sqlite.org/json1.html#jsonb).

Field replacement uses a HashSet of borrowed identities, streams existing identities and copies only obsolete ones before deleting after the scan. Reads do not mutate the scanned table; unchanged payloads are not rewritten. Appends still write only dirty measurements, operations and cursors, without per-append VACUUM or whole-database rewrites.

Sharing immutable priced facts back into parser caches uses merge cursors over three identity-sorted sequences, checking shared pointers first and reusing only equal values. This replaces per-row BTreeMap lookups and projected-fact binary searches with a linear pass per source without allocating another collection. Corrections with different values, missing identities and other sources are not overwritten. Multiple sources still traverse the global measurement sequence separately; local appends are not claimed independent of full-history size.

Each connection sets a4MiB page-cache target, file temporary storage,512-page automatic checkpoints and an8MiB journal-retention target. WAL, FULL synchronization and the original commit transaction remain. Journal retention is not a hard space limit: large transactions, active readers and failed checkpoints can temporarily grow WAL. The page-cache budget is not a process peak-memory limit; in-memory facts and revisions have separate costs.

Legacy kv indexes migrate row by row in an IMMEDIATE transaction, validating old keys and converting payloads. Errors roll back the old table; a one-time VACUUM runs only after commit to reclaim old-layout free pages. Migration may require additional disk, time and a write lock; compaction failure does not damage the committed new index. Unknown schema versions are rejected without deleting data. Irreplaceable user-v1 decisions, configuration caches and immutable snapshots are outside this migration. Old programs cannot keep writing the new layout; restart hosts normally to use the new core.

## Alternatives considered

Keeping text kv and only limiting WAL reduces journal retention without removing repeated row keys. General compression of small records adds codec costs and dependencies; this change reuses locked SQLite first. Database aggregation, further candidate/projection sharing and content-addressed snapshots could reduce resources further but affect cumulative retractions, fixed versions and file-snapshot compatibility; these boundaries were not rewritten together.

## Impact and verification

Regressions cover legacy migration/reopening, maximum integers and tiny floating-point values, Unicode/escaping, failed migration rollback, future-version rejection, empty maps/scalars, field/source isolation, replacement deletion, unchanged-write avoidance and corrupt-payload errors. The CLI end-to-end fixture converts its actual synthetic index into the old layout, then verifies the cached revision, cursor appends, fixed queries and snapshot export.

Release benchmarks with fixed fixtures separately record cold/warm queries, appends, peak RSS, database/WAL and disk after idle exit. Results and limits are in [progress](../../../project/progress.en.md). Candidates and projections still have separate persistent representations, and in-memory facts still grow with history. Million-record scale, long residency, other platforms and real sources are not accepted by this change.
