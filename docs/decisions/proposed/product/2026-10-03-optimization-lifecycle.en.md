# Decision Note: complete optimization lifecycle and runtime evidence

[中文](2026-10-03-optimization-lifecycle.md) | English

Status: proposed

## Problem

Static configuration facts and focused UI tests do not establish a complete optimization lifecycle. Runtime events, continuous coverage, reliable historical versions, and complete platform journeys remain incomplete. Unknowns are not absence of problems, and related usage or text reduction is not savings. This proposal owns remaining requirements from the former five-entry specification and status ledger. Consolidation neither reduces agreed scope nor restarts product implementation.

## Proposal

Extend shared Rust facts and generated contracts through both Web and noninteractive entries. The [UI README](../../../../ui/README.en.md), [contract](../../../development/contracts.en.md), and [CLI guide](../../../guides/cli.en.md) own current interfaces, fields, and operations. The [native-handoff decision](../../implemented/architecture/2026-10-03-native-codex-handoff.en.md) owns sending/execution responsibilities without duplicating shipped mechanisms here.

### Runtime observations and content evidence

G01: complete reliable Skill invocation, Hook execution, and MCP prompt events. Distinguish calls, reads, loading, and connections; count independent failures/retries and deduplicate stable event replay without merging independent parent/child activity. Zero requires complete coverage without events. Incomplete coverage yields observed counts or unknown. Existing tool/resource and Skill-observation subsets do not complete this requirement.

G02: obtain MCP text from trustworthy complete definitions with versions and measurement methods, without starting services to obtain them. Missing, truncated, limited, or invalid data remains unknown. The contract alone owns existing AGENTS/Skill thresholds and tokenization fields.

G03: provide an automatically included context inventory with reliable origins, actual content versions, scope, size, and recorded counts. Inventory is not itself a defect and counts/size do not predict savings.

G04: same-request duplicate injection requires request/context identity, compaction generation, historical source-content version, and two actual inclusion positions. Deduplicate replay without mixing parent/child activity, new requests, or compaction generations. Complete static blocks, common directories, current files, and repeated reads are insufficient substitutes. Reverify comparable real contexts after correction.

### Continuous observation and resource candidates

G05: Skill/MCP inactivity requires stable identity, continuous enablement, at least thirty consecutive 24-hour periods of complete observation with inclusive boundaries, and no use across every applicable project/client, including failed attempts. Reliable Skill reads also prevent complete-inactivity findings without counting as invocation. Installation/file dates, imported history, or zero within a filtered window do not establish coverage.

G06: worktree, temporary-file, and cache candidates require at least fourteen days of complete observation, no activity, completed tasks, and no running tasks. Exclude main directories, pinned/locked worktrees, and protected objects; check untracked/ignored materials, edits, commits, and recovery conditions. Caches additionally require trusted ownership and regeneration evidence. Recoverable relocation does not mean freed space; users decide cleanup and recovery in Codex.

G07: initial consecutive-check parameters require at least five checks in one running task, gaps no greater than two seconds, no new output, and no input or prompt-response requirement. Overall coverage needs at least five analyzable tasks, three matching tasks, two matching dates, and a match within the final seven observation days. Exclude necessary keepalives, interaction, long waits, and evidence gaps. Without an editable location show evidence only. Version parameters and test boundary counterexamples.

### Natural adoption and usage reconciliation

G08: under reliable historical versions, distinguish no observation, unknown versions, confirmed adoption, and recurrence. Do not run extra models to establish benefits. Deduplicate actual optimization-task usage against history by stable measurement identities; never add task totals and related usage twice or replace unknown with zero. Text comparisons require equal scope/method and do not establish causal benefits. Checks remain separate from user decisions; rechecks do not revoke keep/not-applicable choices, and missing/unreadable files do not automatically resolve findings.

### Complete product journeys

