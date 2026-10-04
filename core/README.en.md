# Rust core

[中文](README.md) | English

`wombat-core` reads local Agent records, creates immutable snapshots, and serves usage and conversation queries from one business model. Codex is the current production source; see the [support matrix](../docs/reference/support-matrix.en.md) for the supported scope.

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
