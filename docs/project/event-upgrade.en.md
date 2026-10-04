# Unified event, timing, and rule upgrade tasks

[中文](event-upgrade.md) | English

Updated 2026-10-04. Status: batch-one baseline and contracts complete; U03 reopened for consolidation into shared product components. The [design proposal](../decisions/proposed/architecture/2026-10-04-codex-task-timing.en.md) owns architecture and semantics. This page tracks tasks, dependencies, and completion gates without redefining algorithms. Existing gaps remain in [implementation status](status.en.md); this upgrade does not replace previous product acceptance.

## Scope and delivery principles

This is a substantial upgrade across core, client, cli, web, and ui, covering event facts, index/snapshot formats, usage projections, rule assessments, and interactions rather than just a timing panel. Initial scope includes safe Codex events, fixed evidence views, existing accounting conservation, Skill/MCP use counts, timing metrics, rule adaptation, and equivalent CLI/Web delivery. Retain the modular monolith without a new service or general rule engine.

Expanded compare/watch, semantic classification, new inactivity/duplicate-injection/connection-fault rules, other Agents, and Tauri are excluded. Accounts and pricing retain their existing responsibilities with version references as needed; unified logging does not require rewriting every domain. Unknown history stays unknown; current configuration cannot fill historical configuration gaps. Raw logs remain read-only, indexes reconstructible, and user decisions/recheck baselines independently protected.

Default to one reviewable change per task. Closely coupled format-switch tasks may form an integration batch with responsibility-based commits. Each integration point must build and preserve existing entry points. Synthetic development comparisons may compare old and new results, but the product must not retain dual ledgers, legacy-format readers, or automatic migration. Update implementation status only when the corresponding evidence is complete.

User steering on 2026-10-04: intermediate batches run only independent tests for added or affected modules. Integration, end-to-end tests, and full regression are deferred to the final batch (U19). Prototype design builds on the existing internal design and stays in the internal workspace; the public specification has no private-file dependencies. Baseline integration completed before this steering is historical evidence, not authorization to repeat it mid-upgrade.

## Task list

U01–U02 are complete; U03 is consolidating prototypes; U04–U20 await implementation. Assign owners and add commit/PR and verification evidence during execution; this planning change creates no remote issues or additional chats. Dependencies describe integration prerequisites; pure algorithms can start with synthetic data once input contracts are defined.

### Batch one: baseline and design

| ID / design stage | Task and primary ownership | Dependencies | Completion gate |
|---|---|---|---|
| U01 / D1, R1 | Current behavior and independent truth baseline; core tests and evidence | None | Pin source revision and synthetic corpus; enumerate accounting/rule expectations, known failures, and evidence gaps; record storage formats and user-record boundaries |
| U02 / D1, D2, R2 | Event, evidence-view, and identity contracts; core | U01 | Specify event/operation identities, source generations, watermarks, time/gaps, observation revisions, and rule dependencies; reconcile format versions and user-record protection |
| U03 / D0 | Turn and rule page prototypes; design specification and synthetic prototype | U02 | Wide/narrow, bilingual, complete/missing/running scenarios; five journeys, assessment/decision presentation, screenshot critique, and presentation-field mapping |

### Batch two: event foundation and persistence

| ID / design stage | Task and primary ownership | Dependencies | Completion gate |
|---|---|---|---|
| U04 / D1 | Codex logs to safe events; core/adapters, session_events | U02 | Current and supported historical shapes, valid large lines/partial tails, source identity, and native fields; body/argument/output isolation |
| U05 / D1 | Derive existing Measurement/Operation from events; core | U04 | Independent truth for Tokens, cache subcategories, fork replay, cumulative reconciliation, and pricing association; parse each source once |
| U06 / D2 | Transactional event index, cursors, and projections; core/live_index | U05 | Append, restart, cancellation, source failure, truncation/replacement, late correction, and cold-rebuild equivalence; no partial-version commits |
| U07 / D2, D4 | Fixed-view selection and snapshots; core/live, usage_store | U06 | Shard references/hashes, same-version queries, expiry, cached no-scan, initial-preview isolation; reject unknown formats while preserving directories |
| U08 / R2 | Configuration measurements and host observations in evidence views; core/config | U06, U02 | Preserve independent source/scope/time; bodies read only in authorized collection analysis; rules consume safe versioned inputs |

### Batch three: metrics and rules

