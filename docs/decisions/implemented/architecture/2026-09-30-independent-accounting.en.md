# Decision Note: Independent accounting, pricing, and source adapters

[中文](2026-09-30-independent-accounting.md) | English

Status: implemented

Extracted from the version-one specification on 2026-09-30. Current fields and support remain defined by the [architecture](../../../development/architecture.en.md), [source cases](../../../development/adapters.en.md), and [pricing reference](../../../reference/pricing.en.md).

## Problem

Usage must support drill-down from totals into conversations, turns, and measurements while preserving missing source evidence, cumulative telemetry, historical settings, and pricing conditions. Upstream daily aggregates cannot reconstruct these relationships. Coupling to another product's internal types and build chain would also constrain future Agents and presentation layers.

Version one investigated ccusage 20.0.24 at commit `ecb676cce27cb5dd0090c7804a5cecc35e8ba805`. Its [static source loading](https://github.com/ccusage/ccusage/blob/ecb676cce27cb5dd0090c7804a5cecc35e8ba805/rust/crates/ccusage-adapter-all/src/loader.rs) and [common types](https://github.com/ccusage/ccusage/blob/ecb676cce27cb5dd0090c7804a5cecc35e8ba805/rust/crates/ccusage-core/src/types.rs) informed boundary design. This pinned research version is neither a claim about current upstream capabilities nor a runtime or test dependency of Wombat.

## Decision

- Wombat independently maintains its fact-level ledger, standard API equivalent pricing, and common queries. Builds and routine tests do not depend on the ccusage package, copied source, or reconciliation. General-purpose libraries are reused when needed with their licenses retained.
- Sources use a static Rust adapter registry. Adapters own formats, identity, cache semantics, historical settings, replay, and deduplication; common queries consume normalized facts. Only Codex is registered for production. Heterogeneous test sources demonstrate protocol boundaries only.
- Capabilities are separate from actual field availability. Daily aggregates do not manufacture turns; operations without explicit associations receive no allocated cost; a failed source does not discard successful receipts from others.
- Catalogs, deterministic matching, and cost calculation are separate, using a locked decimal library. Non-cached input, cache reads, cache creation, and output do not overlap; reasoning is a subset of output. Official conversions, source reportedCost, legacy policies, and subscription payments remain distinct.
- Missing, zero, conflicting, and unpriced values remain explicit. Current configuration cannot supply historical models or providers. Tests use independent synthetic truth and conservation across layers.

## Alternatives considered

| Option | Tradeoff |
|---|---|
| Continue using ccusage internals for loading, aggregation, and pricing | Daily aggregates cannot express Wombat's detailed attribution; internal types and build closures couple products, so the business dependency was removed |
| Build a dynamic plugin marketplace immediately | Version one has one production source and capability differences still need real adapters to validate them; static registration meets current extension needs |

## Impact and verification

Wombat takes responsibility for source formats, historical compatibility, and official catalog maintenance. Future sources must pass capability, identity isolation, and partial-failure tests; adding a menu does not establish support.

A01–A12 boundaries and truth cases are in [source acceptance](../../../development/adapters.en.md), and pricing conditions are in the [pricing reference](../../../reference/pricing.en.md). The initial 67 tests, conservation across layers and all pages, independent build, and installation results are recorded in [historical progress](../../../project/progress.en.md) and [query evidence](../../../benchmarks/usage-v1-query-2026-09-30.json). Results apply to the recorded build and fixtures, not every Agent or historical format.
