# Decision Note: Timing metrics and use counts

[中文](2026-10-04-event-metrics.md) | English

Status: proposed

## Problem

This record owns all design responsibilities from section 2, section 3, section 4, section 5, section 6, section 19 of the [upgrade overview](2026-10-04-codex-task-timing.en.md), as their single detailed design owner. The overview retains research evidence, cross-module constraints, task dependencies, and final acceptance; its entry points define neighboring workstreams. Splitting the documents does not indicate implementation completion.

## Proposal

The [statistical analysis architecture revision](2026-10-05-analysis-first-events.en.md) updates observation semantics, partial results, fallback calculations, and suggestion requirements. It takes precedence over older whole-result unavailability constraints below. Privacy, use-count semantics, identity protection, and final acceptance remain applicable.

### 2. Turn and task timing definitions

The first phase requires Wombat task and turn IDs within the source scope; no title, path-substring, or date inference. Running turns may return provisional results with closed values unknown. Cancellation, failure, and completion remain distinct. Events without explicit ownership count as unassigned.

| Metric | Definition and preferred evidence | Missing/conflicting evidence |
|---|---|---|
| `wallClockMs` | Explicit native duration; otherwise explicit start/end difference marked `derived` | Null without boundaries; retain both methods and discrepancy when available |
| `observedWindowMs` | Length of a locatable window between explicit anchors | Prefer valid event millisecond anchors, otherwise envelope time, with seconds as a degraded fallback; never invent absolute anchors from duration |
| `nativeTtftMs` | Source `time_to_first_token_ms` | May include compaction/preparation; not queue time or guaranteed visible-reply latency |
| `firstContentRecordDelayMs` | Explicit start to first nonempty visible Agent content record | Requires corresponding time evidence; persisted content may lag first token |
| `commandLifecycleUnionMs` | Union of valid host command lifecycles clipped to the window | Not CPU time; unfinished async processes are censored, excluded from closed metrics |
| `compactionUnionMs` | Union of closed compaction lifecycles in the window | Markers alone support counts but no duration; missing is not zero |
| `reasoningLifecycleUnionMs` | Union of host `Reasoning` lifecycles | Not pure server inference; may overlap other intervals |
| `responseGapUnionMs` | Union of observed gaps under the rules below | A separate proxy, not model computation time |
| `unclassifiedMs` | Locatable window minus union of valid closed host lifecycles | Waiting proxies do not eliminate unknown attribution; null without a window |

Native duration and locatable windows can differ because of clocks, precision, and write timing. Conservation uses `observedWindowMs`; display native `wallClockMs` separately. Conflicting anchors must not rescale all intervals to fill a native-duration pie chart. Retain `boundaryDeltaMs`, precision, and anomalies; do not subtract across clock domains.

A later task-level query returns first-to-last turn span, complete turn-window union, open-turn counts, and inter-turn gaps. User inactivity is not model waiting. Overlapping turns and child/parallel-agent intervals need separate unions, not per-turn sums. The first phase does not replace turn analysis with task-creation-to-last-usage span.

### 3. Overlap and coverage algorithm

Use half-open intervals `[start,end)` and integer milliseconds. Isolate/deduplicate by source, task, turn, and lifecycle/item identity, merging copies only through explicit identity. Conflicting boundaries retain issues and are excluded from valid coverage. Adjacent times do not establish identical events. An out-of-order completion may carry both endpoints; file order helps establish record order, not missing timestamps.

Validate and connect facts; clip closed intervals to the explicit window; record clipping/cross-boundary anomalies; sort endpoints and sweep using per-category active counts to form a bitset. Accumulate adjacent endpoint differences into each mask. Process equal-time endpoints together; zero-length intervals contribute no time. Complexity is `O(n log n)` time and `O(n)` space. Read the target turn's shard first and bound interval counts. Limits produce partial analysis, not a successful complete result.

Return category unions, summed individual durations, cross-category intersections, and exclusive mask durations. Category unions overlap and must not sum to total duration. Within-category sums describe work volume, not wall-clock time. `sum(maskMs) = observedWindowMs`; the empty mask is unclassified time. Failed commands are a command subset, first response is a prefix, and test/build are command labels, not extra total buckets. Compute waiting-proxy intersections separately.

