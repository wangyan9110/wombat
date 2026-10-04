# Typed client

[中文](README.md) | English

`@wombat/client` validates requests and results and gives the CLI and Web one `UsageClient`. Business DTOs come from Rust-generated contracts; the [architecture](../docs/development/architecture.en.md) shows the cross-module data flow.

## Public entries

- The package root exports `createUsageClient({ query, ...transports })`, types, and `CoreError`. Named optional transports include `timing`, `account`, and `handoff`; the root loads no Node or terminal library.
- `createNodeClient` from `@wombat/client/node` manages the local core subprocess, cancellation, timeouts, and response limits.
- `UsageClient.live` provides auto/fresh/cached queries and freshness; the Node host manages a shared local service, while `query` retains the fixed-snapshot interface.
- Optional `UsageClient.timing` provides whole-turn summaries, fixed-snapshot evidence pages, and offline capabilities through Rust-generated v1 contracts. Node selects a live view when no snapshot is supplied; an explicit stored snapshot stays fixed. Timing does not trigger price downloads, Hook capture, configuration scans, or account observations.
- `UsageClient.prices` provides offline inspection, explicit updates, and `auto_update` checks for missing prices. The Node live client triggers fixed-HTTPS downloads; Rust owns eligibility, persistent throttling, validation, storage, and pricing.
- Generated files live in `src/generated/`; field and version authority remains with the Rust DTO and [contracts](../docs/development/contracts.en.md).

- Presentation language uses `@wombat/client/locale`; see [product language and copy](../docs/i18n/product.en.md).

## Limits and verification

The client allows only operations in the generated request union; it exposes no arbitrary shell, file write, or generic dispatch. It validates requests and results at the process boundary; build and run focused tests after changes, following the [client rules](AGENTS.md).

The Node client and local service use protocol 2 with a separate endpoint and service lock; protocol 1 is rejected. Timing validates the response action, privacy profile, method, and local target and fixed snapshot identity. Share output omits local identities, so Rust owns its target binding. Live cancellation closes only the caller's connection and rejects late results; shared synchronization continues, and disconnects do not yet cancel the server's query computation.

## HTTP Transport

`@wombat/client/http` exports `createHttpClient({ origin, token })`, implementing the same `UsageClient`, validating results and preserving progress, cancellation, and errors. The browser sends narrow operations to the local host rather than accessing the core directly.

The local Web host implements `/api/timing`; see the [Web host](../web/README.en.md) for scope and version authorization. The CLI exposes timing summary, evidence, and capabilities; see the [CLI guide](../docs/guides/cli.en.md). The timing UI is not implemented yet. Integration with the real core and browser has not been accepted.

`UsageClient.config` provides measurements/evidence, `optimize` static suggestions, user records and manual rechecks, and `preferences` only gets/sets zh/en. Rust generates all three v1 contracts with peer Node/HTTP implementations; see [public contracts](../docs/development/contracts.en.md).

`createNodeClient({automaticPrices:false})` disables only the client’s automatic-price decorator; explicit prices operations remain available. CLI live queries retain their existing default behavior; Web uses this raw client and owns background price lifetime.
