# Decision: Physical configuration identity, complete rechecks and shared review records

[中文](2026-10-02-rule-review-integrity.md) | English

Status: implemented

The prior compatibility decision is superseded by [current formats before the first release](2026-10-03-current-format-only.en.md).

## Problem

Identical declaration content does not prove ownership by the same project. Complete reads do not confirm heading/reference applicability, so rechecks cannot interpret unknown as repaired. Overlapping authorized directories and multiple log sources inventory the same local file: source identities must survive without producing separately ignored suggestions for one file. Copying full evidence into each history event and decoding all history before pagination increases disk and memory use with history size.

## Decision

Each declared relation binds source instance, authorized project, declaration path/hash, relation ID and kind, with its own Complete/Unknown assessment and member set. Historical relation evidence can be rechecked only when applicability and every member are complete; the current format requires explicit relation identities. Invalid declarations, unknown headings/reference bases, limited members or output cannot pass. Exact text, positions and per-source declarations stay independent; actual loading is not inferred.

Current local configuration aggregates by canonical path, kind and native key, retaining all source inventory identities and overlapping authorization memberships. The single-source field is presentation only. Shared project files are collected once; source-specific global/project scopes are checked separately. Each current physical object aggregates one suggestion; historical content and problem versions remain distinct. Events and ledger facts remain source-specific, with associated usage computed from set unions; aggregation or repeated reads never reduce the ledger. Versions changing between reads retain separate entries and expose a gap. Operations bind authorized objects and specific suggestion identities.

The independent user database selected user_version=3 at that time. The [core README](../../../reference/core.en.md) owns the current record format and version; this note retains the original design and acceptance context. Immutable safe evidence, item, original baseline and checks share review_parts; state events and record identities use review_events, with internal JSONB. Hashes select candidates followed by exact JSON comparison to avoid collision-based sharing. Latest-state queries read lightweight metadata; authorization/project/category filtering and pagination execute in SQLite before decoding. Rechecks decode unresolved historical suggestions one at a time and check their original rules. Only empty databases are initialized; unsupported layouts or versions are rejected with original data retained. Index rebuilding or automatic space cleanup never deletes user history.

The user confirmed that execution receipts are unnecessary: rechecks determine problem outcomes. Initial observations preserve evidence so manual edits can be rechecked directly, without marking; observations do not count as handling history. Keep/not-applicable decisions and reasons are separate from rule results, and rechecks do not revoke decisions. Redisplay changes only the display decision. Original problems can pass, remain present or become unavailable; disappearance and absent new findings do not establish success. Recurring problems may be displayed again without rewriting prior handling history.

## Alternatives considered

Declaration hashes alone still confuse projects; file-read completeness alone still treats unknown conditions as passed. Removing source identity would break event attribution, so physical objects and per-source facts are layered. Full Suggestion copies and in-memory pagination retained a simple layout but repeated evidence and paging memory grew with record count; shared facts and database paging replace it. No separate cost-allocation algorithm or automatic configuration writing is introduced.

## Impact and validation

Current output v1 is generated from Rust, maintaining only current fields and physical-object identities. Rule versions and parameters are saved with review evidence. Records are limited to20,000. A4MiB cache,512-page checkpoint and8MiB retained-WAL target are not process/disk hard limits. Queries still scan lightweight history metadata; sharing depends on repeated evidence and persistence retains transaction-write costs.

Synthetic regressions cover unknown conditions, identical declarations across projects, incomplete relation members, overlapping authorization, shared files across two sources with independent same-ID ledgers, complete handling flows, record identities/baselines, unsupported-layout rejection, future versions and decoding only the requested page. CLI/Web agree at a fixed version. Runs, measurement conditions and unverified platforms are recorded in verification records retained in Git history and [contracts](../../../development/contracts.en.md); these do not open Hook, actual injection, execution or undo.
