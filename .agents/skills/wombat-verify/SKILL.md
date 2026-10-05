---
name: wombat-verify
description: Select verification scope and report evidence for Wombat cross-module changes, regressions, and release preparation; use when test and acceptance coverage needs judgment.
---

# Wombat Change Verification

Map the actual diff to owners and observable failure paths. [Root completion requirements](../../../AGENTS.md) remain authoritative.

Use `corepack pnpm skills:verify -- --scope <scope>` as the primary runner:

| Scope | Checks |
|---|---|
| `repository` | Source repository rules and whitespace; no build prerequisite |
| `client` | Build, types, and whitespace; add relevant focused behavior tests separately |
| `full` | Build, types, complete product tests, repository rules, and whitespace |

The runner stops on the first failure and reports completed stages. It resolves its repository from its own location rather than the caller's directory. Do not reload script source for ordinary execution. Rust-only, dependency, performance, and platform-specific work still needs the focused checks in the owning workflow; these scopes do not replace them.

Use independent synthetic truth for accounting and isolated valid/invalid fixtures for changed checks. Verify assembled product entries, browser interactions, and installed assets separately; mocks alone do not prove delivery.

Do not repeat unaffected passing checks. Diagnose failures and rerun affected paths; report commands actually run, results, build/corpus/platform conditions, and remaining gaps. A successful script does not establish a complete product journey.