| ID / design stage | Task and primary ownership | Dependencies | Completion gate |
|---|---|---|---|
| U09 / D3 | Skill/MCP usage projections; core shared statistics | U05, U07 | Three same-turn uses count as three; start/result count once; include failures, exclude catalogs/declarations; disclose unknown ownership/time and duplicate-evidence gaps |
| U10 / D3 | Pure timing, coverage, and context algorithms; core/timing | U02; integrate after U05, U07 | Union/exclusive coverage conservation, native scalar versus observed interval, historical windows and quantile truth, resource limits, sharing allowlist |
| U11 / R1 | Independent rule evaluation; core/optimize | U02 | Reuse static algorithms; every rule directly returns five assessment outcomes; isolate failures and derive suggestions from hits |
| U12 / R2 | Rule inputs and dependency updates; core/config, optimize | U08, U09, U11 | Reuse counts across inventory/rules/follow-up; fixed cutoff; correct invalidation for configuration, windows, and late events; unrelated appends preserve static judgments |
| U13 / R2 | Finding identity, decisions, and rechecks; core/optimize/reviews, store | U12, U07 | Separate finding/assessment identity; missing evidence never proves resolution, upgrades never claim comparability; rebuilding preserves decisions/reasons/baselines without widening scope |

### Batch four: interfaces and user entry points

| ID / design stage | Task and primary ownership | Dependencies | Completion gate |
|---|---|---|---|
| U14 / D4, R3 | Generated DTOs and restricted transports; core, client, web host | U03, U07, U09, U10; rules additionally need U12, U13 | Version-bound live/fixed-snapshot, assessment/evidence interfaces; consistent authorization, cancellation, errors, and budgets; timing never implicitly collects configuration or fetches prices |
| U15 / D5, R3 | CLI text and JSON; cli, client/locale | Corresponding U14 interfaces | Non-TTY queries, states/evidence pagination, exit/cancellation, bilingual equivalence; missing values never zero |
| U16 / D5 | Integrated turn detail; ui | U03, U14 timing/usage interfaces | Reuse summary; timeline/list fallback, Skill/MCP, evidence and sharing; browser acceptance for group refresh, focus/return, and late responses |
| U17 / R3 | Rule assessment and recheck pages; ui | U03, U14 rule interfaces | Separate facts/decisions; evidence gaps, version changes, keep/redisplay/recheck journeys in both languages and narrow layouts |

### Batch five: module verification closure

| ID / design stage | Task and primary ownership | Dependencies | Completion gate |
|---|---|---|---|
| U18 / D5, R3 | Changed-module verification closure | U15, U16, U17 | Collect targeted independent module evidence and fix gaps; use synthetic or mocked inputs for UI/CLI tests; no integration or end-to-end tests in intermediate batches |

### Batch six: final integration and delivery

| ID / design stage | Task and primary ownership | Dependencies | Completion gate |
|---|---|---|---|
| U19 / D2, D5, R3 | Final integration, failures, and resource acceptance; all modules | U18 | Build then run integration/end-to-end and full regression; same-version CLI/HTTP/Web, user records, privacy, browser/platform checks; release fixed-corpus cold/append/rebuild time, space/WAL and peak memory, with result equivalence |
| U20 / Overall delivery | Current documentation and upgrade evidence; docs and release preparation | U18, U19 | Align support matrix, contracts, operation instructions, format rejection/recollection, and progress with code; update delivered decision status while retaining unfinished scope; bind artifacts/install evidence to platforms, without automatic publication or global installation |

## Execution order and milestones

Start U01 → U02, then U03 prototypes and U04 event adaptation. U10 and U11 can proceed independently on stable contracts and synthetic data; U06/U07 are critical fixed-view dependencies. U14 timing/usage interfaces can be accepted first, with rule interfaces waiting for U12/U13. Coordinate edits to shared contract files; parallelizable tasks do not imply unconstrained concurrent editing. These dependencies do not mean parallel agents or work branches have been started.

| Milestone | Required work | User value |
|---|---|---|
| M0 Executable design | U01—U03 | Contracts have truth fixtures, pages can be walked through, storage/history protection is explicit |
| M1 Reliable data foundation | U04—U08 | Changing logs are collected correctly, existing usage is conserved, fixed views can be rebuilt |
| M2 Correct metrics and rules | U09—U13 | Counts, timing, and rules have evidence while decision/recheck boundaries remain intact |
| M3 Modules ready | U14—U18 | Entry-point implementation and independent module tests complete; integrated acceptance pending |
| M4 Upgrade delivered | U19—U20 | Resource costs are verifiable and documentation/acceptance boundaries are complete |

Early prototype or static-rule refactoring completion cannot bypass event-storage and accounting-consistency gates. U18 consolidates independent module evidence; U19 fills integration gaps only in the final batch. Do not mechanically rerun checks unaffected by later changes.

## Risks and completion records

