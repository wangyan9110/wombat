# Development and delivery rules

[中文](workflow.md) | English

Follow the [version-one specification](../project/specification.en.md) and [architecture](architecture.en.md). Usage and conversations are the product views; CLI/TUI share Rust operations, filtering, accounting, and pricing.

## Implementation boundaries

- Deliver new capabilities through both terminal interaction and a JSON entry requiring no TTY. Define DTOs in Rust and generate schemas, TS, and runtime validators; do not maintain fields independently on each side.
- Source adapters normalize facts. Pricing, aggregation, deduplication, and project attribution stay out of Node.
- Runtime, builds, types, and tests do not depend on ccusage. Lock general libraries as needed; independent synthetic truth establishes accounting acceptance.
- Original sources are read-only and basic refresh is offline. Snapshots store allowlisted metadata; no text replay or arbitrary execution interface is provided.
- Keep missing, zero, partially priced, and unknown distinct. Output amounts as decimal strings; lists round for display only.
- Date ranges include since and exclude until. Use timezone calendar days, Monday week boundaries, and each measurement's date for conversations and turns spanning days.
- Preserve existing user work before changes. Removing old code must not remove user data directories, identity registrations, or recovery materials.
- Follow [independent module boundaries](architecture.en.md#独立模块): peer root modules `core/`, `client/`, `tui/`, and `cli/`. Each declares dependencies, builds, and tests and uses only public exports or protocols. TUI accesses business operations through an injected `UsageClient`. Typechecking includes import-boundary checks.
- Product runtime is Node.js 26.4.0 or newer. Only the interactive process loads OpenTUI; CLI encapsulates FFI startup arguments. JSON, help, and contract generation must not depend on terminal initialization.

## Verification

```sh
corepack pnpm build
corepack pnpm typecheck
corepack pnpm contracts:check
corepack pnpm test
~/.cargo/bin/cargo fmt --manifest-path core/Cargo.toml -- --check
~/.cargo/bin/cargo clippy --locked --manifest-path core/Cargo.toml --all-targets -- -D warnings
```

Run module tests with `corepack pnpm --filter @wombat/client test`, `--filter @wombat/tui test`, and `--filter @wombat/cli test`, building required packages first. `corepack pnpm build:core` builds only the core; TUI can build independently after the client.

Choose tests by the actual change; run all for complete-chain delivery. Cross-language tests call dist and require a preceding build. Independent truth covers A01–A12; correctness is not equivalence to old output. Use real PTYs for 40 / 80 / 120 columns and complete return paths. Performance reports specify fixed fixtures, release builds, cold/warm queries, core startup, and peak memory; parsing alone does not establish total performance.

Review dependency changes and run `corepack pnpm licenses:generate` and `licenses:check`. Release acceptance uses `corepack pnpm public:check --package` and installation in a clean directory. Do not claim support for untested platforms. Only checks actually passed enter completion records.
