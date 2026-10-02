# Decision Note: Configuration measurement and manual review records

[中文](2026-10-02-config-reviews.md) | English

Status: implemented

## Problem

Current content size, historical read counts and associated turn usage are separate facts. Character-ratio estimates, treating reads as Skill calls, or retaining permanent ignore decisions only in derived indexes produce unverifiable results. The upgrade needs consistent Web/CLI static reminders and complete manual rechecks.

## Decision

Rust measures complete UTF-8 AGENTS.md / SKILL.md using a fixed offline ordinary o200k_base reference, recording method, fingerprint and applicability. Bytes, Unicode code points and descriptions are measured independently. Locked encoding/dependency versions are checked against independent official synthetic truth. Missing complete MCP definitions, limits and failures remain unknown. Only numbers are cached by method/fingerprint, without bodies. Exact directory-entry checks prevent misidentifying AGENTS.md on case-insensitive filesystems.

Static format, description and file-size reminders merge by object with repair priority. Thresholds are product reminders; budget limits or unsupported YAML extensions are not host format errors. Suggestion identity binds object, source, content, findings and scope, preventing ignores from swallowing independent new problems. Web/CLI consume generated optimize v1 as peers without a unified CLI intermediary.

Irreplaceable user records live separately in user-v1 SQLite. Transactions check decisionRevision, and acknowledged retries do not append duplicates. Rebuilding derived configuration cannot clear decisions. Editing occurs outside the product and marking requires recollection; incomplete checks never pass. History has separate record identities and original evidence. Language preferences atomically save through an independent narrow zh/en-only interface.

## Alternatives considered

Character ratios lack tokenizer truth and are not used. Derived configuration caches would lose ignore decisions on rebuild, so records use separate storage. Automatic rewriting/cleanup lacks ChangePlan, recovery material and conflict verification and remains closed; manual processing/recheck is delivered first. Inactivity, MCP faults and storage cleanup require complete observation or source-specific resource adapters rather than prototype values substituting for evidence.

## Impact and verification

First-delivery static checks/manual reviews are connected. Explicit Skill invocation/MCP resource events, continuous-coverage inactivity, faults, storage cleanup, execution/undo, persistent composite views, cooperative cancellation, project registration and Tauri remain pending. See [contracts](../../../development/contracts.en.md) for methods, budgets, record limits and states. Code never writes Agent configuration or executes its commands; indexes and user records write only product data.

Synthetic tests cover independent token vectors, failure/retry deduplication, all dates, old views, durable records, new findings, recheck faults and peer-entry consistency. Release collection benchmarks record elapsed time, peak Rust memory and result consistency. Interpret browser/platform boundaries only through actual [progress](../../../project/progress.en.md) evidence; the complete proposal remains proposed.

The2026-10-02 threshold revision uses static-config-v2: exact-body measurement, distinct description product/specification findings and no Skill file-byte reminder. Identity includes effective parameters while records retain defaults/overrides; old records cannot suppress new rules. Rechecks retain current parameters and unknown bodies cannot pass. Existing DTOs gain compatible default fields: old configuration remains unknown and old records readable. Outputv1 remains; the user database now migrates to shared review parts with SQL pagination, as recorded in the [integrity decision](2026-10-02-rule-review-integrity.en.md); see [specification](../../../project/config-upgrade.en.md).

Suggestion value and text comparisons remain presentation concerns, reusing config evidence deduplication and its pinned usageRevision rather than a second cost-association algorithm. mark_edited retains the original safe measurement baseline, which later rechecks must not replace with updated item metadata; absent baselines in old records remain unknown. Date changes do not recheck current configuration; turn round trips preserve the original route, and related cost or text changes are never savings.
