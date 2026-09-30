# CLI command entry

[中文](README.md) | English

`@wombat/cli` parses arguments, emits text or JSON, and composes noninteractive queries with OpenTUI startup. The [CLI guide](../docs/agent-cli.md) owns user-facing commands and options.

## Public entries

- The package root exports argument parsing and `runUsageCli`; `./format` exports result text formatting.
- `refresh`, `usage`, `threads`, `turns`, `steps`, and `prices` call the shared core through `@wombat/client/node`.
- Only the interactive entry loads `@wombat/tui`; help, version, JSON, and noninteractive queries do not initialize the terminal.

- Presentation language uses `@wombat/client/locale`; see [product language and copy](../docs/i18n/product.en.md).

## Limits and verification

The CLI owns arguments, output, progress, and exit codes, not pricing or snapshot semantics. JSON progress goes to stderr and results to stdout; after a build, verify argument errors, partial results, and complete command paths under the [CLI rules](AGENTS.md).
