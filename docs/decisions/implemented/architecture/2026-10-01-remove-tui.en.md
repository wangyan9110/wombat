# Decision: Remove the TUI product and dedicated tools

[中文](2026-10-01-remove-tui.md) | English

Status: implemented

## Problem

The product retains GUI, CLI, and CLI+Web; new pages do not migrate the old terminal structure. Local Web is implemented, so maintaining OpenTUI would retain a separate rendering, FFI, dependency, and acceptance path.

## Decision

Remove the TUI module, interactive launcher, dedicated messages, preview/PTY tools, CI terminal journeys, and dedicated skill, ending the separate terminal maintenance path. Shared progress messages remain in the client locale module.

The CLI defaults to text and Web provides local interaction; the [CLI guide](../../../guides/cli.en.md) owns commands. Shared Rust and generated contracts remain, while this removal does not deliver desktop. Reads follow the [current-format decision](2026-10-03-current-format-only.en.md), without an old-snapshot compatibility requirement.

## Alternatives considered

The previous plan retained the TUI until desktop implementation. The user explicitly requested removal now, ending transitional terminal maintenance. The pushed Git baseline preserves the old implementation; historical progress and evidence do not establish current functionality.

## Impact and verification

Remove obsolete terminal shortcuts, theme environment variables, FFI startup, and the retired guide. Source history retains the former implementation without becoming current capability or operating guidance.

Verification covers default text output with terminal flags, the CLI/Web shared core, cancellation, builds, types, module boundaries, dependency licenses, and installed packages. Actual results and platform limits are recorded in verification records retained in Git history.
