# Decision Note: Codex task timing research and technical design

[中文](2026-10-04-codex-task-timing.md) | English

Status: proposed

Research date: 2026-10-04. This public design defines the scope, architecture, and implementation units for expanding usage queries into objective timing data, for product and implementation readers. All numerical examples are synthetic. Propose a narrow `timing` query within existing task/turn details, without restoring a general diagnostic entry point. Timing queries, timing comparison, and evidence bundles remain unimplemented; all new commands, fields, and phases below are target designs. The [core reference](../../../../core/README.en.md), [CLI guide](../../../guides/cli.en.md), and source code remain authoritative for current behavior.

## Problem

High usage, slow tasks, and large context are different problems. Existing task, turn, and step queries locate usage, but cannot fully show where time went, which intervals overlap, and how much time lacks evidence. The product's core purpose is objective data: separate source-recorded facts, deterministic calculations, and proxy signals. The first phase prioritizes facts and deterministic calculations; proxy metrics may be unavailable, and semantic judgments are not default conclusions. Analysis should describe observed time and evidence gaps, showing possible causes only where supported.

### Current capability audit

Initial research used `895bb2d`. This revision rechecks source against remote `main` at `8ad4ada`; proposal commit `a75a85a` implements no product capability. The capability table below uses the new baseline; the initial probe remains historical evidence only. README prototypes and targets are not delivery evidence.

| Existing capability | Source evidence | Diagnostic gap |
|---|---|---|
| Active/archived Codex JSONL, isolated roots, historical model and reasoning effort | [Codex adapter](../../../../core/src/adapters/codex.rs), [wire](../../../../core/src/adapters/codex/wire.rs) | No diagnostic capability declaration; no production adapter for other agents |
| Response measurements and reconciled cumulative telemetry, retaining `rawInput`, `requestScoped`, and `grain` | [Source contract](../../../../core/src/adapters/contract.rs) | No context window; cumulative deltas are not necessarily individual request inputs |
| Turn `startedAt` / `endedAt` / `status` | Adapter `Facts::turn` | Start is the earliest associated record, not necessarily `task_started`; native duration and first-token fields are ignored |
| Call identity merging, exit codes, some `durationMs`, safe paths, native MCP outcomes | [Operation projection](../../../../core/src/adapters/codex/operations.rs), [merge](../../../../core/src/adapters/codex/operations/merge.rs) | Retains the earliest observation, without both endpoints or independent event phases; command labels remain unimplemented |
| `compacted` operations and measurement-copy deduplication | Adapter `process` | Markers lack start/duration; adjacent record gaps cannot measure compaction |
| SQLite append cursors, transactions, safe facts; snapshot shards/hashes | [Incremental adapter](../../../../core/src/adapters/codex/incremental.rs), [index](../../../../core/src/live_index.rs), [snapshots](../../../../core/src/usage_store.rs) | No lifecycle or context samples; old projections cannot recover discarded fields |
| JSON v3 `refresh/usage/threads/turns/steps`; separate configuration/optimization v1 | [DTO](../../../../core/src/usage_app_dto.rs), [CLI](../../../../cli/src/usage-app-cli.ts), [client](../../../../client/src/client.ts) | No timing action; `steps` exposes neither request identity nor `requestScoped`, preventing reliable reconstruction from public output |
| Shared local Web/CLI queries and existing `usage --watch` | [Architecture](../../../development/architecture.en.md) | Usage watch cannot prove live model execution or activity not yet written to logs |

Current `codex-rollout-5` recognizes `CommandExecution`, `FileChange`, `McpToolCall`, and corresponding older spellings. MCP already parses native outcomes and `duration.secs/nanos`, with explicit replay and identity-conflict handling; reuse this work. Command `duration.secs/nanos`, outer lifecycle endpoints, native turn duration/TTFT, and historical windows are still discarded. `Reasoning`, `AgentMessage`, `UserMessage`, and `ContextCompaction` have no timing-fact projection. Recognizing an operation does not establish a closed interval. New fields still need versioned fixtures; lowercasing every type does not establish equivalent semantics.