Synthetic truth: window `[0,100)`, waiting proxy `[0,40)`, compaction `[0,30)`, commands `[30,60)` and `[50,80)`, reasoning `[20,50)`. Compaction union is 30; commands sum to 60 with union 50; reasoning union is 30. Lifecycle coverage union is 80, unclassified time 20. Exclusive masks are compaction 20, compaction+reasoning 10, command+reasoning 20, command 30, unknown 20. Waiting-proxy union is 40, overlapping compaction by 30. The remaining 10 is still not server queue time. With no lifecycles and only proxy `[0,40)`, lifecycle coverage is 0 and unclassified time remains 100.

Publish multiple coverage dimensions: source reading/tails/limits, window-boundary availability, complete versus candidate intervals per category, successful/conflicting/unassigned links, reliable request-input samples versus measurement candidates, window matches, and lifecycle time coverage. `coveredMs / observedWindowMs` measures time coverage, not log completeness or causal explanation. A zero-duration denominator yields null, not an invented 100%. Missing events mean not observed; zero counts describe the observed scope only when the source declares support and candidates are complete.

### 4. What response waiting can explain

Persistent logs lack a stable per-request initiation/first-byte chain. The first phase defines a `response_gap_v1` proxy with weaker evidence than native lifecycles. Start at user input availability or a top-level tool result in the current turn; end at the next identifiable model-content/tool-call record. Inspect type/role/phase and nonempty presence only, without storing bodies. Usage, `token_count`, and host-status events are not model content.

For an explicitly known parallel tool batch, all known results must be available; start at the last result. If batch identity, top-level relationships, async completion, or response-cycle membership is unknown, do not create a definite response cycle; retain candidate gaps and association issues. New user messages, cancellation, turn boundaries, model changes, and source discontinuities terminate candidates. Never match across a discontinuity. Multiple reasoning/message records within one response do not imply multiple requests.

Legacy logs without batch identity may provide an explicitly marked exploratory “result-record-to-next-content-record gap” view. Do not mix it with strictly associated batch samples. Record counts are not API-request counts. Counts, mean/median/P90, unions, and compaction intersections include method version and valid-candidate coverage. Waiting outside compaction is only an observed gap not covered by compaction.

### 5. Context pressure

Use source `rawInput` for individual inputs, including cache input, rather than the uncached `tokens.input`. Only reliable response-scoped samples enter distributions; cumulative input and cumulative deltas are not instantaneous context. Cached input is an input subset; reasoning output is an output subset, with neither added again.

Use source windows valid in the same historical model/effort segment and turn time range. Prefer a same-record window, then evidenced historical continuation. Reset on model switches, conflicts, or discontinuities. Form each sample's `rawInput/windowTokens` ratio before calculating P90. With changing windows, do not divide input P90 by one common window. Without a positive integer window, report input distribution only and null ratios. Preserve ratios above 1 with an anomaly rather than clipping at 100%.

Name this “request input relative to the recorded window”; it is a context-pressure proxy. Without explicit source semantics and a sampling instant for active context, it is not exact window occupancy. Input, system reservations, images, output budget, and compaction policy may differ. Compaction count/union/location are facts. High input accompanying compaction is observational and does not prove its trigger. Retain adjacent reliable pre/post samples and their distances; do not fill gaps or model changes.

Use Type 7 quantiles: after sorting, `h=(n-1)p`, interpolating neighboring positions. Counts remain exact; quantiles may be fractional. Return candidate count, valid/missing samples, method, and model/window segments. No samples gives null; one sample gives that value. Synthetic `[100,200,300,400,500]` has P90 460, not nearest-rank 500.

### 6. Failures, validation, changes, and rework signals

Structured exit codes, statuses, and file-change events are facts. Nonzero exit does not establish an implementation defect: no-match searches, cancellations, and expected failure tests may return nonzero. Show failure rates, failed-command unions, and evidenced retry identities without assigning all subsequent time to failure. Without explicit retry links, call them repeated command categories.

The first phase does not read tool output to guess compiler-failure causes. Later classification uses structured commands/parse results in local memory only, matching known programs and argument patterns to test/build/typecheck/search/read/other. Retain labels, classifier version, and confidence evidence, not arguments by default. Complex shell, script internals, pipelines, dynamic commands, and indirect builds remain other. A string containing `test` is insufficient. Labels are inferences; execution durations are facts. Validation duration is a union of labeled intervals.

