# Decision: MCP invocation identity, resource reads and fork replay

[中文](2026-10-04-mcp-runtime-evidence.md) | English

Status: implemented

## Problem

Generic tool records omit native MCP completion outcomes. Splitting server names from an `mcp__` prefix can misattribute calls and cannot identify resource reads. Forked history copies and independent retries require different treatment; configuration usage counts must not change the ledger.

## Decision

The source adapter reads native MCP begin/end events and persisted `McpToolCall` items, retaining only identities, operation types, outcomes and durations. Native server identities override name prefixes; conflicting identities stop configuration attribution. Resource reads require the exact built-in request name, valid server/URI arguments and call identity; URIs, arguments and response bodies are not retained. Reserved native names without a corresponding request could also be ordinary server tools and remain unclassified. Resource and template discovery does not count as use.

Operation identity includes the source-local thread, reliable turn and call/item identity. Begin/end records and copies within that turn merge; other turns and new call identities remain independent. Unidentified equal records are not deduplicated by body equality. With an explicit fork relationship, matching upstream turn and call identities return to a recorded ancestor thread, combining later outcomes and evidence. Equal counts or similar paths never establish identity. Cyclic ancestry or missing identities do not imply copying. Related usage takes the union of same-turn ledger measurements without allocating exclusive cost or changing measurements.

Replay reconciliation changes derived results only; parser facts remain rebuildable. Direct-measurement sources keep their existing fast path. Forked sources reconcile operations and resynchronize their projections so appends and restarts do not restore duplicate contributions. Auxiliary indexes borrow existing identities without caching arguments, URIs, outputs or another body copy.

One iterative preorder interval index serves both cumulative measurements and operations. Sorting exact identities and intervals enables a linear pass to select the oldest recorded ancestor, without walking every ancestor for every event. Operations batch metadata merges by ancestor and sort/deduplicate physical evidence once. With T relationship nodes, E events and P physical references, additional work is O((T+E)log(T+E)+PlogP); temporary indexes do not copy bodies. Parsing and queries still retain safe facts, so this is not constant-memory processing. Cycles and their descendants have no trusted ancestor interval: measurements and operations remain, with forkAncestryCycle disclosed instead of deleting each other to zero.

Canonical operation identities resolve directly through the operation table. Only distinct item/call identities need alias entries, avoiding duplicate resident and persisted mappings. Append and index restart retain the same identity resolution and pinned views remain unchanged.

Static recheck success is separate from natural follow-up adoption. Observations use only the requested historical page, original recheck times, current authorized physical objects and source/project, traversing canonical operations in a pinned usage view once. Multiple rechecks of one object keep their separate cutoffs. MCP ownership also checks physical declarations in the full current inventory with the same source and server name that apply to the project. History pagination cannot exclude competing declarations. Ambiguous events are not counted; without attributable records, the observation remains unavailable. Last times compare actual instants rather than RFC3339 strings. Only per-record counters, last times and selected versions are retained in the response; no duplicated ledger, bodies or execution receipts, persisted derived observations or rebuilt handling times are added.

Native file reads and MCP attempts lack reliable content versions, so associated events can establish only unknown versions, not adoption or savings. Without events, report no observation rather than inactivity; unavailable history and unsupported runtime events are separate. No model is started to verify benefit. Treating static success as adoption would conflate facts, and execution receipts would duplicate Codex responsibilities; neither is used.

## Alternatives considered

Name-prefix attribution is ambiguous, and counting file reads or discovery as invocation contradicts usage semantics. Deduplicating retries by equal content would discard independent attempts. Native identity and operation classification require some metadata and reconciliation work but no permanent collector or model execution for verification.

## Impact and validation

The adapter is `codex-rollout-3`. Configuration counts now include resource reads; usage is the sum of observed tool calls and resource reads, without substituting zero for incomplete coverage. Review storage selected `user_version=3` at that time; older layouts were rejected and retained without migration. See the [core README](../../../../core/README.en.md) for the current record format and version; the original acceptance does not establish acceptance of the new format.

The implementation was checked against Codex 0.160.0 [protocol definitions](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/protocol/src/protocol.rs), [persisted items](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/protocol/src/items.rs), [persistence policy](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/rollout/src/policy.rs) and [resource handling](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/core/src/tools/handlers/mcp_resource/read_mcp_resource.rs). Hook lifecycle notifications are not durable events in these logs; Skill invocations primarily use telemetry/extension notifications. This change does not reconstruct missing events from text or complete MCP prompts, full runtime coverage or natural adoption. See verification records retained in Git history for synthetic truth, cross-entry, append/restart and browser verification.
