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
