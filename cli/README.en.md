# CLI command entry

[中文](README.md) | English

`@wombat/cli` parses arguments, emits text or JSON, and composes queries with local Web startup. The [CLI guide](../docs/guides/cli.en.md) owns user-facing commands and options.

Agent calls use `api` for local method/Schema discovery and `call` for one bounded JSON request on stdin. The envelope derives from Rust; dispatch uses public typed clients and shares exit policies with human commands. See the CLI guide for syntax, budgets and recovery.

## Public entries

- The package root exports argument parsing and `runUsageCli`; `./format` exports result text formatting.
- `refresh`, `usage`, `threads`, `turns`, `steps`, `prices`, `optimize`, and `timing` call the shared core through `@wombat/client/node`.
- With no subcommand, the CLI prints usage text, just like `usage`; `web` explicitly starts interactive pages.

- `skill install/status/uninstall` manages independent local copies; Codex owns formal plugins. `web --context FILE` validates and opens a scoped view.

- Presentation language uses `@wombat/client/locale`; see [product language and copy](../docs/i18n/product.en.md).


## Agent interface principles

The interface follows [Google Workspace CLI’s method discovery](https://github.com/googleworkspace/cli#why-gws), [MCP’s structured tool contracts](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), and [CLI Guidelines](https://clig.dev/#output). Apply these principles when adding a method:

| Principle | Wombat implementation |
|---|---|
| One contract owner | Rust defines product params and output; generation supplies types, validators and schemas. The CLI does not maintain another field catalog. |
| Discover before composing | A small local method list comes first. Read one input schema as needed; output schemas are optional. Discovery performs no scan or model call. |
| Explicit context | Pass exact roots, projects, dates, timezone and full IDs. Preserve returned snapshots/read views and pagination instead of hidden session defaults. |
| Bounded structured IO | Read one validated JSON request from stdin; emit one owning JSON result. Keep progress on stderr and support cancellation, input/output bounds and method-specific budgets. |
| Complete capabilities | Dispatch existing typed client methods with all generated params. Skills select workflows; they do not substitute a narrower business API. |
| Preserve evidence semantics | Complete totals, page rows, omitted detail, partial coverage, unknowns and observed zero remain distinct. Compact output is a core projection. |
| Recover without guessing | Stable error codes and recovery hints guide the next request. Expired views require reacquisition; changed params require revalidation. A timeout or hint does not authorize repeating a mutation. |

Schema validation proves structure only. Product validation still checks supported combinations, authorized targets and version-bound selection. Acceptance must test malformed and unsupported requests, fixed-view paging, partial results, cancellation and installed entries. A successful mock does not establish a real Agent journey.

## Limits and verification

`optimize` text separates user decisions and reasons from current checks and the original assessment, and presents core recheck comparability directly. Keep, not applicable, and missing evidence do not imply resolution.

The CLI owns arguments, output, progress, and exit codes, not pricing or snapshot semantics. JSON progress goes to stderr and results to stdout; after a build, verify argument errors, partial results, and complete command paths under the [CLI rules](AGENTS.md).

## Whole-turn timing

`wombat timing` (or `timing summary`) requires full task and turn identities. It defaults to one JSON object; `--text` selects localized text and conflicts with `--json`. `--share` requests the core's separate projection. `timing evidence` requires the same target and a fixed snapshot, with opaque cursors and pages of 1..200 rows. `--collection` selects `turn_events` (default), `use_objects`, or `use_records`; only `use_records` accepts `--object` to select an object. Cursors retain the same snapshot, target, and collection. Whole-turn and associated use counts remain separate, and missing membership evidence is not replaced with zero; `timing capabilities` accepts no target or source paths and performs no scan. Timing bypasses automatic prices, configuration, Hook capture, and account observations.

Summary exit codes follow core quality: 0 for complete inspected scope even when optional values are unknown, 2 for partial or provisional results, 1 for errors, and 130 for cancellation. Successful evidence navigation and capability queries return 0 without inferring turn completeness. JSON errors use safe v1 templates; source paths and underlying error details are not printed. Independent synthetic CLI tests do not establish real-core or browser acceptance.

Localized `--text` summaries show command, compaction, reasoning and MCP interval unions and sums, covered and unclassified durations, and overlapping-category durations from the core. They also print the core Work metrics: operation outcomes, file-change records and reported paths, and user-input/injected-context/reasoning records. Command-classified duration is currently unsupported; added and removed line counts are unknown because no historical repository baseline is available. Values keep their core-provided status and basis; unknown is not zero. Reported paths may include failed or declined terminal outcomes and do not prove writes or net changes. User-input totals count physical records, not requests, and failed outcomes are not code-defect judgments. Source coverage is shown by the existing coverage line.

## Unsupported formats and recovery

Wombat rejects unknown snapshot and index formats without migrating or deleting the original data. If an explicitly selected old fixed snapshot is unsupported, `wombat refresh` recollects the available sources through the current live path and publishes a current-format fixed snapshot; it does not convert the old snapshot. An upgrade refusal can come from the `live-v2` index container (`INDEX_UNSUPPORTED_VERSION`) or from a stored source mapping or observation header inside that index (`UNSUPPORTED_VERSION`), such as an older message-observation mapping. The CLI has no supported in-place repair or recollection command for either live-store error. `wombat refresh` uses that live path and does not repair incompatible stored state. Preserve the original data directory and user decisions; do not delete the index to recover. A different `WOMBAT_DATA_HOME` is an isolated data store, not a repair, and does not carry the original store's user decisions.

## Web Assembly

`wombat web` dynamically loads the local host, injects a Node client, and serves packaged `dist/web/` assets. The CLI owns startup links and shutdown; startup arguments fix source scope.

Timing text renders repeated-behavior aggregates with duration provenance, request observations and localized coverage reasons. JSON retains the generated response unchanged. Calculation and sharing semantics belong to the [core reference](../core/README.en.md).

## Collection entries

`setup` reports separate runtime, discovery and registration observations without installation or model execution. `collection` exposes core preferences, status, safe event pages and pause/resume; JSON is the generated version 1 response. Machine-wide preference changes are distinct from project-filtered reads. `hook codex` is a bounded advisory stdin entry: it emits no stdout and exits 0 even when receipt fails, so it cannot supply model context or permission decisions. The [CLI guide](../docs/guides/cli.en.md) owns commands and limits.

`statistics` queries task distributions and period growth; `monitor` manages budgets and drives explicit periodic checks. The generated Agent API exposes monitoring as its own method. The [CLI guide](../docs/guides/cli.en.md) owns commands and running requirements; the [core](../core/README.en.md) owns calculations.

`monitor watch` reports temporary check failures on stderr and reloads plans on the next iteration, including `MONITOR_CHANGED` after a concurrent edit. Invalid requests remain terminal errors.

## Release updates

Release metadata reads stop and cancel the input above 4 MiB, including responses without a length header and local files; release archives use a separate 400 MiB bound.
