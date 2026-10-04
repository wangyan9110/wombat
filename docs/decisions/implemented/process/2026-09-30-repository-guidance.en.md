# Decision Note: Repository guidance and bilingual confirmation

[中文](2026-09-30-repository-guidance.md) | English

Status: implemented

## Problem

Existing rules were concentrated in the root file, making module, documentation, and Skill responsibilities easy to repeat. Chinese documents and English entry pages also lacked evidence of synchronized edits. Importing a large repository's entire governance system would add maintenance work that this project does not need.

## Decision

Keep repository-wide rules at the root and add local rules where modules, docs, and Skills own them; module READMEs describe public entries. Pair public pages with English within their respective directories, and use named confirmation records and static checks to catch accidental drift. Store lasting design rationale in this directory and continue selecting behavior tests by changed scope.

All AGENTS.md files use English. The root routes readers by task without requiring complete historical reads. Following [DeepSeek Harness documentation tiers](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/AGENTS.md), each fact has one owner: roadmap, support-matrix, and rolling progress documents are removed. Capabilities belong in module guides or technical references, unfinished requirements and acceptance belong only in the owning proposed decision, without separate specifications or status ledgers, and verification belongs in tasks, PRs, CI, or dedicated measurement artifacts. Old verification records remain retrievable from Git history without a replacement ledger.

A separate CI job checks source rules before platform builds. Isolated valid and invalid fixtures exercise document budgets, Skill metadata, and decision formats. English conversion adjusts subtree ceilings measured in non-whitespace characters; the root ceiling is unchanged.

Documentation checks reuse the pairing and budget manifests for title and paragraph structure; code, tables, quotations, and leading HTML branding keep their formatting. Architecture retains cross-module relationships, while Web limits and core persistence live beside their modules. The delivery workflow owns code conventions and distinguishes semantic review/behavior tests from mechanically checked rules.

Decision directories replace the hand-maintained index. Supersession review preserves applicable rationale and coverage gaps without maintaining obsolete runtime inventories. Wombat keeps its existing lifecycle and classes; no frozen archive or separate metadata catalog is introduced because the current tree does not need another maintained inventory. See [decision maintenance](../../README.en.md) and the upstream [Agent Note principles](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/README.md).

## Alternatives considered

- **Keep only the root file**: module detail would remain in every session's baseline context, while docs and Skills would lack nearby ownership.
- **Keep multiple status summaries**: each capability change would require updating several pages, increasing contradictions and Agent context. Existing fact owners and acceptance status are sufficient for current development.

## Consequences and verification

Local instructions, bilingual pairs, and focused scripts are now present; original Chinese-only pages have been organized by purpose and fully paired, leaving no legacy migration entries in the manifest. `repo:check` verifies rules, pairing, and public links but cannot establish translation meaning, product behavior, or terminal appearance; those still require human review and relevant tests.