The new baseline also adds initial task previews, project discovery, accounts/Codex handoff, and Hook/MCP/Skill observations. Timing queries reuse task identities and safe operations without invoking these host captures or external execution. Current allowance, project configuration, registration, and approximate Skill adoption cannot establish historical timing causes; structured MCP duration is not network duration.

### What current logs can establish

Read-only structural inspection found native turn duration, first-token duration, lifecycle endpoints on completion records, response usage, and historical windows in current local Codex log formats. Extending safe projections is sufficient for the minimum analysis, without installing Hooks, calling models, or collecting server telemetry. This finding covers inspected formats, not all historical logs.

Available analysis includes closed-turn duration, native first-token duration, unions of host-recorded command/reasoning/compaction intervals, request-input distributions, input normalized to the recorded window, recorded failures and changes, and time uncovered by lifecycles. Tool-result-to-next-model-record gaps are only waiting proxies. Test/build categories require bounded command recognition; scope changes and rework causes require user judgment. Server/network time, pure inference time, and model quality are not established.

Public upstream definitions cross-check field shapes: `task_complete` may carry `duration_ms` and `time_to_first_token_ms`; item completion records may carry `started_at_ms` and `completed_at_ms`; windows are nullable. Definitions do not establish persistence in an individual log or historical compatibility. See [Codex protocol](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs) and [TurnItem types](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/items.rs), inspected on 2026-10-04 at a moving branch. Pin source versions during implementation.

## Proposal

Proceed workstream by workstream, keeping one detailed design per scope. This overview retains all 20 tasks, dependencies, and completion gates. Resume the unfinished workstream after an interrupting task completes.

| Workstream | Task ownership |
|---|---|
| [Unified events and persistence](2026-10-04-event-foundation.en.md) | U04–U08 |
| [Timing metrics and use counts](2026-10-04-event-metrics.en.md) | U09–U10 |
| [Rule evaluation over unified evidence](2026-10-04-event-rules.en.md) | U11–U13 |
| [Event query interfaces and shared pages](2026-10-04-event-delivery.en.md) | U14–U17; supplies page-design detail for U03, whose primary task and gates remain in this overview |
| Overview and delivery gates | U01–U03, U18–U20 |

The first usable version answers one selected turn: elapsed time, recorded activity intervals, overlap, time without activity evidence, and per-request input size. Accounts, current configuration, and suggestion handling retain their own business responsibilities.

Implement source facts → current-format storage → pure calculations → generated contracts and restricted transport → matching CLI/Web panels. Every metric carries its value, source or method, status, and evidence references; unavailable values are null. Prioritize native duration, native first token, command/compaction/reasoning lifecycle unions, coverage gaps, and input distributions. Keep waiting proxies separate and sharing explicitly user-selected. Comparison, watch, semantic command labels, and evidence bundles remain later phases.

### 1. Data availability and collection decisions

The complete design is owned by [Unified events and persistence](2026-10-04-event-foundation.en.md); this page retains navigation only.

### 2. Turn and task timing definitions

The complete design is owned by [Timing metrics and use counts](2026-10-04-event-metrics.en.md); this page retains navigation only.

### 3. Overlap and coverage algorithm

The complete design is owned by [Timing metrics and use counts](2026-10-04-event-metrics.en.md); this page retains navigation only.

### 4. What response waiting can explain

The complete design is owned by [Timing metrics and use counts](2026-10-04-event-metrics.en.md); this page retains navigation only.

### 5. Context pressure

The complete design is owned by [Timing metrics and use counts](2026-10-04-event-metrics.en.md); this page retains navigation only.

### 6. Failures, validation, changes, and rework signals

