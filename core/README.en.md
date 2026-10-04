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

Default data directories are `~/Library/Application Support/Wombat` on macOS, `%LOCALAPPDATA%/Wombat` on Windows, and `XDG_DATA_HOME/wombat` or `~/.local/share/wombat` on Linux; `WOMBAT_DATA_HOME` overrides them. Snapshots live in `usage-v4/`, indexes in `live-v2/`; the old `latest.json` is not replaced.

Refresh holds a process file lock, writes a private generation, shards, and hashes, then commits the manifest and atomically updates latest. Cancellation never publishes a partial snapshot. Source failures retain separate receipts; total failure preserves the previous latest. Source reads use the captured length and make no cross-file atomicity claim. Only current formats are supported; unknown versions are rejected without automatic migration or deletion.

The live index commits facts, cursors and projections together using integer keys and JSONB. Equal projections and prices share storage; see the [index decision](../docs/decisions/implemented/architecture/2026-10-02-compact-live-index.en.md) for boundaries. Truncation/replacement rebuilds; disappearing files retain contributions and mark partial. Sources roll back independently, and all-source failure retains the prior view. Fixed queries and caches are isolated by revision/scope. Parser facts recover by replaying stored events; read projections remain disposable caches, checkpoints retain parser context and source diagnostics, and titles still come from the external session index. Replay sorts E events in O(E log E) time and retains all events in memory. Direct-response appends skip cumulative reconciliation, and turn queries borrow facts. Full traversal and rebuilding remain; persistent MVCC, database aggregation and long-term scale targets are undelivered.

Snapshots exclude message bodies, complete command arguments, and tool output; source data is never an instruction. The on-demand core service still uses a private Unix socket or owner-only Windows named pipe and exits about 15 seconds after its last call when no valid configuration view remains. HTTP exists only in the explicitly started Web host. Permanent monitoring and HTML report export are unavailable.
