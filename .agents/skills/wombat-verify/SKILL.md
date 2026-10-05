---
name: wombat-verify
description: Select verification scope and report evidence for Wombat cross-module changes, regressions, and release preparation; use when test and acceptance coverage needs judgment.
---

# Wombat Change Verification

This Skill selects verification; it does not replace [root completion requirements](../../../AGENTS.md) or define product behavior.

1. Map the actual diff to Rust, generated contracts, client, CLI, Web, data, and release entries. Identify observable changes and failure paths. Read affected scoped instructions and documentation owners.
2. Select the smallest meaningful fixtures and commands, distinguishing source checks from built-artifact acceptance. Run repo:check without dist for repository rules. Changed checks need isolated valid and violating fixtures, nonzero exits, and useful diagnostics. Rust algorithms use independent synthetic truth; cross-language and CLI tests first rebuild dist. Verify Web hosts, browser interactions, and installed assets separately.
3. Review [code conventions](../../../docs/development/workflow.en.md): authorization/version enforcement at execution, publication after commit, cancellation/cleanup, and whole-output limits. Choose fault cases only for affected paths. Product behavior needs a real assembled entry, not manually composed mocks alone. Broaden to types, contracts, end-to-end behavior, licenses, public packages, or performance according to risk; use corepack pnpm repo:check for static rules without repeating unaffected passing checks.
4. Follow the [failure investigation rules](../../../docs/development/workflow.en.md#failure-investigation): establish the root cause, inspect every matching entry, batch repairs, and verify the failure class before aggregate or platform retries. Report commands actually run, results, and build/corpus/platform conditions. State unverified sources, platforms, and visual details explicitly.

Record only actual outcomes. Test counts, old snapshots, successful builds, or a green script alone do not establish a complete product journey.
