# OpenTUI terminal interface

[中文](README.md) | English

`@wombat/tui` provides the Chinese interactive usage and conversation views. It queries an injected `UsageClient` and neither reads raw logs nor starts the core; see the [terminal guide](../docs/terminal.md) for product operation.

## Public entry

- `startTerminalApp(initial, client)` starts the terminal interface with an initial request and typed client.
- Pages own navigation, filter drafts, expansion, scrolling, and themes; the core still decides sources, accounting, pricing, and aggregation.
- Components use native OpenTUI layout and input; native rendering tests verify confirmed visual mappings.

## Limits and verification

The terminal controls fonts, and browser prototype pixels do not equal terminal cells. Synthetic clients, native rendering, and real PTY runs establish different kinds of evidence; report untested states and platforms under the [TUI rules](AGENTS.md).
