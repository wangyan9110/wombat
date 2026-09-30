# Typed client

[中文](README.md) | English

`@wombat/client` validates requests and results and gives the CLI and TUI one `UsageClient`. Business DTOs come from Rust-generated contracts; the [architecture](../docs/architecture.md) shows the cross-module data flow.

## Public entries

- The package root exports `createUsageClient`, types, and `CoreError` and calls business operations through an injected transport; it loads no Node or terminal library.
- `createNodeClient` from `@wombat/client/node` manages the local core subprocess, cancellation, timeouts, and response limits.
- `UsageClient.live` provides auto/fresh/cached queries and freshness; the Node host manages a shared local service, while `query` retains the fixed-snapshot interface.
- `UsageClient.prices` provides offline inspection and explicit official price updates; the Node host retrieves a fixed HTTPS document, and Rust validates, stores, and applies the prices.
- Generated files live in `src/generated/`; field and version authority remains with the Rust DTO and [contracts](../docs/contracts.md).

## Limits and verification

The client allows only operations in the generated request union; it exposes no arbitrary shell, file write, or generic dispatch. It validates requests and results at the process boundary; build and run focused tests after changes, following the [client rules](AGENTS.md).
