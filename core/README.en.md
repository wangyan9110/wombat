# Rust core

[中文](README.md) | English

`wombat-core` reads local Agent records, creates immutable snapshots, and serves usage and conversation queries from one business model. Codex is the current production source; see the [source acceptance reference](../docs/development/adapters.en.md) for the supported scope.

## Entry points and responsibilities

- `src/adapters/` identifies source facts; `pricing.rs` owns offline prices; `usage_store.rs` writes and reads snapshots; `usage_app.rs` runs shared queries.
- `usage_app_dto.rs` defines requests and results and generates TypeScript and Schema; see the [contracts](../docs/development/contracts.en.md) for field semantics.
- `src/main.rs` accepts one JSON request on stdin and emits one final JSON result on stdout; stage progress goes to stderr.

## Internal business modules

| Business area | Code responsibilities |
|---|---|
| Codex source | `adapters/codex/`: bounded reading, source events, identity facts, direct/cumulative accounting and index titles; the separate incremental entry remains |
| Usage queries | `usage_app/`: scope validation, conserved summaries, date/dimension reports and task/turn/step queries; the parent assembles query caching |
| Snapshots | `usage_store/`: immutable generations, exact shard reads and shared live views; each measurement has one ledger attribution |
| Live service | `live/`: incremental collection, revision selection, typed queries and connection/service lifecycle |
| Configuration | `config/`: inventory, scope and evidence queries; scanning separates text/instructions/extensions, while static algorithms separate whole blocks/declared relations/local references |
| Optimization | `optimize/`: deterministic rules, independent outcomes, review service and durable database; user decisions and check facts remain independent |

Only current public contracts and data formats are maintained; unknown formats are rejected without migration. Tests follow the same business groupings and retain independent synthetic expectations.

## Limits and verification

Default refresh reads source logs without changing them and writes only to the product data directory. Unpriced or missing values, partial source failures, and resource limits remain visible; the [architecture](../docs/development/architecture.en.md) and [core rules](AGENTS.md) describe ownership and failure boundaries. After algorithm or storage changes, run the relevant synthetic expectations, formatting, and clippy checks; rebuild the core before cross-language tests.

## Storage and service lifecycle

Configuration views separately pin internal content revisions for configuration measurements, static analysis, and host observations, including the relevant collection completeness and authorization scope. Observation times remain separate; repeating an observation of identical content does not change its content revision solely because time has passed. Default date ranges use the selected view's cutoff. Post-review Skill/MCP observations share use-operation identities and counting semantics within `(review time, view cutoff]`; missing identity, time, dispatch, or target evidence leaves counts unknown. Durable restoration of a unified EvidenceView and public per-object coverage fields remain undelivered.

Static rules cache pure hit/miss judgments using actual parameters, measurement methods, relevant relations and completeness, object identity, and authorization scope; unrelated log appends do not change the dependency key. Each evaluation still checks current availability and comparability with the original review baseline, then binds the current observation time. User decisions and resolution conclusions are not cached. The process-local LRU permits at most 16 entries and 2 MiB of encoding, with 256 KiB per entry. Dependency scans and encoding also have budgets; exceeding them only skips reuse. Encoding allowances are not heap-memory limits, and input preparation and dependency calculation still have costs. The evaluator does not yet expose cancellation.

Default data directories are `~/Library/Application Support/Wombat` on macOS, `%LOCALAPPDATA%/Wombat` on Windows, and `XDG_DATA_HOME/wombat` or `~/.local/share/wombat` on Linux; `WOMBAT_DATA_HOME` overrides them. Snapshots live in `usage-v4/`, indexes in `live-v2/`; the old `latest.json` is not replaced.

Refresh holds a process file lock, writes a private generation, shards, and hashes, then commits the manifest and atomically updates latest. Cancellation never publishes a partial snapshot. Source failures retain separate receipts; total failure preserves the previous latest. Source reads use the captured length and make no cross-file atomicity claim. Only current formats are supported; unknown versions are rejected without automatic migration or deletion.

Safe events use exact `threadId` and optional `turnId` partitions, retaining facts without a task or turn separately; the event index has its own version. Blocks obey both a 200-fact limit and a 4 MiB limit on the complete encoding, with hash, attribution, order and count validation. A single event plus block metadata exceeding 4 MiB fails explicitly with a resource error and preserves the previous latest. Memory and disk use the same block index; exact-target queries read only intersecting event blocks. Whole-target reads allow at most 100,000 facts, evidence pages at most 200 rows, and each query at most 64 MiB of block encodings; the event array encoding obeys the same byte limit. Queries support cancellation; page cursors bind the snapshot, exact target and partition-index hash. Limits or failed validation never return a truncated success.

Per-file read watermarks retain source identity, file generation, the committed complete-newline boundary, captured length, collection time, and coverage state through index restoration and snapshot export. Collection time does not replace event time; unchanged files retain their original observation time. Incremental reads do not commit incomplete tails. Ordinary reads retain valid records without a final newline while reporting incomplete coverage. Missing files or individual source failures retain prior positions. Mixed success marks failures only in a new view; total failure rolls back without changing the old view or separately persisting that failed attempt. Watermarks remain internal facts without public query presentation.

The Rust snapshot API `timing_evidence` reads canonical measurements, exact-turn events, unattributed discontinuities within relevant physical file spans, and read watermarks for an explicit source, thread, and turn. It does not traverse the whole ledger or unattributed event buckets. Memory and disk share budgets of at most 100,000 touched facts, 64 MiB of encoding, and 100,000 metadata work units; all limits apply together, and skipped operation payloads still count toward reading costs. Limits, cancellation, or failed validation return errors rather than truncated success. This API is not yet connected to CLI/Web.

Construction still retains all E safe events in O(E) memory and sorts in O(E log E); snapshot loading reads the complete manifest metadata, and watermark metadata grows with the number of source files. Full-source residency and total persistence limits remain undelivered. `timing/` currently contains internal algorithms verified with synthetic tests; production query entry points and complete response-envelope budgets remain unimplemented.

The live index commits facts, cursors and projections together using integer keys and JSONB. Equal projections and prices share storage; see the [index decision](../docs/decisions/implemented/architecture/2026-10-02-compact-live-index.en.md) for boundaries. Truncation/replacement rebuilds; disappearing files retain contributions and mark partial. Sources roll back independently, and all-source failure retains the prior view. Fixed queries and caches are isolated by revision/scope. Parser facts recover by replaying stored events; read projections remain disposable caches, checkpoints retain parser context and source diagnostics, and titles still come from the external session index. Unchanged metadata takes a fast path that does not read log contents; it cannot detect an edit whose original timestamp is restored, while explicit verification rechecks the file. Changed or explicitly verified files use a 64 KiB buffer to check the committed prefix and verify the captured contents before and after parsing; a source change during observation rejects publication and triggers a retry. Changed files require two full-content validation passes plus parsing of new content, taking O(captured file length); continued writes may delay completion until a stable read is possible. This integrity check is not a performance improvement. Replay sorts E events in O(E log E) time and retains all events in memory. Direct-response appends skip cumulative reconciliation, and turn queries borrow facts. Full traversal and rebuilding remain; persistent MVCC, database aggregation and long-term scale targets are undelivered.

Snapshots exclude message bodies, complete command arguments, and tool output; source data is never an instruction. The on-demand core service still uses a private Unix socket or owner-only Windows named pipe and exits about 15 seconds after its last call when no valid configuration view remains. HTTP exists only in the explicitly started Web host. Permanent monitoring and HTML report export are unavailable.
