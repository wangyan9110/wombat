# Decision Note: Configuration measurement and manual review records

[中文](2026-10-02-config-reviews.md) | English

Status: implemented

## Problem

Current content size, historical read counts and associated turn usage are separate facts. Character-ratio estimates, treating reads as Skill calls, or retaining permanent ignore decisions only in derived indexes produce unverifiable results. The upgrade needs consistent Web/CLI static reminders and complete manual rechecks.

## Decision

Rust measures complete UTF-8 AGENTS.md / SKILL.md using a fixed offline ordinary o200k_base reference, recording method, fingerprint and applicability. Bytes, Unicode code points and descriptions are measured independently. Locked encoding/dependency versions are checked against independent official synthetic truth. Missing complete MCP definitions, limits and failures remain unknown. Only numbers are cached by method/fingerprint, without bodies. Exact directory-entry checks prevent misidentifying AGENTS.md on case-insensitive filesystems.

Static format, description and file-size reminders merge by object with repair priority. Thresholds are product reminders; budget limits or unsupported YAML extensions are not host format errors. Suggestion identity binds object, source, content, findings and scope, preventing ignores from swallowing independent new problems. Web/CLI consume generated optimize v1 as peers without a unified CLI intermediary.

Irreplaceable user records live separately in user-v1 SQLite. Transactions check decisionRevision, and acknowledged retries do not append duplicates. Rebuilding derived configuration cannot clear decisions. Editing occurs outside the product, and direct rechecks recollect current facts; incomplete checks never pass. Initial observations preserve original evidence, decisions remain separate from check results, and handling records have distinct identities. Language preferences atomically save through an independent narrow zh/en-only interface.

## Alternatives considered

Character ratios cannot establish tokenization truth, and keeping ignore decisions in a derived configuration cache would lose user intent during rebuilding; use independent tokenization and user storage. [Native Codex handoff](2026-10-03-native-codex-handoff.en.md) supersedes a Wombat-owned generation, rewriting, cleanup, and recovery service. Checks and user decisions remain independent. Inactivity, MCP failures, and space candidates require complete observation or source adapters rather than demonstrations.

## Impact and verification

The [contract](../../../development/contracts.en.md) owns current event adapters and resource boundaries; [unfinished proposal](../../proposed/product/2026-10-03-optimization-lifecycle.en.md) owns outstanding acceptance rather than a duplicate feature list here. Source code does not write Agent configuration or execute its commands; indexes and user records write only to the product directory.

Independent tokenization vectors, failure/retry deduplication, all dates, fixed read views, retained user records, new problems, recheck failures, and entry parity require synthetic truth. Collection benchmarks report latency, peak Rust memory, and result consistency. Browser and platform conclusions require evidence for the corresponding build.

Measure bodies independently and distinguish description product reminders from specification findings. Identity includes effective parameters and unknown bodies cannot pass rechecks. The [review-integrity decision](2026-10-02-rule-review-integrity.en.md) owns shared-evidence and SQL-pagination tradeoffs; this note does not duplicate current rule versions or field catalogs.

Suggestion value and text comparisons remain presentation concerns, reusing config evidence deduplication and its pinned usageRevision rather than a second cost-association algorithm. Initial observations preserve original safe measurements, establishing the comparison baseline on the first recheck; later rechecks must not replace it with updated item metadata. Incomparable measurements remain unknown. Date changes do not recheck current configuration; turn round trips preserve the original route, and related cost or text changes are never savings.
