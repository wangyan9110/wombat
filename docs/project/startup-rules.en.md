# Startup and deterministic rule upgrade specification

[中文](startup-rules.md) | English

2026-10-02. Status: A1–A4 are implemented; A5 has controlled-failure and local acceptance evidence with scale/platform work remaining. B0/B1/B2/B4 deliver deterministic branches; B3 only exposes an unavailable capability boundary. It supplements the [version-one specification](specification.en.md) and [configuration upgrade](config-upgrade.en.md), without replacing the [support matrix](../reference/support-matrix.en.md) or [implementation status](status.en.md). Public builds, tests, and contributions do not depend on external prototypes or private materials.

## Product boundaries

Keep Overview, Tasks, Configuration, and Optimize, with CLI and local Web consuming the same Rust business logic and generated contracts. Show tokens and estimated API cost together; distinguish missing, zero, unknown, and unpriced values. Default reads require no login, API key, model download, or model invocation. Source roots and current configuration read scope remain separate. Reliable historical working directories enter the local project catalog and can be read on demand after selection, without establishing historical loading state.

First reads organize active and archived history and build a derived index. The default 30-day display does not mean only 30 days are scanned. Do not require project registration, scan the entire disk, execute MCP/Hook/generator scripts, or modify source configuration. Source notifications and incremental synchronization discover projects first used while the host is running and add them automatically; directly opening an observed project requires no restart. The directory picker only adds sources or directories absent from history. Tauri and automated execution remain later deliveries. See the [initialization design](initialization.en.md).

## Existing capabilities and required changes

| Area | Reusable facts | New work |
|---|---|---|
| Four pages and drill-down | Fixed versions, full-scope totals, pagination, exact-turn returns, bilingual drawers | Reverify lifecycle states without rewriting the ledger |
| Page startup | Temporary local links, language fallback, persisted preferences | Render the shell first; asynchronous preferences must not overwrite a recent user language selection |
| First synchronization | `SYNC_PENDING`, two-second auto wait, ten-second fresh wait, background index commits | Map `SYNC_PENDING` to in-progress; page waiting time is not core scanning time |
| Existing results | Committed versions, `freshness`, isolated source failures | Show available older results and their time; update failure must not block their drill-down or label them current |
| Independent sections | Parallel trends/breakdowns, separately loaded recent tasks and recommendations | Independent states and retries; recommendation failure must not block basic usage |
| Official prices | Offline catalog, missing-price eligibility, cross-process cooldowns, unchanged fixed versions | Web returns basic usage first and offers a new version after background price updates; preserve the CLI's existing blocking update behavior separately |
| User decisions | Independent decision records, baselines, ignore/restore, unavailable review after deletion | Extend rule fingerprints and review scope; retain old records across index rebuilds |
| New deterministic rules | Complete reads, bytes/code points/reference tokens, content hashes, path boundaries | Block parsing, applicability chains, explicit copy relationships, and host Hook adapters; complete blocks, user-declared chains, and identity-v1 copies are delivered; Codex0.160.0 project registry observations for file declarations are integrated; the Unix static script subset is implemented; standalone/inline plugin JSON declarations and native-expanded static paths are bound; remaining dynamic expressions stay unknown, and Windows remains pending |
| Injection and execution | File-read and MCP-call facts | Actual fragments/contexts, execution, and recovery evidence are missing; keep unavailable |

## Phase A: startup and failure states

Page shell → local connection → organize history and commit an index → basic usage available → recent tasks and configuration recommendations finish independently. Show only observable states; without reliable totals, show no percentage or remaining time. Clear in-progress feedback after roughly one second and a longer-wait explanation after roughly ten seconds are interaction suggestions, not performance guarantees.

Distinguish first use without results, synchronization in progress, updating existing results, failed updates with readable older results, empty sources, tasks without measurements, unmatched filters, partial source failures, unknown/offline prices, current-request cancellation, expired connections, expired versions, unreadable configuration, unsupported formats and storage failure. Expand raw errors on demand; generic failure must not replace normal organization, and zero must not hide coverage gaps.

Use “Cancel waiting.” Stop the page request and follow-up, retaining committed indexes; shared background scanning may continue. Do not promise global stopping or undo. When the first wait is canceled before any successful commit, state that no results are available. Reentry reuses existing work; one window cannot cancel another.

