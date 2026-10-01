# CLI command entry

[中文](README.md) | English

`@wombat/cli` parses arguments, emits text or JSON, and composes queries with local Web startup. The [CLI guide](../docs/guides/cli.en.md) owns user-facing commands and options.

## Public entries

- The package root exports argument parsing and `runUsageCli`; `./format` exports result text formatting.
- `refresh`, `usage`, `threads`, `turns`, `steps`, and `prices` call the shared core through `@wombat/client/node`.
- With no subcommand, the CLI prints usage text, just like `usage`; `web` explicitly starts interactive pages.

- Presentation language uses `@wombat/client/locale`; see [product language and copy](../docs/i18n/product.en.md).

## Limits and verification

The CLI owns arguments, output, progress, and exit codes, not pricing or snapshot semantics. JSON progress goes to stderr and results to stdout; after a build, verify argument errors, partial results, and complete command paths under the [CLI rules](AGENTS.md).

## Web Assembly

`wombat web` dynamically loads the local host, injects a Node client, and serves packaged `dist/web/` assets. The CLI owns startup links and shutdown; startup arguments fix source scope.
