# Proposal: persistent live-index views and scale targets

[中文](2026-09-30-live-usage.md) | English

Status: proposed

This page retains only unfinished persistent MVCC, dependency-closure reconciliation, database aggregation, and scale acceptance. The [live-query](../../implemented/architecture/2026-10-01-rust-live-query.en.md) and [compact-index](../../implemented/architecture/2026-10-02-compact-live-index.en.md) decisions cover delivered on-demand services, incremental cursors, SQLite transactions, and fixed in-memory views. The [core](../../../../core/README.en.md), [contract](../../../development/contracts.en.md), and [CLI guide](../../../guides/cli.en.md) own current operations and lifecycle without repetition here. Retired TUI behavior, old-protocol compatibility, and old-snapshot migration are no longer proposed.

## Problem

Source-wide candidate reconciliation and in-memory facts still grow with history. Retaining fixed views in memory is not persistent MVCC. Incremental reading alone does not make reconciliation, queries, or memory proportional to additions. Narrow affected computation while retaining late evidence, corrections, retractions, and hierarchical conservation.

## Proposal

### Dependency reconciliation and atomic commits

Retain file contributions, cross-file candidates, and dependencies; reconcile affected threads and cumulative intervals with insertions, corrections, and retractions. Modern detail can retract cumulative adjustments, inherited ownership can correct copies, and tool results update original operations. Unknown closures fall back to source-wide rebuilding with visible synchronization rather than adding new-line totals.

Parser checkpoints retain allowlisted state including model/effort inheritance, previous cumulative values, and unfinished call associations, without raw messages or tool output. Cursors are not complete state. File identity, length, and boundary hashes cannot prove an unchanged prefix; appends with earlier rewrites need budgeted full verification and explicit watermarks, without promising discovery of arbitrary edits within two seconds.

Commit candidates, canonical facts, prices, aggregates, source state, parser checkpoints, offsets, and revision atomically. Large rebuilds may stage chunks but switch generations once, keeping readers on the preceding committed view. Precommit crashes reread; postcommit recovery is idempotent. Missing or unreadable sources never silently erase accounting. Publish change notifications only after commit.

### Persistent views and database aggregation

The candidate uses versioned SQLite facts and stable identities with validFrom/validTo visibility. A readView pins index instance, revision, price epoch, and lease. Queries use short transactions instead of long WAL readers that block checkpointing. Pagination, totals, and drill-down share a version; expiration fails explicitly rather than switching. Bound leases, GC, and backpressure without reclaiming referenced facts, fixed snapshots, or irreplaceable user decisions.

WAL, FULL synchronization, and one writer reuse database transactions. Network shares are not supported local-database deployments. Database corruption requires isolation and an independently designed rebuild flow without deleting sources, identity registrations, or user decisions. Unreleased versions maintain only current formats and reject unknown versions while preserving data, following the [current-format decision](../../implemented/architecture/2026-10-03-current-format-only.en.md).

Store money as canonical decimal strings or explicitly scaled integers, never REAL sums. Time, source, model, project, and thread indexes support pre-pagination totals. Cache keys include scope, timezone and rule version, price epoch, and revision. Arbitrary local days cannot be assembled from UTC daily subtotals. Unknown classifications retain counts and known subtotals; corrections recompute affected buckets without subtracting null as zero.

Price acquisition follows the [current pricing policy](../../../reference/pricing.en.md). Build new price projections from canonical facts and switch atomically after completion. Views never mix rates and fixed-snapshot amounts do not follow index updates. Distinguish fact changes from price revisions in notifications, coalesce invalidation for slow clients, and explicitly require requery after overflow or reconnect rather than promising complete replay.

## Alternatives considered

Frequent full refreshes reread and rewrite history; adding new bytes alone cannot handle inheritance, cumulative corrections, or truncation. Independent watchers per entry duplicate collection and complicate writer locks and lifecycle. Permanent daemons add installation and residency costs, so the on-demand shared service remains the boundary. Memory-only state loses recovery checkpoints, while repeated full JSON exports grow with history. Fixed snapshots remain explicit archives and incremental indexes serve live queries.

## Acceptance criteria

### Correctness and recovery

Independent synthetic truth covers modern/legacy cumulative accounting, late-detail retraction, cross-batch model/effort state, duplicate events and reads, parent/child inheritance, cross-file conflicts, late tool results, partial lines, and large lines. Random byte/record splits and restarts must preserve tokens, decimal money, and hierarchical totals against independent truth, not just two implementations that may share a bug.

Inject crashes/cancellation, full storage, lock timeouts, unreadable sources, event overflow, truncation/equal-length replacement/appends with rewrites, archive renames, sleep, data-root changes, and concurrent client starts/exits at transaction boundaries. Verify no duplicate or missing accounting or partial publication, readable committed current-format snapshots, and eventual correction of prefix rewrites with visible detection delay.

Assembled entries must verify fixed-view pagination/drill-down, daylight saving, price switches, reconnects, expiration, stable selection, filter input, and cancellation cleanup. Unchanged sources must not generate meaningless revisions. Windows multiprocess IPC, remote-client rejection, and timeouts need target-system evidence; UI acceptance uses current Web rather than retired terminal journeys.

### Performance targets (pending acceptance)

Use fixed macOS arm64, Node26.4.0+, release, 10,000 files, and 1,000,000 measurements. Twenty active files append 20 records per second in total, at most 1MiB/s, with ordinary lines at most 64KiB. Separately measure valid 1/10/100MiB lines, first indexing, and prolonged backlog rather than mixing them into ordinary append SLOs.

- With an existing index and warm cache, complete-line write to Web display p95 ≤2 seconds; missed-event recovery ≤5 seconds for active files and ≤35 seconds for new files, assuming no sustained backlog.
- First display of older committed results p95 ≤500ms with visible synchronization; normal append CLI synchronization, query, and serialization p95 ≤1 second. Exceeding current query budgets exposes status. Report pure queries, cold IPC startup, and cold file caches separately.
- Ordinary append reads grow with added bytes without rewriting all history; account for full verification and directory sweeps separately. Idle core CPU averages <1% of one core, with service RSS ≤256MiB. Report large-line peaks, host/browser, and total process-tree memory separately.
- First indexing has no two-second promise. Report throughput, elapsed time, memory, disk amplification, and backfill query latency. Run 24 hours to inspect backlog, WAL, fact versions, lease reclamation, and disk growth; unbounded tail buffers or unreclaimed versions fail acceptance.

[Historical benchmarks](../../../benchmarks/live-usage-2026-09-30.json) describe only their build and corpus. Persistent views, local reconciliation, database aggregation, and these scale targets remain without full acceptance. Locate reading, reconciliation, transaction, IPC, and rendering costs before tuning, without sacrificing accounting correctness.
