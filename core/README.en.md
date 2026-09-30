# Rust core

[中文](README.md) | English

`wombat-core` reads local Agent records, creates immutable snapshots, and serves usage and conversation queries from one business model. Codex is the current production source; see the [support matrix](../docs/support-matrix.md) for the supported scope.

## Entry points and responsibilities

- `src/adapters/` identifies source facts; `pricing.rs` owns offline prices; `usage_store.rs` writes and reads snapshots; `usage_app.rs` runs shared queries.
- `usage_app_dto.rs` defines requests and results and generates TypeScript and Schema; see the [contracts](../docs/contracts.md) for field semantics.
- `src/main.rs` accepts one JSON request on stdin and emits one final JSON result on stdout; stage progress goes to stderr.

## Limits and verification

Default refresh reads source logs without changing them and writes only to the product data directory. Unpriced or missing values, partial source failures, and resource limits remain visible; the [architecture](../docs/architecture.md) and [core rules](AGENTS.md) describe ownership and failure boundaries. After algorithm or storage changes, run the relevant synthetic expectations, formatting, and clippy checks; rebuild the core before cross-language tests.