The complete design is owned by [Timing metrics and use counts](2026-10-04-event-metrics.en.md); this page retains navigation only.

### 7. Minimum CLI and JSON contract

The complete design is owned by [Event query interfaces and shared pages](2026-10-04-event-delivery.en.md); this page retains navigation only.

### 8. Historical compare and on-demand watch

The complete design is owned by [Event query interfaces and shared pages](2026-10-04-event-delivery.en.md); this page retains navigation only.

### 9. Privacy and shareable artifacts

The complete design is owned by [Event query interfaces and shared pages](2026-10-04-event-delivery.en.md); this page retains navigation only.

### 10. Implementation impact and versions

The complete design is owned by [Unified events and persistence](2026-10-04-event-foundation.en.md); this page retains navigation only.

### 11. Phased priority and risks

| Phase | Priority scope | Completion gate |
|---|---|---|
| P0a Sources/algorithms | Inspected lifecycle formats, native duration/TTFT, historical window, quantiles, overlap/coverage, old-data gaps | Independent synthetic truth, unknown-version rejection/new-format recollection/privacy checks; technical foundation, not complete product delivery |
| P0b Minimum analysis | Selected-turn CLI JSON/text and matching Web panel, native metrics, waiting-proxy limits, unclassified time, sharing summary | Same-version equivalence, faults/cancellation/narrow-screen/bilingual acceptance; no dependence on command semantics or new telemetry |
| P1 Work signals/comparison | Bounded command labels, change/message markers, task aggregates, strict historical strata | Explainable labels, unknown historical baseline, explicit exclusions/weights/comparability |
| P2 On-demand additions | Single-turn watch, safe evidence bundle, annotations; evaluate host collection/repository checkpoints on explicit demand | Authorization/resources/censoring/expiry/export/cancellation acceptance; separate validation of new host telemetry |

Risks include source evolution, type spelling/duplicate events causing omissions or double counting, write latency/clock errors, parallel/nested pairing, cumulative telemetry mistaken for context, coverage mislabeled complete, metadata leaks, and historical selection bias. Mitigations are versioned capabilities, identities/conflicts, separate native/window duration, tiered proxy methods, reliable request-sample gates, multidimensional coverage, allowlisted sharing, and explicit observational limits. A generic health score must not hide these risks.

### 12. Technical architecture and call chain

The complete design is owned by [Unified events and persistence](2026-10-04-event-foundation.en.md); this page retains navigation only.

### 13. Internal safe facts and identities

The complete design is owned by [Unified events and persistence](2026-10-04-event-foundation.en.md); this page retains navigation only.

### 14. Current format, index, and snapshots

The complete design is owned by [Unified events and persistence](2026-10-04-event-foundation.en.md); this page retains navigation only.

### 15. Restricted interfaces and host integration

The complete design is owned by [Event query interfaces and shared pages](2026-10-04-event-delivery.en.md); this page retains navigation only.

### 16. Web presentation and resource boundaries

The complete design is owned by [Event query interfaces and shared pages](2026-10-04-event-delivery.en.md); this page retains navigation only.

### 17. Implementation units and gates

See “Task batches and acceptance” below for execution order and the 20 tasks. This proposal is the single owner of unfinished requirements and acceptance responsibilities.

