# Decision: Remove the TUI product and dedicated tools

[中文](2026-10-01-remove-tui.md) | English

Status: implemented

## Problem

The product retains GUI, CLI, and CLI+Web; new pages do not migrate the old terminal structure. Local Web is implemented, so maintaining OpenTUI would retain a separate rendering, FFI, dependency, and acceptance path.

## Decision

Following the user's explicit sequence, commit and push the Web baseline as `74ca1bb`, then remove the TUI module, interactive launcher, dedicated messages, preview/PTY scripts, CI terminal journeys, and dedicated HTML-to-OpenTUI skill. Shared progress messages remain in the client locale module.

Bare `wombat` prints usage text just like `wombat usage`; `wombat web` explicitly starts interactive pages. Retain Rust, generated contracts, old-snapshot reading, CLI, and Web without creating a Tauri project. This decision supersedes transitional TUI retention in the [local Web decision](2026-10-01-local-web.en.md).

## Alternatives considered

The previous plan retained the TUI until desktop implementation. The user explicitly requested removal now, ending transitional terminal maintenance. The pushed Git baseline preserves the old implementation; historical progress and evidence do not establish current functionality.

## Impact and verification

Old terminal shortcuts, theme environment variables, and FFI startup are unavailable. The terminal guide retains a retirement notice and current entry points so historical links remain valid; user logs and product data directories are unchanged.

Verification covers default text output with terminal flags, the CLI/Web shared core, cancellation, builds, types, module boundaries, dependency licenses, and installed packages. Actual results and platform limits are recorded in verification records retained in Git history.
