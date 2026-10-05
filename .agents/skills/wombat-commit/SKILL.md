---
name: wombat-commit
description: Split Wombat changes into coherent Git commits, reuse applicable code reviews, review uncovered changes with wombat-review, and verify each commit. Use when preparing or making local commits; pushing and publishing require separate scope.
---

# Wombat Commit Preparation

Group and commit only the requested work. Local commits do not authorize pushing, publication, or rewriting history. Preserve unrelated changes and partial staging; a planning-only request does not authorize commits.

Run `corepack pnpm skills:scope` to capture branch, HEAD, tracking, changed paths, and recent conventions. Inspect the requested diff and callers separately; the inventory does not prove review coverage.

- For grouping or review reuse, read [grouping](references/grouping.md).
- Before staging or making commits, also read [commit execution](references/commit.md). Verify each candidate against its actual preceding tree and recheck HEAD/index immediately before committing.

Use [wombat-review](../wombat-review/SKILL.md) for uncovered review and [wombat-verify](../wombat-verify/SKILL.md) for checks. These are actual workflow dependencies; invocation does not require another agent. Failed checks or unresolved findings stop the affected group unless the user explicitly accepts the specific omission. Report commit IDs, review coverage, checks, and remaining changes in the task.