| Order | Delivery unit | Dependencies and completion gate |
|---|---|---|
| D0 | User journeys, page and interaction design | After initial metric/event definitions, alongside D1/D2; deliver layouts, a clickable synthetic-data prototype, states/copy, presentation-contract mapping, and five journey walkthroughs from [section 16 of the delivery workstream](2026-10-04-event-delivery.en.md); complete before D4 contract finalization |
| D1 | Unified safe events, existing usage/operation projections, Codex mappings | Synthetic native fields, identity/conflicts, complete/partial-tail lines, body isolation; existing independent usage truth conserved |
| D2 | Transactional events, read watermarks, projections, snapshot references | D1; current-format restart, cached no-scan, independent source failures, unknown-version rejection with preserved files, same-version saving, initial-preview isolation |
| D3 | Pure timing algorithms and Skill/MCP use-count projections | Can begin with synthetic facts; integration requires D1/D2; union/mask conservation, window segmentation, aliases/privacy counterexamples |
| D4 | DTO/service/client Node/HTTP | D0 presentation contract and D2/D3; generated contracts, fixed/live transport, version/scope authorization, errors/cancellation/limits |
| D5 | CLI/Web turn panel, share preview, use counts/evidence | D0/D4; implement prototype journeys, same-version entry-point equivalence, bilingual/narrow-screen/keyboard/return/late-response tests, actual browser acceptance |
| R1 | Independent rule evaluation and evidence requirements | Can run alongside D1/D2; retain existing static algorithms, return assessments per rule, derive suggestions from hits; regress independent existing-rule truth and gap states |
| R2 | Unified rule inputs, finding identity, and rechecks | R1 and D2/D3; reuse usage projections, pin configuration/host observations and cutoff time, distinguish finding identity from assessment revision; rebuilding preserves decisions and missing evidence never proves resolution |
| R3 | Rule CLI/Web contracts and acceptance | R2, coordinated with D4/D5; generate assessment states, evidence references, and recheck contracts; entry-point equivalence and browser acceptance; preserve historical decisions without silently broadening their applicability |
| D6 | Later compare/watch/semantic labels | Independent specifications/evidence gates after P0 acceptance; outside initial delivery |

Passing D1—D4 tests establishes a foundation only. D5 acceptance in both entry points makes the first usable capability. Review this proposed specification before implementation; record only actually closed units and evidence during implementation. This architecture design does not change the support matrix, existing generated contracts, or product code.

R1—R3 form the accompanying rule delivery track. D5 may independently accept timing, but the combined event-and-rule design requires R3 acceptance; rule adaptation cannot be implicitly marked complete. New inactivity, duplicate-injection, and connection-fault capabilities require their own evidence gates and are not automatically delivered by this foundation work.

### 18. Unified session-event facts and multiple projections

The complete design is owned by [Unified events and persistence](2026-10-04-event-foundation.en.md); this page retains navigation only.

### 19. Skill/MCP use and use counts

The complete design is owned by [Timing metrics and use counts](2026-10-04-event-metrics.en.md); this page retains navigation only.

### 20. Rule architecture based on unified evidence

The complete design is owned by [Rule evaluation over unified evidence](2026-10-04-event-rules.en.md); this page retains navigation only.

## Alternatives considered

Deriving a report from existing `turns/steps` minimizes changes but lacks lifecycle endpoints, native TTFT, and windows. Recognized operation types still do not turn one timestamp into an interval. Extend source facts and report unavailable when the source itself lacks fields.

Reading raw logs with CLI-only algorithms accelerates exploration but bypasses Rust safe projection, fixed versions, and consistent entry points. Permit read-only research outside the repository; product algorithms belong in the shared core.

Adding Hooks, host tracing, or online model analysis first could supply more signals but increases permissions, dependencies, and privacy costs when logs already contain minimum metadata. Defer these to demand-driven additions, not P0 prerequisites.

Assigning every interval one cause or priority produces readable percentages but overlapping evidence and unknown time cannot establish exclusive causality. Return exclusive evidence masks, category unions, and unknown time without arbitrary allocation priorities.

## Acceptance criteria

### Synthetic test plan

