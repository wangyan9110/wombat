# Decision Note: Codex task timing research and technical design

[中文](2026-10-04-codex-task-timing.md) | English

Status: implemented

Research date: 2026-10-04. This decision adopts unified safe events, fixed evidence views, and shared analysis for Codex turn timing, Tokens, Skill/MCP use, and rule queries. Public examples are synthetic. The [core reference](../../../reference/core.en.md), [CLI guide](../../../guides/cli.en.md), and source own current entries and limits. Historical baselines below explain the choice, not current gaps.

## Problem

High usage, slow tasks, and large context are different problems. Existing task, turn, and step queries locate usage, but cannot fully show where time went, which intervals overlap, and how much time lacks evidence. The product's core purpose is objective data: separate source-recorded facts, deterministic calculations, and proxy signals. The first phase prioritizes facts and deterministic calculations; proxy metrics may be unavailable, and semantic judgments are not default conclusions. Analysis should describe observed time and evidence gaps, showing possible causes only where supported.

### Historical capability baseline from initial research

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

## Decision

Each workstream retains its decision responsibility; module references own current fields and behavior.

| Decision responsibility | Owner |
|---|---|
| Observations, association, partial statistics, and explanations | [Analysis architecture revision](2026-10-05-analysis-first-events.en.md) |
| Unified events, transactions, and persistence | [Event foundation](2026-10-04-event-foundation.en.md) |
| Timing metrics and use counts | [Metrics](2026-10-04-event-metrics.en.md) |
| Assessments, user decisions, and rechecks | [Rules](2026-10-04-event-rules.en.md) |
| Query interfaces and shared pages | [Delivery](2026-10-04-event-delivery.en.md) |

The first usable version answers one selected turn: elapsed time, recorded activity intervals, overlap, time without activity evidence, and per-request input size. Accounts, current configuration, and suggestion handling retain their own business responsibilities.

Implement source facts → current-format storage → pure calculations → generated contracts and restricted transport → matching CLI/Web panels. Every metric carries its value, source or method, status, and evidence references; unavailable values are null. Prioritize native duration, native first token, command/compaction/reasoning lifecycle unions, coverage gaps, and input distributions. Keep waiting proxies separate and sharing explicitly user-selected. Comparison, continuous turn observation, command semantic labels, and broader evidence bundles are outside this delivery; safe sharing summaries are delivered.

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

### 17. Delivery responsibilities

Foundation, analysis, rules, and interfaces together form this delivery. New inactivity, duplicate-injection, and connection-fault capabilities require their own source evidence; unified events do not provide them automatically.

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

## Consequences and verification

### Verification properties

These properties apply to delivered source mappings. Comparison, watch, and stronger read metadata below remain conditional future verification, not accepted features; the delivery-scope section defines the actual boundary.

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

### Historical research evidence

The next three paragraphs describe the proposal-stage baseline and checks, not the delivered implementation.

Initial research at 895bb2d included external log-structure inspection and 10 synthetic adapter assertions; 11 interval/quantile cases and 1,000 integer-grid truth comparisons passed. These establish historical source capability and algorithm-design evidence, not unchanged gaps in the latest adapter. Real statistics, paths, identities, messages, and outputs were not copied into public documentation.

This revision rechecks operation projection/merging, MCP duration, turn boundaries, live selection/restoration, initial previews, strict format reading, and Node/HTTP transport at main 8ad4ada. An updated external synthetic adapter probe passed 12 assertions: PascalCase commands and failure states are retained, while command duration objects, lifecycles, windows, and TTFT remain gaps; body sentinels do not enter the projection. The proposal corrects obsolete type gaps, storage compatibility promises, module paths, and preview/version boundaries, and renames the proposed entry to timing. Only bilingual proposal documentation and necessary indexes change; no feature is implemented.

The local build, repository static checks, and public package-manifest checks passed before proposal commit a75a85a was pushed; this is not timing-feature acceptance. This revision's document checks appear in the completion report, without new product runs, complete behavior suites, browser, or performance acceptance. Proposed commands, versions, and budgets enter current support documentation only after implementation and verification.

### Unsupported conclusions

Unknown time does not establish server congestion, slow networks, server queues, or pure model computation. Host reasoning lifecycles are not GPU time. High input ratios do not prove compaction triggers. Cumulative input is not context occupancy. Measurement/tool/content record counts are not API-request counts.

