# Decision Note: shared presentation language and section-based document pairing

[中文](2026-09-30-localization.md) | English

Status: implemented

## Problem

Chinese CLI/TUI copy was spread across presentation functions, and some interactions inferred actions from button text. Whole-file document hashes could not directly identify stale sections and made independent edits prone to conflicts.

## Decision

Wombat uses the portable `@wombat/client/locale` presentation entry, complete Chinese and English message dictionaries, typed parameters, immutable language state, and subscriptions. Action identifiers are independent of copy, and module-level labels resolve lazily; language does not enter the Rust business protocol.

Documentation structure is compared through a Markdown syntax tree, with section hashes keyed by English heading paths. Both languages are paired within the same topic directory, using JSON records and an explicit pairing manifest. Legacy monolingual pages are now paired; old records migrate only when their original hashes match. Review still owns semantics; hashes record confirmation only.

## Alternatives considered

- Retain whole-file hashes and regular-expression checks: less implementation, but no accurate comparison of nested lists, tables, or section changes.
- Add persistent preferences and arbitrary language packs together: this iteration keeps command options, environment variables, and session switching to avoid widening configuration writes and plugin lifecycle scope.

## Impact and verification

Arguments, error codes, tokens, amounts, model names, and source content retain their original values. Unknown core diagnostics may remain Chinese; this does not claim translation of every protocol message. See [product language](../../../i18n/product.en.md) for usage and limits.

Verification covers changed-section reporting, code-block parity, nested lists, tables, links, dictionary parameters, runtime switching, native terminal behavior, and preservation of original titles. Full builds and behavior checks still follow repository verification rules; test counts do not establish every platform or visual acceptance.