| Layer | Required independent truth/fault cases |
|---|---|
| Adapter | Current PascalCase/legacy formats, completion with both endpoints, seconds/ms/nanos, negatives/overflow/default zero, native TTFT, changing windows, no body/output/diff persistence, forks/copies/compaction duplicates, unknown types |
| Intervals | `[0,100)` truth above; parallel/nested/touching/zero/out-of-order/duplicate/conflicting/cross-boundary/open intervals; unions bounded by window and mask conservation; proxies do not reduce unknown causality |
| Context | Type 7, empty/single/missing samples, reliable requests versus cumulative intervals, cache subsets, missing/changing windows/model switches/ratio above 1, pre/post-compaction discontinuities |
| Work signals | Nonzero search/expected failure, repeated category not automatically retry, scripts/pipelines/ambiguity remain other, partial changes not full diffs, message markers not scope-change conclusions |
| Storage/faults | Current-format source gaps, unknown old-format rejection, missing-envelope corruption, full recollection into new formats, append/restart/truncation/replacement, valid large/partial-tail lines, independent source failures preserving contributions, cancellation without partial commit, unknown ownership, limits |
| Contracts/entry points | Generated Schema rejects unknown parameters/nonfinite values; same-version CLI/HTTP/Web agreement, identity conflicts/expiry, consistent text/JSON unknowns, bilingual/narrow-screen/cancel/return |
| Sharing/comparison/watch | Secret-shaped sentinels in bodies/output/titles/paths/custom names/errors never leak; aliases/relative time; small/mixed-model/incompatible-method samples cannot produce strong claims; censored running state, terminal final result, exit130 |
| Resources | Release, fixed synthetic corpus, cold/warm, target-turn versus full-source timing/memory/consistency; no whole-scan claims from algorithm-only speed |

Implementation follows the [multi-entry workflow](../../../development/workflow.en.md): build before relevant cross-language/end-to-end tests; Rust accuracy/fault samples plus fmt/clippy; generated contracts and typecheck for boundaries. Behavior changes require browser acceptance; dependency changes require license review. Do not mark support delivered without this evidence.

### Verification in this research and remaining limits

Initial research at 895bb2d included external log-structure inspection and 10 synthetic adapter assertions; 11 interval/quantile cases and 1,000 integer-grid truth comparisons passed. These establish historical source capability and algorithm-design evidence, not unchanged gaps in the latest adapter. Real statistics, paths, identities, messages, and outputs were not copied into public documentation.

This revision rechecks operation projection/merging, MCP duration, turn boundaries, live selection/restoration, initial previews, strict format reading, and Node/HTTP transport at main 8ad4ada. An updated external synthetic adapter probe passed 12 assertions: PascalCase commands and failure states are retained, while command duration objects, lifecycles, windows, and TTFT remain gaps; body sentinels do not enter the projection. The proposal corrects obsolete type gaps, storage compatibility promises, module paths, and preview/version boundaries, and renames the proposed entry to timing. Only bilingual proposal documentation and necessary indexes change; no feature is implemented.

The local build, repository static checks, and public package-manifest checks passed before proposal commit a75a85a was pushed; this is not timing-feature acceptance. This revision's document checks appear in the completion report, without new product runs, complete behavior suites, browser, or performance acceptance. Proposed commands, versions, and budgets enter current support documentation only after implementation and verification.

### Unsupported conclusions

Unknown time does not establish server congestion, slow networks, server queues, or pure model computation. Host reasoning lifecycles are not GPU time. High input ratios do not prove compaction triggers. Cumulative input is not context occupancy. Measurement/tool/content record counts are not API-request counts.

Nonzero exits do not establish code defects. Repeated tests are not necessarily wasted work. Change-event counts are not net diff size. User messages do not automatically establish scope changes or wasted duration. Current configuration does not prove historical loading.

Observational history cannot establish stable model speed multipliers, quality rankings, platform regressions, cost savings, or subscription-allowance causes. Complete reads, high coverage, or little unclassified time do not establish complete causality. The product can explain where recorded time went and what evidence is missing, but cannot assert a unique root cause without evidence.


### Task batches and acceptance