Prioritize three risks: duplicate/missing accounting contributions after source replacement; incorrectly associating historical usage with current configuration; and storage/identity changes affecting user decisions. U02 must define verifiable protection before switching formats. Deliver source limitations as gaps rather than adding unauthorized collection to fill them.

On closure, record scope, commit/PR, actual verification commands/results, corpus/build revisions, and remaining boundaries. Synthetic material can be public; real-log self-test output stays outside the repository. Documentation runs repo:check and diff checks; Rust and cross-language changes follow applicable repository gates; dependency changes add license review. Verify platforms, browsers, performance, and installation separately, never assuming untested items pass. Estimate overall effort after U01/U02 clarify field and storage impacts rather than promising a schedule upfront.

## Batch-one record and frozen contracts · 2026-10-04

The design and task list were committed and pushed in 411bd53. [Baseline evidence](../benchmarks/2026-10-04-event-upgrade-baseline.json) records the fixed source, synthetic fixture fingerprints, accounting truth, and actual checks. Build, 183 Rust tests, module tests, integration, and end-to-end tests passed. The initial sandbox denied a temporary socket; authorized local execution passed. Integration preceded the user steering; subsequent batches use only independent incremental-module tests until U19.

U02 freezes these implementation constraints for the next batch; storage has not yet been upgraded:

- Event keys combine source identity, file generation, complete-record byte offset, and typed-fact ordinal within that record. Appends retain the generation; truncation or a changed consumed prefix starts a new generation and replaces that source contribution. Paths and session identities are distinct.
- Operation keys prefer source, reliable session/turn, and native call identity; starts, results, and streaming updates share the key. Without native identity, retain event-level candidates; do not merge by name, nearby time, or equal output. Existing accounting deduplication handles proven fork inheritance; independent calls stay separate.
- Each commit fixes source generations, complete-line end offsets, and parser/projection versions. Incomplete trailing lines do not advance watermarks. Events, cursors, and projections commit together; cancellation or failure cannot publish half a version. Per-file watermarks do not prove a simultaneous directory-wide observation.
- Occurrence time, observation time, native duration, and precision remain separate; missing values stay unknown. Rule inputs bind configuration content version, event projection version, host observation scope/time, method version, parameters, and evaluation cutoff; invalidate only related dependencies.
- The next format uses rollout-6, live-v2/DB4, usage-v4/schema4, and protocol2 from design section 14. Preserve old index directories and explicit old snapshots and reject mixed reads. Preserve user-v1/reviews.sqlite3 independently; rebuilding neither opens its write transaction nor clears decisions, reasons, or baselines. Post-switch preservation checks belong to final integration.

U03 extends the existing internal prototype while retaining navigation, task summaries, projects, and account structure. Execution, operation evidence, use counts, sharing, and five assessment outcomes are embedded in existing pages. Twenty added-module checks passed across two languages, wide/narrow screens, and four scenarios; screenshot review and field mapping are complete. The prototype uses synthetic data, is not a public-build dependency, and does not constitute product-interface acceptance. U01–U03 are closed; product features, performance, platforms, and final integration remain unfinished.

## Prototype consolidation steering · 2026-10-04

The user now requires one code implementation for all current prototype pages and states, hosted in the repository and shared with product components. The prototype-parity skill was removed as requested. The earlier private prototype is historical design evidence, not a second maintained implementation. U03 is reopened until all current page/state differences have been transferred and the corresponding standalone prototypes removed.

The development-only ui/preview.html entry now injects a synthetic UsageClient into the existing App, with complete, empty, error, loading, and running scenarios. It never imports the HTTP client. This is the preview foundation, not completed migration: configuration details, rule scenarios, account/startup scenarios, and the event-upgrade interactions still need transfer and independent checks before removing their old copies. Intermediate verification remains module-only; final integration stays in U19.

The preview foundation now includes populated configuration, five rule outcomes, keep/recheck/redisplay, and a synthetic account. Four independent fixture tests pass, including validation through the public typed client. Client/UI module builds, repository checks and DOM checks for tasks/instructions/extensions/optimization passed; no screenshots or product integration tests were run. Production assets exclude the preview entry and fixtures. This is a reviewable incremental commit; U03 remains open for the remaining design/state migration and old-copy removal.

The execution presentation has now moved into a repository React component with a synthetic preview adapter. Seven independent module tests and 28 DOM/interaction cases passed across two languages, two widths and seven scenarios, including refresh/share consistency and evidence focus return. No screenshots or product integration tests were run. Official timing interfaces, in-turn product wiring, remaining design states and duplicate-prototype cleanup are still pending; U03 is not closed.