Bind existing results and new queries strictly to source, scope, dates, model, and version. Older scopes cannot appear as results for a new scope; discard late responses. Preserve the original version while reading tasks/details and offer updates. Recover query conditions after version expiry without promising permanent version restoration. Store relative date intent separately from manual dates; recalculate the former across days and keep the latter fixed.

Basic pricing failure must not affect token reads. Background Web price updates must retain Rust eligibility, cooldowns, and version publication to avoid duplicate downloads across windows. Host exit stops that host's network work without stopping another entry's shared scanning. Canceling page waiting does not claim to terminate shared jobs. Fixed snapshots remain unchanged; price updates create a new version, applied according to reading state. Failed downloads retain unknown amounts and a retryable state, without inventing zero cost.

If progress interfaces are needed, first establish that job identity, stage, start time, committed version, available results, coverage, and cancellation scope are observable; then generate narrow DTOs from Rust. Page elapsed time differs from core elapsed time. Omit counts/totals without statistical support. Do not introduce general dispatch or an empty job framework merely to match a prototype.

The product is unreleased and implements no old-index migration. Unsupported formats are rejected with original data retained. Storage exhaustion is explicit failure, never a saved-success receipt. Read-only database fallback, general rebuilding and cleanup require independent design before implementation.

### Phase A work breakdown

| Work | Responsibility and dependencies | Completion criteria |
|---|---|---|
| A1 Shell and preferences | UI and shared locale; no new core capability | Shell remains visible with delayed/failed preferences; explicit language and user choices win; no language rollback or draft loss |
| A2 Pending and older results | UI coordinator and existing live freshness; start with state mapping | First pending follows automatically and cancellation stops this page; older results remain readable with accurate update state; scope/version isolation |
| A3 Background prices | Node host lifecycle and existing Rust cooldowns; extend generated responses only if needed | Slow downloads do not block usage; multiple entries do not duplicate requests; exit cleanup; accurate new/old versions and unknown amounts |
| A4 Coverage, preferences, recovery | Explicit Rust errors, independent UI states, date intent | Separate empty/unmetered/partial/configuration states; relative dates cross days, manual dates remain fixed; failed saves are not successes |
| A5 Observability and upgrade acceptance | Extend core states only as needed; fault fixtures and browser measurements | Evidence for continuous jobs, multiple windows, unsupported-format rejection, and full disks; no invented stages or ETA |

## Phase B: deterministic rules and prerequisite evidence

Rule identifiers are candidate names; align them with current rule versions when registering them. Equal files, a shared authorized root, parent/child directories, or equal task names cannot independently prove a shared loading chain. Maintain complete static content facts separately from actual injection facts.

| Branch | Required facts | Unknowns and exclusions | Action and review |
|---|---|---|---|
| `CFG-DUP-01/content` | Complete Markdown paragraphs/lists, original byte ranges, source/version, reliable shared applicability chain and conditions | Verify original text after hash matches; preserve Chinese, case, punctuation, internal whitespace, and line endings; headings, code examples, and quoted examples are not independent blocks; unknown chains permit only static inventory | Show positions and conditions for manual merging/retention; completely reread all related versions before review |
| `CFG-DUP-01/injection` | Same actual request/context and source version, with two explicit inclusion positions | Reads are not injection; deduplicate event replay while retaining a real second position; separate parent/child, new requests, and compaction generations | Check a comparable actual context after changing an entry; remain unavailable without an adapter |
| `CFG-SYNC-01` | Explicit user/host declarations of source/copy/direction and versioned transformations, with both current versions | Do not infer relationships from names/similarity; unknown transformations remain unknown; source is not automatically correct, and plugin copies follow host management | Show the declaration and both sides; let the user choose direction or preserve customization; review using the same declared transformation |
| `FILE-REF-01/hook-target` | Supported host, effectively enabled Hook, known interpreter/script arguments and path base, reliable nonexistence evidence | Dynamic shell/variables, insufficient permissions, unknown host/base, or symlink boundaries are not missing files; never execute Hooks | Locate registration and target for manual path changes or explicit disabling; recheck existence and enabled state |
| Automatic injection inventory | Explicit source, event/context/scope, and actually obtained content | Not itself a defect; do not predict savings from size/counts; expose scope/capability gaps | Show size, reference tokens, and identifiable counts separately; current fragment adapters are missing, so expose no fake data |

