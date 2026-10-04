# Decision: read-only configuration and composite read views

[中文](2026-10-01-config-inventory.md) | English

Status: implemented

## Problem

Configuration files describe current state while logs provide only partial historical evidence. Mixing them can misrepresent current content as a historical version or repeatedly attribute a turn's usage as exclusive configuration cost. UI and CLI need consistent queries and reliable return navigation.

## Decision

Rust owns configuration collection, associations, and the evidence graph; Web/CLI consume generated contracts in parallel without a common CLI intermediary. Configuration authorization is separate from source scanning; current project discovery and authorization follow the [project-discovery decision](2026-10-04-observed-project-discovery.en.md). Reliable file reads, native server identities, and explicit events remain distinct; tool prefixes do not identify a unique configuration instance.

Composite views pin safe configuration metadata and usage references, allowing return to original turns during retention after ordinary usage views expire. Expiration or service restart fails explicitly rather than silently switching versions. The [configuration contract](../../../development/contracts.en.md) owns current formats, retention, and resource limits.

Bounded in-memory views and an atomic JSON metadata cache avoid prebuilding database tables for undelivered capabilities. Last-success metadata distinguishes historical items from read failures but does not prove historical content or loading. The [measurement decision](2026-10-02-config-reviews.en.md) owns measurement methods and independent user-record rationale.

## Alternatives considered

Typed SQLite configuration/association tables, persistent composite views, and incremental dependency indexes could reduce traversal of safe facts, but require version consistency, invalidation, partial-failure, and cleanup design rather than a storage-format swap. Retain the bounded implementation until measured query costs justify this candidate, without rewriting the usage ledger or moving indexing into UI/Node.

A common CLI intermediary would bind product operations to command assembly, so hosts consume shared contracts directly. Applying current files to history or summing entire turns for each association is simpler but cannot establish historical truth or conservation. Related usage must union explicit measurement identities within scope.

## Consequences and verification

Configuration queries do not modify sources, start MCP servers, probe networks, or save content, command arguments, or environment values. Transport cancellation isolates late results. Cooperative cancellation, persistent composite views, and incremental association indexes still need independent implementation and acceptance; these candidates are not implemented decisions.

Existing synthetic tests cover escaping symlinks, cycles, non-execution, sensitive-value isolation, limits, and view eviction. Web/CLI end-to-end tests cover association conservation, pagination, version changes, and read failures. [Unfinished proposal](../../proposed/product/2026-10-03-optimization-lifecycle.en.md) owns actual product gaps.

The former configuration-analysis proposal retains these pending scale criteria: a fixed corpus of 100,000 measurements, 100,000 operations, 10,000 configuration items, and 100,000 association edges; report cold/warm caches, segment timings, p50/p95, process memory, and result consistency separately. Warm-query p95 ≤300ms is a target, and regressions above 10% on established paths require investigation, not a measured guarantee. Persistent versions, incremental updates, cancellation, and limit failures require assembled-entry and fault tests rather than interface examples.