Nonzero exits do not establish code defects. Repeated tests are not necessarily wasted work. Change-event counts are not net diff size. User messages do not automatically establish scope changes or wasted duration. Current configuration does not prove historical loading.

Observational history cannot establish stable model speed multipliers, quality rankings, platform regressions, cost savings, or subscription-allowance causes. Complete reads, high coverage, or little unclassified time do not establish complete causality. The product can explain where recorded time went and what evidence is missing, but cannot assert a unique root cause without evidence.


### Delivery scope and actual limits

The U01–U20 implementation, shared-analysis revision, independent verification, final cross-entry acceptance, and documentation closure are delivered. Rules and timing share analysis semantics. Production pages and repository mock-data previews share components; the standalone prototype is removed. Task output and verification-tool reports retain run evidence, without a progress ledger in this record.

Keep the modular monolith, read-only source logs, rebuildable derived indexes, and independent user decisions and review baselines. Initial scope includes safe Codex events, fixed views, accounting conservation, Skill/MCP use counts, timing metrics, existing-rule adaptation, and CLI/Web delivery. Persistent MVCC, project-level progressive initialization, the broader optimization lifecycle, compare/watch expansion, semantic classification, new inactivity/duplicate-injection/connection-fault rules, other Agents, and Tauri are outside this scope.

Without reliable historical content versions, actually delivered read ranges, server queues, or network times, retain observations and concrete explanations. Useful statistical advice does not require invented precision. Without native Skill-load records, count only confirmed actual Skill reads. Stronger conclusions about exact ranges and identical content remain conditional capabilities, not reconstructed facts. Accounts, configuration, and pricing retain their own evidence responsibilities.

#### Verification and resource costs

Final acceptance includes real-core CLI/local HTTP flows, incremental/cold-rebuild equivalence, fixed views and sharing, user-decision protection, and Chinese/English, 390/1440-width production/preview keyboard, return, refresh, and rule-recheck journeys. DOM, interaction, and overflow checks do not establish pixel-level visual or all assistive-technology acceptance. See [verify:e2e and the development workflow](../../../development/workflow.en.md) for repeatable entries. The installation candidate was verified only on macOS Apple Silicon with isolated installation and its bundled runtime. Other platforms are not accepted by this result, and nothing was published.

The fixed resource corpus contains 500 tasks, 100,000 measurements, and 100,000 operations. Business results agree after 12 appends, explicit saving, and cold rebuilding. Cold collection took about 24 seconds, explicit saving about 25 seconds, peak memory about 1.50 GiB, and the fixed snapshot about 1.05 GB in logical size, against about 44.4 MB of initial source logs. Unified events do not guarantee smaller storage. Full-source facts remain resident and appends safely rebuild relevant views. Target-turn budgets do not establish a full-source memory ceiling. These results apply only to this corpus and platform, without million-event or all-environment performance guarantees. Reproduce with `corepack pnpm benchmark:live -- --output <path outside the repository>`, measuring sources, indexes, snapshots, and temporary database files separately. Parsing speed alone does not establish collection performance.

#### Frozen input contracts

- Event keys combine source identity, file generation, complete-record byte offset, and typed-fact ordinal within that record. Appends retain the generation; truncation or a changed consumed prefix starts a new generation and replaces that source contribution. Paths and session identities are distinct.
- Operation keys prefer source, reliable session/turn, and native call identity; starts, results, and streaming updates share the key. Without native identity, retain event-level candidates; do not merge by name, nearby time, or equal output. Existing accounting deduplication handles proven fork inheritance; independent calls stay separate.
- Each commit fixes source generations, complete-line end offsets, and parser/projection versions. Incomplete trailing lines do not advance watermarks. Events, cursors, and projections commit together; cancellation or failure cannot publish half a version. Per-file watermarks do not prove a simultaneous directory-wide observation.
- Occurrence time, observation time, native duration, and precision remain separate; missing values stay unknown. Rule inputs bind configuration content version, event projection version, host observation scope/time, method version, parameters, and evaluation cutoff; invalidate only related dependencies.
- The [core reference](../../../reference/core.en.md) and source contracts own current independent versions. Preserve old index directories and explicit old snapshots while rejecting mixed reads. User decisions, reasons, and review baselines are separate; rebuilding does not clear them.
