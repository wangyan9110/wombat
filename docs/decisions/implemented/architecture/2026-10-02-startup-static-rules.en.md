# Decision: startup and bounded static rules

[中文](2026-10-02-startup-static-rules.md) | English

Status: implemented

## Problem

Waiting for preferences or network prices delayed usable first-page entry, and normal index waiting appeared as failure. Inferring loading from parent directories or similar text lacks evidence; copying conditions per occurrence and pairwise matching can amplify resources.

## Decision

UI renders the shell first and restores preferences asynchronously, prioritizing user choices. The clock belongs to the page. Older results remain scope-bound and allow same-scope drill-down after source update failure. Web injects a Node client without the automatic-price decorator and owns one bounded networking task. Rust retains eligibility, cross-process cooldowns, pricing, and fixed versions. Canceling a page wait does not cancel shared scanning for others; closing a host cancels only its networking work.

Rust uses locked pulldown-cmark for complete blocks and raw UTF-8 positions. Hashes select candidates followed by raw-byte verification. Full paragraphs/maximal lists, shared heading conditions, and grouped positions avoid copying long headings or pairwise matching. Bodies, dictionaries, and headings live only for the collection round; output contains safe version/position metadata. The [specification](../../../project/startup-rules.en.md) bounds bytes, blocks, positions, branches, and metadata. Limits expose gaps and cannot pass rechecks. There is no persistent body cache or process-wide hard memory guarantee.

An existing analysis.json in an authorized project expresses user-declared joint applicability and identity-v1 copy direction. It does not prove host loading, infer relationships from names, or read paths outside the inventory. Copies compare full bytes without assuming the original is correct; fingerprints include both versions and the declaration. Missing files, permissions, resource limits, or insufficient relations do not establish resolution. User records remain separate, old records readable, and index rebuilding cannot clear them.

Hook support has no effective-registry adapter and reports no_verified_adapter; actual injection and execution remain closed. Storage failures and unsupported index formats publish explicit codes and preserve original records without automatic clearing or rebuilding.

## Alternatives considered

Blocking preferences and prices ties first results to unnecessary work. Guessing loading from directories or textual similarity confuses user intent with host facts. Explicit declarations and raw verification are used instead of character-fragment duplication ratios, executing Hooks for verification, or actual model calls. Persistent incremental block caching requires separate versioning, invalidation, and cleanup design after collection-cost evidence warrants it.

## Impact and verification

A Markdown dependency and licenses are added, the initial rules used static-config-v3, with current v4 evidence constraints recorded in the [integrity decision](2026-10-02-rule-review-integrity.en.md), and Rust generates public DTOs. Synthetic truth covers Chinese/CRLF, complete units, example exclusion, heading conditions, collisions, Skill-body positions, huge-group limits, related-version/declaration changes, and insufficient rechecks. CLI/HTTP agree at a fixed version. Web tests cover first results before prices, shared flights, and lifecycle; storage tests cover controlled SQLite quota exhaustion and unsupported-index rejection with records retained.

See verification records retained in Git history for local measurements and browser scope. This does not establish actual disk exhaustion, every permission failure, other platforms, million-record scale, 24-hour residency, or actual injection/Hook health. Local parsing time is not presented as complete first-start latency.