U01/U02 have [independent baseline evidence](../../../benchmarks/2026-10-04-event-upgrade-baseline.json) and frozen contracts. U03 shared-component previews still need production-interface wiring and duplicate removal. U04/U05 have partial safe-event mapping and accounting/operation projections, but external metadata and complete mapping remain open. U06–U20 have not passed acceptance. Historical commits and test output do not replace individual completion gates.

#### Scope and delivery principles

This is a substantial upgrade across core, client, cli, web, and ui, covering event facts, index/snapshot formats, usage projections, rule assessments, and interactions rather than just a timing panel. Initial scope includes safe Codex events, fixed evidence views, existing accounting conservation, Skill/MCP use counts, timing metrics, rule adaptation, and equivalent CLI/Web delivery. Retain the modular monolith without a new service or general rule engine.

Expanded compare/watch, semantic classification, new inactivity/duplicate-injection/connection-fault rules, other Agents, and Tauri are excluded. Accounts and pricing retain their existing responsibilities with version references as needed; unified logging does not require rewriting every domain. Unknown history stays unknown; current configuration cannot fill historical configuration gaps. Raw logs remain read-only, indexes reconstructible, and user decisions/recheck baselines independently protected.

Default to one reviewable change per task. Closely coupled format-switch tasks may form an integration batch with responsibility-based commits. Each integration point must build and preserve existing entry points. Synthetic development comparisons may compare old and new results, but the product must not retain dual ledgers, legacy-format readers, or automatic migration. Update implementation status only when the corresponding evidence is complete.

User steering on 2026-10-04: intermediate batches run only independent tests for added or affected modules. Integration, end-to-end tests, and full regression are deferred to the final batch (U19). Prototype design builds on the existing design and, following later steering, moves into shared repository components with mock-data previews; the public specification has no private-file dependencies. Baseline integration completed before this steering is historical evidence, not authorization to repeat it mid-upgrade.

#### Task list

Determine completion from each task’s gates and actual verification; partial implementation does not establish acceptance. Keep commit and verification evidence in the task and CI. Dependencies describe integration prerequisites; pure algorithms can start with synthetic data once input contracts are defined.

##### Batch one: baseline and design

| ID / design stage | Task and primary ownership | Dependencies | Completion gate |
|---|---|---|---|
| U01 / D1, R1 | Current behavior and independent truth baseline; core tests and evidence | None | Pin source revision and synthetic corpus; enumerate accounting/rule expectations, known failures, and evidence gaps; record storage formats and user-record boundaries |
| U02 / D1, D2, R2 | Event, evidence-view, and identity contracts; core | U01 | Specify event/operation identities, source generations, watermarks, time/gaps, observation revisions, and rule dependencies; reconcile format versions and user-record protection |
| U03 / D0 | Turn and rule page prototypes; design specification and synthetic prototype | U02 | Wide/narrow, bilingual, complete/missing/running scenarios; five journeys, assessment/decision presentation, DOM/source and interaction review, and presentation-field mapping |

##### Batch two: event foundation and persistence

| ID / design stage | Task and primary ownership | Dependencies | Completion gate |
|---|---|---|---|
| U04 / D1 | Codex logs to safe events; core/adapters, session_events | U02 | Current and supported historical shapes, valid large lines/partial tails, source identity, and native fields; body/argument/output isolation |
| U05 / D1 | Derive existing Measurement/Operation from events; core | U04 | Independent truth for Tokens, cache subcategories, fork replay, cumulative reconciliation, and pricing association; parse each source once |
| U06 / D2 | Transactional event index, cursors, and projections; core/live_index | U05 | Append, restart, cancellation, source failure, truncation/replacement, late correction, and cold-rebuild equivalence; no partial-version commits |
| U07 / D2, D4 | Fixed-view selection and snapshots; core/live, usage_store | U06 | Shard references/hashes, same-version queries, expiry, cached no-scan, initial-preview isolation; reject unknown formats while preserving directories |
| U08 / R2 | Configuration measurements and host observations in evidence views; core/config | U06, U02 | Preserve independent source/scope/time; bodies read only in authorized collection analysis; rules consume safe versioned inputs |

