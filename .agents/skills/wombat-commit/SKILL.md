---
name: wombat-commit
description: Split Wombat changes into coherent Git commits, reuse applicable code reviews, review uncovered changes with wombat-review, and verify each commit. Use when preparing or making local commits; pushing and publishing require separate scope.
---

# Wombat Commit Preparation

Follow [root instructions](../../../AGENTS.md). This workflow owns grouping and local commits; [wombat-review](../wombat-review/SKILL.md) owns review criteria, [wombat-verify](../wombat-verify/SKILL.md) owns verification scope, and [decision maintenance](../../../docs/decisions/README.en.md) owns documentation lifecycle. Do not duplicate their rules or create a commit-status ledger.

## Establish scope and groups

Inspect the branch, HEAD, staged and unstaged diffs, untracked files, and recent commit conventions. Include only the user's requested work; existing staging is evidence of intent, not blanket authorization to commit unrelated changes. Preserve other work and partial staging. Resolve an ambiguous scope before committing affected files, while continuing independent review and grouping.

Group by independently understandable purpose and dependency order, not by extension, directory, author, or target commit size. Keep implementation with its tests, generated contracts, dependency/lockfile changes, locale pairs, and necessary documentation. Moves/deletions stay with incoming-link and manifest repairs. Decision lifecycle changes belong with the behavior that justifies them. Do not split a bilingual pair or leave an intermediate commit with broken imports, missing generated files, or dangling references.

Separate independent fixes from features or mechanical cleanup when they can stand alone. Keep tightly coupled changes together; one commit is valid when splitting would create artificial dependencies. Inspect mixed-purpose files at hunk level. Identify prerequisites before dependents and reconsider groups after fixes rather than preserving an obsolete plan.

Briefly state proposed commit purposes, order, and review coverage. If the user requested commits, continue without an extra approval round. A request only to plan, stage, or create this Skill does not authorize committing the current checkout. Local commit authorization does not imply pushing, tagging, publishing, or rewriting history.

## Reuse review where it remains valid

Look for actual review evidence in the current conversation or an accessible task/PR review. Establish its base, reviewed revision or exact content, covered files/hunks, relevant dependency context, findings, and follow-up verification. A remembered “reviewed,” matching filename, commit title, or green CI alone is insufficient. Do not create a repository receipt file merely to track review reuse.

| Evidence and current content | Action |
|---|---|
| Review covers the same patch and relevant surrounding contracts; findings resolved or explicitly accepted | Reuse the review and cite its scope; do not repeat it mechanically |
| Only some changes are covered | Reuse that portion and review uncovered changes plus affected interactions |
| Content, base, dependencies, generated outputs, or decision ownership changed after review | Review the delta and any invalidated assumptions or interactions |
| No identifiable review, or insufficient evidence to determine coverage | Run wombat-review on the proposed scope |

Invoke wombat-review within this task for uncovered scope, including code, tests, and decision/document maintenance. This does not imply starting another agent or messaging another chat. Separate pre-existing findings from introduced defects. Fix actionable issues within already authorized scope and review the fix; otherwise leave the affected group uncommitted and report the finding or necessary user decision. Do not silently treat an unresolved finding as accepted risk.

Splitting a reviewed final tree can still introduce broken intermediate states. Check each group's diff against its actual preceding tree, including callers and prerequisites. Reuse unchanged semantic review, but verify that the new order or omitted changes does not invalidate it. A whole-tree test run alone does not prove every partial commit works.

## Stage, verify, and commit

Stage explicit paths or inspected hunks for one group. Avoid blanket staging, destructive resets, or clearing someone else's index. If unrelated staged content prevents an exact commit, preserve it using an isolated index/workspace strategy or resolve the scope; do not silently include or discard it. Inspect the complete staged diff, including deletions, new files, modes, and generated artifacts, before proceeding.

Select meaningful checks with wombat-verify. When unstaged files could mask missing dependencies, validate the staged tree in an isolated snapshot. Reuse passing evidence only when it applies to that exact group and its prerequisites; build before artifact-dependent tests. Run staged whitespace checks and the checks required for the affected scope. Failed or unavailable required checks leave the group uncommitted unless the user explicitly accepts that specific omission; report the limit rather than claiming it passed.

Immediately before committing, recheck HEAD and staged content against the reviewed and verified candidate. If another edit, hook, or tool changes the candidate, inspect and revalidate the affected scope. Use a concise repository-consistent commit message describing the resulting behavior; add rationale or limits only when useful. Do not bypass failed hooks, amend existing commits, or reset history unless explicitly authorized. A failure stops dependent commits until diagnosed; it does not justify force or blind retries.

After each successful commit, inspect its actual diff and remaining staged/unstaged state. Verify that only the intended group entered the commit and that unrelated work remains. Continue with dependent groups using the new HEAD as their base. If a discrepancy appears, report and resolve it without silently rewriting history.

## Report

List the created commit IDs and purposes, reused versus new review scope, relevant checks, and any uncommitted changes or unresolved findings. If no commits were requested, return the concrete grouping and review outcome instead. Keep this evidence in the task; do not add another progress document or decision solely to record a commit.
