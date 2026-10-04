---
name: wombat-docs
description: Restructure or maintain Wombat documentation, scoped instructions, and decision records; verify ownership, current facts, bilingual changes, and repository checks.
---

# Wombat Documentation Maintenance

Use [documentation instructions](../../../docs/AGENTS.md) for ownership and [pairing](../../../docs/i18n/README.en.md) for language mechanics. This workflow does not define product behavior.

1. Identify the reader's task and existing owner. Classify the work as a user tutorial, technical reference, module contract, requirement, acceptance item, instruction, or decision. Read only the relevant owner, source, tests, and incoming navigation.
2. Set the page's scope before drafting. Keep cross-module relationships in architecture, module behavior beside code, unfinished requirements in owning proposals, and field inventories generated. Tutorials introduce prerequisites before actions, observable results, and recovery; references organize lookup topics. Do not add template sections or pages without a reader need.
3. Verify changed claims against source and execute newly documented operations when feasible. State missing credentials, platform coverage, or untested execution explicitly. Never convert a proposal, old result, or neighboring module's behavior into a current claim.
4. Move misplaced detail to an existing owner and replace the duplicate with a short link. Search distinctive phrases and inspect inbound links. Review source owners before merging; preserve failures, limitations, and outstanding requirements. Do not create separate specifications or status ledgers for the same decision.
5. For decisions, follow [decision maintenance](../../../docs/decisions/README.en.md). Search related notes before adding one, classify full/partial supersession, retain unique rationale, and update references with moves. Do not use an old note as a second current API reference.
6. Review the changed Chinese and English passages together using [terminology](../../../docs/i18n/terminology.md). Preserve untouched translations, commands, structure, and link meaning. Record only named, reviewed pairs with `corepack pnpm docs:i18n:record -- <Chinese file>`; do not re-record blindly or start translation agents automatically.
7. Run `corepack pnpm docs:check` and `git diff --check`; use `corepack pnpm repo:check` when changing rules or tools. Structure checks use the existing pairing/budget manifests. Review diagnostic locations; do not suppress checks or raise budgets merely to avoid editing.
8. Report owners changed, duplication removed, actual checks, and unverified operations. Keep execution evidence in the task or CI, not a new maintenance report.
