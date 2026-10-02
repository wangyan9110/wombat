# Decision: Physical configuration identity, complete rechecks and shared review records

[中文](2026-10-02-rule-review-integrity.md) | English

Status: implemented

## Problem

Identical declaration content does not prove ownership by the same project. Complete reads do not confirm heading/reference applicability, so rechecks cannot interpret unknown as repaired. Overlapping authorized directories and multiple log sources inventory the same local file: source identities must survive without producing separately ignored suggestions for one file. Copying full evidence into each history event and decoding all history before pagination increases disk and memory use with history size.

## Decision

Rules use static-config-v4. Each declared relation binds source instance, authorized project, declaration path/hash, relation ID and kind, with its own Complete/Unknown assessment and member set. Prior relation evidence can be rechecked only when applicability and every member are complete. Legacy evidence without relation identity stays unavailable. Invalid declarations, unknown headings/reference bases, limited members or output cannot pass. Exact text, positions and per-source declarations stay independent; actual loading is not inferred.

Current local configuration aggregates by canonical path, kind and native key, retaining all source inventory identities and overlapping authorization memberships. The compatible single-source field is presentation only. Shared project files are collected once; source-specific global/project scopes are checked separately. Each current physical object has one suggestion; ignore/restore/mark/recheck operate consistently on it. Events and ledger facts remain source-specific, with associated usage computed from set unions; aggregation or repeated reads never reduce the ledger. Versions changing between reads retain separate entries and expose a gap. Legacy caches and review records remain authorized through their original source identities.

The independent user database upgrades to user_version=1. Immutable safe evidence, item and original baseline share review_parts; state events and record identities use review_events, with internal JSONB. Hashes select candidates followed by exact JSON comparison to avoid collision-based sharing. Latest-state queries read lightweight metadata; authorization/project/category filtering and pagination execute in SQLite before decoding. Rechecks select the latest event per physical object. Legacy decisions migrate row by row transactionally, preserving sequence/identity/original evidence; failure rolls back the batch, unknown versions are refused, and one compaction follows commit. Index rebuilding or automatic space cleanup never deletes user history.

## Alternatives considered

Declaration hashes alone still confuse projects; file-read completeness alone still treats unknown conditions as passed. Removing source identity would break event attribution, so physical objects and per-source facts are layered. Full Suggestion copies and in-memory pagination retained a simple layout but repeated evidence and paging memory grew with record count; shared facts and database paging replace it. No separate cost-allocation algorithm or automatic configuration writing is introduced.

## Impact and validation

Output v1 stays compatible; Rust generates new compatible fields. Legacy rules/records remain readable, but old declared evidence without the new relation identity cannot automatically pass; old ignores cannot hide new rules. Records are limited to20,000. A4MiB cache,512-page checkpoint and8MiB retained-WAL target are not process/disk hard limits. Queries still scan lightweight history metadata; sharing depends on repeated evidence and migration includes transaction/compaction costs.

Synthetic regressions cover unknown conditions, identical declarations across projects, incomplete relation members, overlapping authorization, shared files across two sources with independent same-ID ledgers, complete handling flows, legacy record identities/baselines, migration rollback, future versions and decoding only the requested page. CLI/Web agree at a fixed version. Runs, measurement conditions and unverified platforms are recorded in [progress](../../../project/progress.en.md) and [contracts](../../../development/contracts.en.md); these do not open Hook, actual injection, execution or undo.