##### Batch three: metrics and rules

| ID / design stage | Task and primary ownership | Dependencies | Completion gate |
|---|---|---|---|
| U09 / D3 | Skill/MCP usage projections; core shared statistics | U05, U07 | Three same-turn uses count as three; start/result count once; include failures, exclude catalogs/declarations; disclose unknown ownership/time and duplicate-evidence gaps |
| U10 / D3 | Pure timing, coverage, and context algorithms; core/timing | U02; integrate after U05, U07 | Union/exclusive coverage conservation, native scalar versus observed interval, historical windows and quantile truth, resource limits, sharing allowlist |
| U11 / R1 | Independent rule evaluation; core/optimize | U02 | Reuse static algorithms; every rule directly returns five assessment outcomes; isolate failures and derive suggestions from hits |
| U12 / R2 | Rule inputs and dependency updates; core/config, optimize | U08, U09, U11 | Reuse counts across inventory/rules/follow-up; fixed cutoff; correct invalidation for configuration, windows, and late events; unrelated appends preserve static judgments |
| U13 / R2 | Finding identity, decisions, and rechecks; core/optimize/reviews, store | U12, U07 | Separate finding/assessment identity; missing evidence never proves resolution, upgrades never claim comparability; rebuilding preserves decisions/reasons/baselines without widening scope |

##### Batch four: interfaces and user entry points

| ID / design stage | Task and primary ownership | Dependencies | Completion gate |
|---|---|---|---|
| U14 / D4, R3 | Generated DTOs and restricted transports; core, client, web host | U03, U07, U09, U10; rules additionally need U12, U13 | Version-bound live/fixed-snapshot, assessment/evidence interfaces; consistent authorization, cancellation, errors, and budgets; timing never implicitly collects configuration or fetches prices |
| U15 / D5, R3 | CLI text and JSON; cli, client/locale | Corresponding U14 interfaces | Non-TTY queries, states/evidence pagination, exit/cancellation, bilingual equivalence; missing values never zero |
| U16 / D5 | Integrated turn detail; ui | U03, U14 timing/usage interfaces | Reuse summary; timeline/list fallback, Skill/MCP, evidence and sharing; browser acceptance for group refresh, focus/return, and late responses |
| U17 / R3 | Rule assessment and recheck pages; ui | U03, U14 rule interfaces | Separate facts/decisions; evidence gaps, version changes, keep/redisplay/recheck journeys in both languages and narrow layouts |

##### Batch five: module verification closure

| ID / design stage | Task and primary ownership | Dependencies | Completion gate |
|---|---|---|---|
| U18 / D5, R3 | Changed-module verification closure | U15, U16, U17 | Collect targeted independent module evidence and fix gaps; use synthetic or mocked inputs for UI/CLI tests; no integration or end-to-end tests in intermediate batches |

##### Batch six: final integration and delivery

| ID / design stage | Task and primary ownership | Dependencies | Completion gate |
|---|---|---|---|
| U19 / D2, D5, R3 | Final integration, failures, and resource acceptance; all modules | U18 | Build then run integration/end-to-end and full regression; same-version CLI/HTTP/Web, user records, privacy, browser/platform checks; release fixed-corpus cold/append/rebuild time, space/WAL and peak memory, with result equivalence |
| U20 / Overall delivery | Current documentation and upgrade evidence; docs and release preparation | U18, U19 | Align module documentation, contracts, operation instructions, and format rejection/recollection with code; update delivered decision status while retaining unfinished scope; bind artifacts/install evidence to platforms, without automatic publication or global installation |

#### Execution order and milestones

Start U01 → U02, then U03 prototypes and U04 event adaptation. U10 and U11 can proceed independently on stable contracts and synthetic data; U06/U07 are critical fixed-view dependencies. U14 timing/usage interfaces can be accepted first, with rule interfaces waiting for U12/U13. Coordinate edits to shared contract files; parallelizable tasks do not imply unconstrained concurrent editing. These dependencies do not mean parallel agents or work branches have been started.

