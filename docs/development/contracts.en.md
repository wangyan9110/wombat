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

See [CLI](../guides/cli.en.md) for operations, enums, pagination, and errors. Measurement integers cannot exceed JavaScript's safe integer range; amounts remain decimal strings. New fields and rules require checking generated types, Web, JSON, and read-only compatibility with old snapshots together.

Usage requests add optional `presentation`, defaulting to details; distribution retains only period subtotals. With either explicit presentation, offset/limit/page.total count periods; a detail page includes every model row for those periods without splitting groups. Omitting presentation retains existing row pagination. The core computes both `sort: cost` and token ordering. Response `distribution` supplies complete-range maxima, tied peak dates and exact filter scopes, and unpriced token counts. Usage, turn, and measurement `costShare` uses the complete-range priced amount as denominator; unknown or zero denominators return missing values. Threads sort by matchedUsage or latest matching measurement; threadUsage retains full usage. Turns remain complete by default. Only turns accepts matchedOnly and locateTurnId, filtering and sorting before locating a page. Matching-only mode changes items/page, not the full-conversation summary or share denominator; steps remain complete.

## Client entries

`@wombat/client` exports generated types including `UsageRequest` and `UsageResult`, plus `UsageClient.query(request, { signal, onProgress })`. `UsageClient.prices({action:"status"|"update"}, {signal,onProgress})` returns generated `PricingResult` with the full catalog and version/source hashes. `UsageClient.live({query,mode,verify}, options)` is optional host functionality; Node supplies it and CLI uses it by default, while fixed snapshots use query. `createUsageClient(transport, pricingTransport, liveTransport, configTransport)` wraps narrow transports and validates the protocol. The portable entry contains neither Node nor React dependencies.

`@wombat/client/node` provides `createNodeClient({ binaryPath, timeoutMs, maxResponseBytes })` and owns local subprocess lifecycles. Callers do not handle arbitrary core operation strings. Other hosts can implement the same narrow transports and reuse generated contracts and validators.

Node's price transport downloads only the fixed official HTTPS document. The host request for the core `prices` operation includes document for update; status rejects it. Raw documents are absent from public request/response types. Rust parses and publishes them; other hosts must implement the same fixed-source retrieval flow.

## Read-only configuration contract v1

The source is `core/src/config_dto.rs`, generating [request](../schemas/config-request-v1.schema.json) and [response](../schemas/config-response-v1.schema.json). `UsageClient.config` is optional host functionality, validated by the fourth createUsageClient transport; Node and HTTP both provide it. Operations are list/detail/evidence/related_scopes/capabilities. Queries without readView rescan configuration; capabilities does not scan sources. Dates have an exclusive end, defaulting to the last30 days in UTC. Scope supports dates, directory, Agent, source and conversation; model or effort attribution is not provided.

Configuration responses independently use outputVersion=1. A readView pins configuration metadata and a usage reference together. The service retains at most8 configuration views globally for10 minutes; capacity eviction, expiry or restart returns VIEW_EXPIRED. Configuration views retain referenced usage for returning to the original turn. roots/projectRoots must match the creating request; new project authorization requires a new view. Web accepts only versions returned by that host and injects startup roots. Valid configuration views extend the core's idle lifetime until their retention period ends.

Scanning covers AGENTS.md / AGENTS.override.md, top-level MCP in config.toml, skills and .agents/skills under Codex roots; the default ~/.codex source also reads ~/.agents/skills. Explicit project roots cover root rules, .agents/skills and .codex/config.toml. It does not recursively discover projects, resolve arbitrary includes, or calculate configuration precedence or plugin loading. Limits are10 MiB per file,64 MiB total reads,10,000 inspected entries and10,000 new configurations, Skill depth8 and256 reported issues; limits produce resourceLimited. Missing items and unreadable items are distinct; unreadable items retain recent metadata marked stale.

Only safe metadata is retained in the product data directory's config-v1, with at most20,000 items per authorized scope and a16 MiB old-cache read limit. Content hashes cover the complete source file; MCP definitions share their containing file's hash. Configuration text, commands, environment values, tool schemas and recovery material are not stored; scanning neither uses the network nor executes MCP. Storage currently uses atomic JSON metadata and bounded in-memory views; the full proposal's typed SQLite tables and persistent composite versions remain unimplemented.

Explicit read_file events and native MCP events with a separate server field match by source and configuration identity; tool-name prefixes do not establish identity. File reads are separately classified as loaded_only, not explicit Skill calls. Matching a current file cannot establish its historical content version, and incomplete coverage never produces an unused conclusion. Associated turns use a union of unique measurements; the summary does not charge a shared turn repeatedly across configurations. Missing associated usage stays absent. Evidence queries currently traverse complete safe facts; incremental association indexes and estimate caches are not implemented. Content returns actual UTF-8 bytes only; token estimates and MCP schema sizes are unavailable. Cancellation closes the request transport and isolates late results; an already-started core scan is resource-bounded but has no per-request cooperative cancellation yet.