G09: complete Windows Hooks, platform installations, and failure journeys. The [release Skill](../../../../.agents/skills/wombat-release/SKILL.md) owns release operations and the [GitHub distribution decision](../../implemented/architecture/2026-10-04-github-release-distribution.en.md) owns durable target rationale; the [local-Web decision](../../implemented/architecture/2026-10-01-local-web.en.md) owns desktop scope/tradeoffs without adding Tauri to this Web/CLI repair round. The [initialization proposal](2026-10-02-progressive-initialization.en.md) owns first reads and project progress; the [live-index proposal](../architecture/2026-09-30-live-usage.en.md) owns scale targets.

Continuous cross-project journeys across five pages must retain scope, filters, exact turns, lists, focus, and reading position. Late responses, refreshes, and language changes cannot overwrite new selection. Verify Chinese/English at 320/390/1280/1440px, native-select keyboard use, cancellation/closing, unknown delivery, concurrency, and version changes in actual browsers. Complete account-summary, actual-exhaustion, expired-restriction, and independently degraded section checks without deriving allowance from local usage.

Help covers tokens/amounts, usage counts, text size/estimated tokens, related usage, and common questions. Global help starts collapsed; local explanations are directly accessible and restore focus without requiring internal developer identifiers. Amount precision, date semantics, and query conservation follow current contracts and UI documentation.

The local Codex Skill reuses CLI operations without duplicating pages, accounting, or execution services. Isolated installation runs outside the repository and preserves custom same-name Skills, permissions, and independent user data; queries, rankings, fixed-view drill-down, and findings use independent truth. Natural-language routing, ongoing conversation, authorized edits, and rechecks require human-task acceptance rather than installation tests. Public plugins, persistent conversation workspaces, and continuous monitoring are outside local-installation delivery.

## Alternatives considered

Static size, read counts, or absent events cannot justify waste, inactivity, or savings, so retain unknown states and implement evidence adapters first. Demonstrations or test counts cannot replace fault and interaction journeys. Native handoff supersedes Wombat-owned generation, application, execution receipts, and recovery; acceptance work must not restore them.

An MCP wrapper for the Skill would duplicate lifecycle and contracts. Reconsider only for multi-host tool discovery or measured CLI overhead, not as an assumed performance improvement.

## Acceptance criteria

G01–G09 remain agreed scope rather than optional follow-ups after partial delivery. Independent truth must cover thresholds, failure, retries, parent/child replay, different versions, and unknowns. Web/CLI share facts and per-rule failures must not block independent checks. The [bounded-rule](../../implemented/architecture/2026-10-02-startup-static-rules.en.md) and [review-integrity](../../implemented/architecture/2026-10-02-rule-review-integrity.en.md) decisions own static-block, declared-copy, and Hook-reference regression rationale.

Full acceptance failed in the 2026-10-04 [product evidence](../../../benchmarks/2026-10-04-product-acceptance-feedback.json); subsequent [repair evidence](../../../benchmarks/2026-10-04-product-acceptance-fixes.json) does not replace product reacceptance. F01 needs sending-specific errors, installation recovery, and no automatic retry of unknown delivery. F02 needs correct instruction/extension scope and estimated-token copy. F03 needs task purpose, filtered summaries, reliable turns/suggestion associations, on-demand identity details, and recent/all/highest-usage navigation, with full visual acceptance outstanding. Those artifacts alone retain build and scenario outcomes, without another status table.

Verify assembled entries for single and complete batch selection, shared files, per-project cwd, content/evidence-change rejection, disconnects after acceptance, and rechecks. Request acceptance is not resolution; retain neither historical send deduplication nor Wombat execution receipts. Builds and prototypes cannot replace actual interfaces or human-task outcomes.

## Risks

Sources/hosts without complete events and coverage may leave capabilities unknown; never lower evidence thresholds to manufacture completion. Accounts, runtime observations, platforms, and long runs require different conditions; focused success does not generalize. Resource targets remain pending; prioritizing functionality does not cancel performance requirements.