| Milestone | Required work | User value |
|---|---|---|
| M0 Executable design | U01—U03 | Contracts have truth fixtures, pages can be walked through, storage/history protection is explicit |
| M1 Reliable data foundation | U04—U08 | Changing logs are collected correctly, existing usage is conserved, fixed views can be rebuilt |
| M2 Correct metrics and rules | U09—U13 | Counts, timing, and rules have evidence while decision/recheck boundaries remain intact |
| M3 Modules ready | U14—U18 | Entry-point implementation and independent module tests complete; integrated acceptance pending |
| M4 Upgrade delivered | U19—U20 | Resource costs are verifiable and documentation/acceptance boundaries are complete |

Early prototype or static-rule refactoring completion cannot bypass event-storage and accounting-consistency gates. U18 consolidates independent module evidence; U19 fills integration gaps only in the final batch. Do not mechanically rerun checks unaffected by later changes.

#### Risks and completion records

Prioritize three risks: duplicate/missing accounting contributions after source replacement; incorrectly associating historical usage with current configuration; and storage/identity changes affecting user decisions. U02 must define verifiable protection before switching formats. Deliver source limitations as gaps rather than adding unauthorized collection to fill them.

On closure, record scope, commit/PR, actual verification commands/results, corpus/build revisions, and remaining boundaries. Synthetic material can be public; real-log self-test output stays outside the repository. Documentation runs repo:check and diff checks; Rust and cross-language changes follow applicable repository gates; dependency changes add license review. Verify platforms, browsers, performance, and installation separately, never assuming untested items pass. Estimate overall effort after U01/U02 clarify field and storage impacts rather than promising a schedule upfront.


#### Frozen input contracts

- Event keys combine source identity, file generation, complete-record byte offset, and typed-fact ordinal within that record. Appends retain the generation; truncation or a changed consumed prefix starts a new generation and replaces that source contribution. Paths and session identities are distinct.
- Operation keys prefer source, reliable session/turn, and native call identity; starts, results, and streaming updates share the key. Without native identity, retain event-level candidates; do not merge by name, nearby time, or equal output. Existing accounting deduplication handles proven fork inheritance; independent calls stay separate.
- Each commit fixes source generations, complete-line end offsets, and parser/projection versions. Incomplete trailing lines do not advance watermarks. Events, cursors, and projections commit together; cancellation or failure cannot publish half a version. Per-file watermarks do not prove a simultaneous directory-wide observation.
- Occurrence time, observation time, native duration, and precision remain separate; missing values stay unknown. Rule inputs bind configuration content version, event projection version, host observation scope/time, method version, parameters, and evaluation cutoff; invalidate only related dependencies.
- The next format uses rollout-6, live-v2/DB4, usage-v4/schema4, and protocol2 from design section 14. Preserve old index directories and explicit old snapshots and reject mixed reads. Preserve user-v1/reviews.sqlite3 independently; rebuilding neither opens its write transaction nor clears decisions, reasons, or baselines. Post-switch preservation checks belong to final integration.

#### Remaining implementation boundaries

U03 follows U14/U16/U17 to wire production interfaces and migrate every page and state, then remove the corresponding standalone prototypes after verification. U04/U05 still require complete source mapping. Replay fixtures cover log-derived thread/turn, accounting, and operation facts; external metadata such as titles must not be assumed to be covered by events. U06/U08 must fully accept middle-of-file rewrite detection in large logs, index recovery and source replacement, per-source watermarks, event shards, and query resource budgets; first/last boundary probes or whole-event-file reads do not satisfy acceptance. The live protocol still needs to move from protocol1 to protocol2. User-decision preservation, full-path checks, and performance acceptance remain in the final stage.
