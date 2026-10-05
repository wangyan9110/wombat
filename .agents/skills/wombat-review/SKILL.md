---
name: wombat-review
description: Review Wombat code changes against project conventions, behavioral contracts, tests, and decision records. Use for repository, branch, PR, or working-tree reviews, including decision maintenance and single-source documentation checks.
---

# Wombat Project Review

Review the requested scope against [repository rules](../../../AGENTS.md), affected scoped instructions, and [code conventions](../../../docs/development/workflow.en.md). A review request authorizes inspection and checks; apply fixes or publish comments only within existing user authorization.

Run `corepack pnpm skills:scope` for the checkout inventory. Choose the requested baseline, inspect diffs, implementation, callers, and tests, then read [review procedure](references/review.md). Do not treat unrelated changes as part of the review.

Read [documentation and decision review](references/documentation.md) when changes affect ownership, behavior documentation, decisions, or moved references. Read [reporting and reuse evidence](references/report.md) before returning findings or reusable review coverage.

Use [wombat-verify](../wombat-verify/SKILL.md) to select checks. Confirm a reachable trigger and consequence before reporting a defect; separate pre-existing issues and unfinished proposals from regressions. Report actual checks and limits; green checks do not establish complete product acceptance. Keep review evidence in the task rather than a repository ledger.
