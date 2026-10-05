# CLI command entry

[中文](README.md) | English

`@wombat/cli` parses arguments, emits text or JSON, and composes queries with local Web startup. The [CLI guide](../docs/guides/cli.en.md) owns user-facing commands and options.

## Public entries

- The package root exports argument parsing and `runUsageCli`; `./format` exports result text formatting.
- `refresh`, `usage`, `threads`, `turns`, `steps`, `prices`, `optimize`, and `timing` call the shared core through `@wombat/client/node`.
- With no subcommand, the CLI prints usage text, just like `usage`; `web` explicitly starts interactive pages.

- Presentation language uses `@wombat/client/locale`; see [product language and copy](../docs/i18n/product.en.md).

## Limits and verification

The CLI owns arguments, output, progress, and exit codes, not pricing or snapshot semantics. JSON progress goes to stderr and results to stdout; after a build, verify argument errors, partial results, and complete command paths under the [CLI rules](AGENTS.md).

## Whole-turn timing

`wombat timing` (or `timing summary`) requires full task and turn identities. It defaults to one JSON object; `--text` selects localized text and conflicts with `--json`. `--share` requests the core's separate projection. `timing evidence` requires the same target and a fixed snapshot, with opaque cursors and pages of 1..200 rows. `--collection` selects `turn_events` (default), `use_objects`, or `use_records`; only `use_records` accepts `--object` to select an object. Cursors retain the same snapshot, target, and collection. Whole-turn and associated use counts remain separate, and missing membership evidence is not replaced with zero; `timing capabilities` accepts no target or source paths and performs no scan. Timing bypasses automatic prices, configuration, Hook capture, and account observations.

Summary exit codes follow core quality: 0 for complete inspected scope even when optional values are unknown, 2 for partial or provisional results, 1 for errors, and 130 for cancellation. Successful evidence navigation and capability queries return 0 without inferring turn completeness. JSON errors use safe v1 templates; source paths and underlying error details are not printed. Independent synthetic CLI tests do not establish real-core or browser acceptance.

Localized `--text` summaries also print the core Work metrics: operation outcomes, file-change records and reported paths, and user-input/injected-context/reasoning records. Command-classified duration is currently unsupported; added and removed line counts are unknown because no historical repository baseline is available. Values keep their core-provided status and basis; unknown is not zero. Reported paths may include failed or declined terminal outcomes and do not prove writes or net changes. User-input totals count physical records, not requests, and failed outcomes are not code-defect judgments. Source coverage is shown by the existing coverage line.

## Web Assembly

`wombat web` dynamically loads the local host, injects a Node client, and serves packaged `dist/web/` assets. The CLI owns startup links and shutdown; startup arguments fix source scope.
