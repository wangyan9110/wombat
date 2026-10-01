# Public contracts

[中文](contracts.md) | English

Rust `core/src/usage_app_dto.rs` defines requests and responses; `adapters/contract.rs` defines source-independent facts; `pricing.rs` defines decimal amounts and their basis.

Generated files:

- [Live request schema](../schemas/live-request-v1.schema.json) and [live response schema](../schemas/live-response-v1.schema.json), sourced from `core/src/live.rs`; `live` wraps v3 results with independent freshness metadata.
- [Request schema](../schemas/usage-request-v3.schema.json)
- [Response schema](../schemas/usage-app-v3.schema.json)
- [Price request schema](../schemas/pricing-request-v1.schema.json) and [price response schema](../schemas/pricing-response-v1.schema.json), sourced from `core/src/pricing_sync.rs`
- `client/src/generated/usage-request.ts`, `usage-app.ts`, and validators

Run `corepack pnpm contracts:generate` to regenerate; `contracts:check` rejects drift. The portable client validates requests and responses and exposes no general shell, arbitrary file writes, or arbitrary dispatch.

`outputVersion=3` versions public results; `schemaVersion=3` versions internal snapshots. Source adapters and prices have separate versions. Core messages use `{op:"usage_app",args:Request}` → `{ok:true,value:Response}` or `{ok:false,error,code,details}`. Usage operations are refresh, usage, threads, turns, and steps. The separate `prices` interface provides status/update with `outputVersion=1`.

See [CLI](../guides/cli.en.md) for operations, enums, pagination, and errors. Measurement integers cannot exceed JavaScript's safe integer range; amounts remain decimal strings. New fields and rules require checking generated types, TUI, JSON, and read-only compatibility with old snapshots together.

Usage requests add optional `presentation`, defaulting to details; distribution retains only period subtotals. With either explicit presentation, offset/limit/page.total count periods; a detail page includes every model row for those periods without splitting groups. Omitting presentation retains existing row pagination. The core computes both `sort: cost` and token ordering. Response `distribution` supplies complete-range maxima, tied peak dates and exact filter scopes, and unpriced token counts. Usage, turn, and measurement `costShare` uses the complete-range priced amount as denominator; unknown or zero denominators return missing values. Threads sort by `threadUsage`; `matchedUsage` only describes the selected range. Turns and steps remain complete.

## Client entries

`@wombat/client` exports generated types including `UsageRequest` and `UsageResult`, plus `UsageClient.query(request, { signal, onProgress })`. `UsageClient.prices({action:"status"|"update"}, {signal,onProgress})` returns generated `PricingResult` with the full catalog and version/source hashes. `UsageClient.live({query,mode,verify}, options)` is optional host functionality; Node supplies it and CLI uses it by default, while fixed snapshots use query. `createUsageClient(transport, pricingTransport, liveTransport)` wraps narrow transports and validates the protocol. The portable entry contains neither Node nor OpenTUI dependencies.

`@wombat/client/node` provides `createNodeClient({ binaryPath, timeoutMs, maxResponseBytes })` and owns local subprocess lifecycles. Callers do not handle arbitrary core operation strings. Other hosts can implement the same narrow transports and reuse generated contracts and validators.

Node's price transport downloads only the fixed official HTTPS document. The host request for the core `prices` operation includes document for update; status rejects it. Raw documents are absent from public request/response types. Rust parses and publishes them; other hosts must implement the same fixed-source retrieval flow.