`FileChange` counts and identifiable distinct paths describe observed modifications, not net diff size, and miss script writes. Recorded `git status` commands or the final working tree cannot reconstruct the turn's initial state. Historical added/deleted lines and initial/final changed-path counts default to null. Later explicit user authorization may permit repository metadata checkpoints linked to turns, without implicit shell execution or diff-body collection. Missing historical baselines cannot be backfilled.

User-message times, repeated path changes, repeated validation after failures, and increasing validation counts are candidate rework signals. Scope changes, discarded implementation, necessary validation, wasted work, and code quality require semantic judgment and are not automatically generated. Later local user annotations may use `scope_change` / `rework_candidate`, retaining independent user decisions and methods. Basic scanning never starts model analysis. Message markers, path co-occurrence, and time correlations do not prove rework causality or “wasted minutes.”

### 19. Skill/MCP use and use counts

The product uses one definition: an explicit call, targeted read, or native load during task execution means used. Without such events, show no observed use; incomplete reads also expose incomplete data rather than asserting never used. Use establishes an operation, not success, benefit, or content compliance.

| Object | One use | Excluded from use counts |
|---|---|---|
| Skill | One read operation explicitly targeting its SKILL.md, or an explicit native Skill load/injection; linked records for the same operation merge | Catalog/configuration presence, model adoption declarations, name/path mentions, and Wombat's own file scans |
| MCP | One tool invocation explicitly attributed to that server/tool, or one explicit resource read | Configuration/catalog presence, discovery/enumeration-only records, name guesses, and Wombat's own observations; global discovery is not allocated to every server |

The unit is a use operation, not a log line, event, or distinct turn. Call/result, start/end, stream fragments, and duplicate completion notices form one operation. A repeated file read or independent retry with a new operation identity counts again. Three reads of one Skill within one turn count as 3 uses and 1 related turn. An operation explicitly reading two different Skills counts once for each Skill; per-object sums need not equal global tool-operation counts.

Failure, cancellation, and unknown outcomes do not subtract a use when actual dispatch is evidenced; unexecuted plans do not count. Outcome is detail, so receiving a result cannot count again after its start. A result alone with explicit call identity and target may establish one use. Ambiguous pairing retains candidates and count gaps rather than inventing an exact total.

Deduplication reuses reliable business-operation identity within source/session/turn and includes the target object, never turn alone, name, path, or nearby time. Fork replay deduplicates only with explicit inheritance/copy evidence, preserving independent real uses in other tasks. Time filters prefer reliable dispatch time, retaining the time basis when only completion is available. Missing times receive no invented date buckets and missing turn links receive no invented turns. Counts carry coverage and method versions, unchanged by paging or sorting.

Configuration queries have begun using operation-identity projections while retaining related-turn counts separately. Declarations and wrapper-read candidates without proof of inner execution do not increase use counts. CLI/Web delivery still requires generated contracts, copy, and evidence queries, explicit per-object method versions, coverage and time bases, and source-supported native-load and multi-target operation mappings. An internal projection does not establish delivery across entries. Related-turn Tokens remain associated usage, never independently allocated Skill or MCP consumption.

Independent synthetic acceptance covers start/result/copies counting 1, a second read/retry counting 2, failure counting 1, catalogs/declarations counting 0, and three uses in one turn counting 3 with 1 related turn. Also cover mixed objects, unassigned records, missing time, identity conflicts, dual native-load/read evidence, fork replay, and cold rebuilds. Missing time does not invalidate all-history observed counts for reliably identified operations, but must not invent date-range membership. This definition is only partially implemented; existing independent tests do not reduce the acceptance scope above.


## Alternatives considered

Tradeoffs within the moved sections remain intact. The [upgrade overview](2026-10-04-codex-task-timing.en.md) continues to own shared alternatives and rejection reasons. This change only splits documentation ownership, without changing existing technical choices.

## Acceptance criteria

This workstream owns U09–U10. The [overview task table](2026-10-04-codex-task-timing.en.md) remains the single list of completion gates and dependencies; field, failure, privacy, and algorithm constraints in this record also apply. Partial implementation remains proposed. Validate independent modules, commit, and push each increment; integration and full regression remain in U19. After an interrupting task completes, return to the unfinished workstream item; passing a local check does not skip remaining tasks.
