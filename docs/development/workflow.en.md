# Development and delivery rules

[中文](workflow.md) | English

Follow the [version-one specification](../project/specification.en.md) and [architecture](architecture.en.md). Usage and conversations are the product views; CLI/Web share Rust operations, filtering, accounting, and pricing.

## Implementation boundaries

- Deliver new capabilities through Web and a JSON entry requiring no TTY. Define DTOs in Rust and generate schemas, TS, and runtime validators; do not maintain fields independently on each side.
- Source adapters normalize facts. Pricing, aggregation, deduplication, and project attribution stay out of Node.
- Runtime, builds, types, and tests do not depend on ccusage. Lock general libraries as needed; independent synthetic truth establishes accounting acceptance.
- Original sources are read-only. Live refresh downloads official prices when missing rates can be resolved; WOMBAT_AUTO_PRICES=0 disables this. Snapshots store allowlisted metadata; no text replay or arbitrary execution interface is provided.
- Keep missing, zero, partially priced, and unknown distinct. Output amounts as decimal strings; lists round for display only.
- Date ranges include since and exclude until. Use timezone calendar days, Monday week boundaries, and each measurement's date for conversations and turns spanning days.
- Preserve existing user work before changes. Removing old code must not remove user data directories, identity registrations, or recovery materials.
- Follow [independent module boundaries](architecture.en.md): peer root modules `core/`, `client/`, `ui/`, `web/`, and `cli/`. Each declares dependencies, builds, and tests and uses only public exports or protocols. UI accesses business operations through an injected `UsageClient`. Typechecking includes import-boundary checks.
- Product runtime is Node.js 26.4.0 or newer. The default CLI prints usage; Web is started explicitly. No terminal rendering or FFI startup is required.

## Verification

```sh
corepack pnpm build
corepack pnpm typecheck
corepack pnpm contracts:check
corepack pnpm test
~/.cargo/bin/cargo fmt --manifest-path core/Cargo.toml -- --check
~/.cargo/bin/cargo clippy --locked --manifest-path core/Cargo.toml --all-targets -- -D warnings
```

After building, run synthetic development scripts: `node --import tsx scripts/benchmark-usage-v1.ts --output /tmp/wombat-query.json` and `node --import tsx scripts/benchmark-live.ts --output /tmp/wombat-live.json` check fixed-snapshot queries and the live index.

Choose tests by the actual change; run all for complete-chain delivery. Cross-language tests call dist and require a preceding build. Independent truth covers A01–A12; correctness is not equivalence to old output. Verify Web interaction, narrow screens, cancellation, and return paths in a browser. Performance reports specify fixed fixtures, release builds, cold/warm queries, core startup, and peak memory; parsing alone does not establish total performance.

Review dependency changes and run `corepack pnpm licenses:generate` and `licenses:check`. Release acceptance uses `corepack pnpm public:check --package` and installation in a clean directory. Do not claim support for untested platforms. Only checks actually passed enter completion records.

## Web-First Migration

Tauri 2 is selected; Web ships first and TUI product code has been removed. Boundaries and pending work are defined in [architecture](architecture.en.md). After building, run `node dist/wombat.js web`; rebuild and restart after changes. Host, real core, browser, and installed assets require separate verification.
