# Decision Note: Read-only configuration and composite read views

[中文](2026-10-01-config-inventory.md) | English

Status: implemented

## Problem

The four-entry upgrade needs a real configuration inventory and conversation links. Configuration files describe current state while logs provide only partial historical evidence. Combining them can mistake current content for historical versions or count a shared turn repeatedly as exclusive configuration cost.

## Decision

Rust owns configuration discovery and evidence queries. Web and CLI are peer consumers of the generated configuration v1 contract, without a unified CLI intermediary. Reads are restricted to fixed entry points under startup-authorized roots. Rules, Skills and MCP retain separate identities and coverage states. Only explicit file reads or native server fields establish links; tool prefixes do not identify a unique configuration instance.

Composite views pin safe configuration metadata and usage references, retaining at most8 versions for10 minutes. The service does not exit after its ordinary15-second idle timeout while a configuration view remains valid. References retained by configuration allow returning to original turns after ordinary usage-view eviction. Expiry and service restarts report explicit errors, and the page offers reload.

This delivery uses bounded in-memory views and atomic JSON metadata caching to complete the read-only flow. It does not prebuild tables for pending project registration or source writes; estimate caching and separate review records follow the later implemented decision. File reads remain a distinct evidence category, associated usage is deduplicated by measurement, and unrecognized states remain unknown. See the [configuration contract](../../../development/contracts.en.md) for implementation and resource boundaries.

## Alternatives considered

Typed SQLite configuration/association tables, persistent composite views and incremental indexes in the [full proposal](../../proposed/architecture/2026-10-01-config-analysis-web.en.md) remain future work; each evidence query currently traverses safe facts. The unified CLI intermediary was removed following the user's decision. The initial delivery returned bytes only; a fixed tokenizer is now verified and connected in the [measurement/review decision](2026-10-02-config-reviews.en.md), without character-ratio estimates.

## Impact and verification

Configuration queries do not change sources, probe the network, execute MCP or store configuration bodies, command arguments or environment values. Recent successful metadata distinguishes historical items from reading failures but cannot prove historical content. Transport cancellation isolates late results; core scans are resource-bounded, while cooperative cancellation, incremental association indexes, project registration and source execution remain pending; static suggestions and manual review records are connected.

Synthetic Rust tests cover escaping symlinks, cycles, no command execution, sensitive-value isolation, size limits, dates and view eviction. Web/CLI end-to-end tests cover consistent results, conservation under repeated reads, paging, version changes and reading failures. See [progress](../../../project/progress.en.md) for current verification and untested platforms; full proposal phases must not be marked complete as a whole.