Shared applicability chains, the copy-declaration input/format, and the first Hook host/supported command subset are phase B input specifications. The declaration format is delivered. The read-only hooks/list interface in Codex0.160.0 has been verified; the product now integrates authorized project observations for file declarations; the Unix static script command subset is implemented; standalone/inline plugin JSON declarations and native-expanded static paths are bound; remaining dynamic expressions stay unknown, and Windows commands remain pending. Declarations express user intent without proving host loading; Hook recommendations require an adapter first; do not lower the gate to “same project means duplicate.”

Merge size and duplicate branches by object while retaining each branch's evidence, rule version, and conditions. Never add overlapping duplicate ranges repeatedly. Ignore fingerprints include all related file versions, chain/declaration/host evidence, and parser policy; changes on the other side require reevaluation. Review passes only with complete, comparable reads and applicability relationships. Deletion, unreadability, or unknown relationships are not resolution.

Text reduction describes comparable content changes only. Store event counts, related-turn usage, and future execution usage separately; deduplicate stable measurement identities without exclusive object cost allocation or wasted/net-savings totals. This static batch does not invent reliable Skill calls, MCP resources, actual injection, inactivity observations, or Hook execution health.

### Phase B structures and work breakdown

The target is caching by content version and parsing strategy; current configuration collection reparses without persisting bodies or block caches. use original ranges for verification without copying text per occurrence. Group candidates by length and binary hash, then compare original text. Output one group with positions rather than pairwise matches. Sort nested ranges to deduplicate them and expose resourceLimited when complete units are unavailable. Expected parsing/hashing grows with total bytes and block count; interval sorting is O(B log B), with collision verification measured separately. Do not silently drop valid large lines.

Source positions, source instances, file versions, object identities, and context identities have distinct responsibilities. The future incremental-update target replaces only changed files’ block positions; separate derived data from user decisions. Use a mature parser with locked versions/licenses; existing YAML parsing/token estimates do not supply complete Markdown blocks.

| Work | Dependencies and delivery | Acceptance focus |
|---|---|---|
| B0 Evidence inputs | Explicit chains, copy declarations, Hook host/path rules; Rust types and generated shared contracts | No invented relationships for undeclared/unknown hosts; authorization does not spread; version/source isolation |
| B1 Complete blocks and duplication | B0 chains, mature position-aware Markdown parsing, caching, bounded grouping | Chinese/complete lists/conditions/exclusions/forced hash collisions/overlap/huge duplicate groups; identical positions through CLI and HTTP |
| B2 Declared copies | B0 declarations; initially only defined deterministic transformations | Both-side edits, direction, plugin ownership, other-side changes, declaration changes, unknown transformations, insufficient review |
| B3 Hook references | B0 hosts; initially known interpreters and static script arguments | Enabled/disabled, path bases, quoting/spaces, missing/permissions/dynamic expressions/symlinks; no script execution during checks |
| B4 Recommendations and manual review | B1–B3 shared evidence, fingerprints, pagination, existing decisions | Object grouping, bilingual parity, conserved related usage, ignore invalidation, preserved baselines, deletion never falsely passes |

## Acceptance data and phase completion

Run new acceptance in isolated synthetic directories; prototype checks and historical test counts do not count as passing this batch. Record build hashes, platform, data, and current outcomes. Reuse existing fixtures only after confirming applicability. The following are acceptance identifiers for this specification.

| IDs | Data/actions | Key assertions |
|---|---|---|
| B01–B05 | New data directory; active/archive, older history only, no logs, unmetered tasks, cancellation during large history | Readable normal results without duplicate archive billing; empty dates offer all dates; unknown is not zero; pending differs from no records, and first cancellation has no older result |
| B06–B10 | Invalid/denied directory, unknown format, offline missing prices, one failed source among several, unmatched combined filters | Accurate scope/capability/reasons; prices do not block tokens; healthy sources and retained contributions are accurate; clearing filters does not change authorization |
| B11–B16 | Time-zone midnight/unknown dates, multiple models/missing turns, same names across sources/archive, unauthorized/deleted configuration, limits/encoding, reads/failed MCP calls | Layered conservation without guessed identity/dates; current unknowns do not explain history; reads are not calls, and failed attempts remain |
| B17–B19 | Imported old history, no recommendations/all ignored/unavailable checks, deletion/method changes after manual edits | No invented continuous inactivity; three states remain distinct; retain receipts/baselines and never resolve with insufficient evidence |
| B20–B23 | Late responses after scope changes, cancellation in one of multiple windows, restart/expired versions, cross-day preferences/manual dates | Scope/version isolation without canceling others; recover through a new link; relative dates roll/fixed dates remain; preference failure does not block |
| B24–B26 | Unsupported index formats/full storage, two languages at 390px with keyboard, fixed-version CLI/HTTP | Storage failure is not success and retains user state; reachable actions/identities; equal values/counts/recommendations |
| R01–R04 | Exact blocks/chains, declared copies, static/dynamic Hooks, injection replay/real positions/parent-child | Each branch meets required facts; unknowns generate no false recommendations; missing adapters stay unavailable; rule changes and multi-object review are independent |

