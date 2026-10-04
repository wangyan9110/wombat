---
name: wombat-review
description: Review Wombat code changes against project conventions, behavioral contracts, tests, and decision records. Use for repository, branch, PR, or working-tree reviews, including decision maintenance and single-source documentation checks.
---

# Wombat Project Review

Review the requested change against [root instructions](../../../AGENTS.md), affected scoped instructions, and [code conventions](../../../docs/development/workflow.en.md). Use module READMEs and [contracts](../../../docs/development/contracts.en.md) for current behavior, and [decision maintenance](../../../docs/decisions/README.en.md) for rationale and unfinished requirements. These owners remain authoritative; this Skill defines the review procedure.

## Establish the review boundary

Identify the requested commit, branch comparison, PR, files, or working-tree changes. State the baseline and included staged, unstaged, and untracked files. Use the user-specified base; otherwise inspect branch tracking and the merge base before choosing a comparison. Do not treat unrelated existing work as part of the change. For a whole-project review, state the covered modules and prioritize their public entries and cross-module paths rather than claiming exhaustive coverage.

Read the diff, affected implementation, callers, and tests before forming findings. Search relevant decisions by the changed capability, invariants, and paths rather than reading every record. Separate regressions introduced by the change from existing defects and intentionally unfinished proposals. If intent is unclear, investigate available evidence and identify the unresolved assumption instead of declaring a design preference a defect.

A review request authorizes inspection and relevant checks, not automatic source edits, commits, publication, or PR comments. When fixes or documentation maintenance are also requested, perform them within that scope, preserve unrelated work, and review the resulting diff again. Do not require fresh permission for work already authorized.

## Review implementation and evidence

Trace affected behavior from the real CLI/Web entry through generated contracts to the Rust owner and back. Inspect alternate callers, not only the happy path. Use the code conventions as the checklist; prioritize observable consequences over formatting preferences.

| Changed area | Review focus |
|---|---|
| Module or API boundaries | Correct business owner, public imports, current consumer, generated DTO changes and all consumers, Web/non-TTY parity |
| Accounting or source evidence | Independent truth, hierarchical conservation, identity/replay handling, missing versus zero, pricing precision, partial failures, current versus historical evidence |
| State, storage, or async work | Atomic publication, failure recovery, user-record preservation, cancellation ownership, late responses, version isolation, bounded cleanup |
| Host or untrusted input | Authorization and version enforcement at execution, path scope, explicit process arguments, complete output/resource limits, sensitive-data handling |
| UI or user operations | Shared business semantics, locale ownership, scope/navigation retention, visible unknown/failure states, real interaction evidence |
| Developer or release tools | Actual aggregate/CI invocation, source-versus-build prerequisites, valid and invalid fixtures, nonzero failures, platform and artifact evidence |

For each candidate finding, identify a reachable trigger, the failing behavior, and its impact. Check callers and counterexamples that might invalidate it. Prefer a focused reproduction or existing test evidence where practical; label unverified hypotheses as questions rather than confirmed defects. Missing tests are actionable when a specific changed behavior or failure path lacks evidence, not simply because no new test file exists.

Use [wombat-verify](../wombat-verify/SKILL.md) to choose checks by affected scope. Build before tests that consume dist, distinguish static checks from behavior acceptance, and avoid rerunning unchanged passing checks. Report commands actually run and relevant platform/corpus limits. A green aggregate is evidence, not a substitute for semantic review.

## Review decision and documentation maintenance

Apply the owning decision rules to the same change, not as an optional later cleanup:

- Apply the decision owner’s recording threshold: lasting rationale not explained by code, tests, or existing docs. Updating the existing note satisfies it; mechanical/local edits, including local UI, are exempt.
- For refinements of the same decision, identify facts, paths, alternatives, or consequences that need updating. For a reversal, require a new cross-linked owner rather than editing the old rationale into its opposite.
- Verify lifecycle against the complete agreed scope and evidence. Partial delivery stays proposed; moving to implemented replaces plans with actual decisions and consequences. Remaining acceptance gaps must retain an owner rather than disappearing during a move.
- Inspect full versus partial supersession. Partial replacement keeps both owners linked. Before full consolidation/deletion, account for unique rationale, alternatives, costs, required verification, and named gaps in the surviving owner; Git history alone does not preserve their active ownership.
- Check one home per fact: unfinished requirements and acceptance in the owning proposal; current behavior in module/reference documentation; rationale in decisions; execution results in tests, CI, or scoped evidence. Flag duplicate specifications, status tables, catalogs, or conflicting claims with concrete locations.
- Check incoming links, both language files, confirmation records, manifests, and executable consumers of moved/deleted paths. Hash confirmation alone does not prove translation fidelity. Use [wombat-docs](../wombat-docs/SKILL.md) when authorized maintenance requires edits.

Report a decision-maintenance omission with the affected note or code location, the specific conflict or lost requirement, and the needed update/move/link/consolidation. Do not create a new review report, progress ledger, or decision merely to record that a review occurred.

## Report and follow through

Lead with actionable findings ordered by severity. Each finding names a precise file/line, trigger, consequence, supporting evidence, and a concise correction direction. Use P0 for an immediate critical issue, P1 for a high-impact defect, P2 for a normal actionable defect, and P3 for a minor concrete issue; do not assign urgency without evidence. Documentation and decision defects use the same impact-based standard.

Then state unresolved assumptions, actual checks, and coverage limits. If no actionable findings remain, say so explicitly without claiming the code is defect-free. Keep pre-existing issues separate from introduced regressions. When repairs were authorized, distinguish fixed findings from unresolved ones and report focused revalidation; do not publish findings to external systems without authorization.

Make review reuse assessable: identify the base and reviewed revision, or content fingerprints for uncommitted files/diffs, along with covered scope and unresolved findings. Retain this evidence in the task, not a repository ledger. Later edits or changed dependencies require reassessing affected coverage; a review is not permanent approval of a filename.