Phase A covers applicable B01–B26 lifecycle cases; phase B also completes deterministic branches of R01–R04. Synthetic pages or local tests cannot replace installation/other-platform, real-source, million-record, 24-hour residency, or format/resource acceptance. Phase C authentication/isolation/diffs/conflicts/partial application/recovery/native-log measurement deduplication and phase D continuous inactivity/space/desktop require separate acceptance and are not marked complete here.

## Performance and later scope

Measure URL readiness, page shell, first valid usage, and each completed section separately. Record release, corpus, cache, platform, Rust/Node/browser memory, and temporary/settled disk. Existing [large-history](../benchmarks/compact-live-index-2026-10-02.json) results of roughly 4.49 seconds and [configuration](../benchmarks/config-measurement-thresholds-2026-10-02.json) results of roughly 0.37 seconds are CLI measurements from different builds/corpora; do not add them into GUI latency or user ETA. Migration, first paint, and larger scales remain unmeasured.

The current core retains safe facts in proportion to history; compact indexes and cache budgets are not whole-process hard limits. Phase B benchmarks include parsing, scope verification, persistence, and queries, separately reporting huge duplicate groups and collision verification. Encoded-layout samples cannot establish whole-product savings.

Actual injection and Codex execution remain phase C. Viewing/static checks do not require an execution engine; check readiness only before execution. Complete restricted content, isolated generation, diff review, baseline checks, per-item receipts, same-execution-ID continuation, and conflict-aware recovery first. Without runtime evidence, do not install/log in, borrow private desktop interfaces, or enable automatic writes. Phase D delivers continuous observations, protected space operations, and Tauri through host adapters; this batch does not implicitly complete them.

## Current declarations and resource boundaries

Cross-file checks read only an existing `.wombat/analysis.json` in an authorized project, using the [generated schema](../schemas/analysis-declaration-v1.schema.json). The product does not create declarations, infer joint loading from names/directories, or read files outside the inventory. Example:

```json
{"version":1,"chains":[{"id":"joint","files":["AGENTS.md","child/AGENTS.md"]}],"copies":[{"id":"copy","source":"AGENTS.md","copy":"copy/AGENTS.md","transform":"identity-v1"}]}
```

Paths accept only normal relative components inside the authorized root; both endpoints must be complete current inventory items. Chains support Rule only; Skill bodies support same-file checks without YAML. identity-v1 compares full raw bytes including line endings without establishing that the original is correct. Changes to declarations, either endpoint, conditions, or relative-reference bases require reconsideration; unsupported transforms and Hook hosts remain unknown.

Limits are 1MiB/file, 8MiB/round, 32,768 blocks, 4,096 positions/group, 256 branches/object, and 2MiB evidence. Declarations are limited to 64KiB, 256 relations, and 2–64 paths/chain. Limits expose gaps and cannot prove a complete recheck. Heading conditions and raw dictionaries are shared; hash collisions still compare raw bytes. Bodies reside only within the bounded collection round. Rules use static-config-v4; user records remain separate. See the [decision](../decisions/implemented/architecture/2026-10-02-startup-static-rules.en.md).

Current behavior includes first waiting/cancellation, readable older results, asynchronous preferences, relative dates, and host-owned background prices. Sources show startup and extra directories plus macOS/POSIX restart material; copying does not execute it. INDEX_UNSUPPORTED_VERSION, STORAGE_FULL, and STORAGE_UNAVAILABLE fail explicitly without clearing old records or offering automatic rebuild/read-only fallback. Controlled SQLite quota exhaustion, unsupported index formats, and same-service recovery are verified; actual disk exhaustion and every permission failure are not.
