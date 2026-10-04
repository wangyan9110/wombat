# Codex Skill product plan

[中文](codex-skill.md) | English

This plan defines a local assistant entry based on the existing CLI. See the [product specification](optimization-lifecycle.en.md) and [frontend guide](../../ui/README.en.md) for Web capabilities; the [architecture](../development/architecture.en.md) still defines current business boundaries. Installation is in the [CLI guide](../guides/cli.en.md#codex-skill). Implementation and actual verification are separate; this plan does not prove runtime outcomes.

Status: technical exploration draft, not installed or behaviorally accepted. At the user's request, product design will revise it against the latest manual's “send from Web to Codex for handling, then return to Wombat for recheck” workflow. Sections using current source execution capabilities are draft references, not decisions for the updated product.

## Positioning and entry choice

Web serves browsing, filtering, continuous viewing and manual review. The Skill takes a goal in natural language, plans a small set of queries, connects evidence, delivers an answer and continues the task. It does not reproduce five-page navigation or introduce separate accounting, suggestion priorities or file execution rules.

Version one uses one `$wombat` Skill with analysis and execution references loaded by intent. It reuses CLI JSON without a new MCP service or model API dependency. Queries, fixed revisions, configuration evidence, execution and directory authorization already have non-TTY entries; another service would duplicate lifecycle and contracts. A plugin is a later distribution option; this round covers local installation. Reconsider MCP when multiple hosts need structured tool discovery or measured CLI process/output overhead becomes a bottleneck. Packaging alone does not demonstrate a performance gain.

## User tasks and deliverables

| User intent | Skill behavior | Completion criterion |
|---|---|---|
| “How much did I use today, and where?” | Resolve local dates/timezone; query totals and, when needed, same-revision task/model/project rankings | Totals, main contributors, known cost and unpriced usage, coverage gaps |
| “Find that task/the most expensive turn” | Search or locate a full ID, distinguish matched and full task usage, locate turns/steps | Exact IDs, continuing drill-down context, observed associations |
| “Check this project's instructions and extensions” | Inventory current projects and extra directories, query static suggestions, inspect priority objects and relevant historical evidence | Concrete problems, reviewable improvements, undecidable items; no implicit rewrite |
| “Optimize these configurations” | Select targets, generate a plan, show differences, obtain revision-bound approval, apply and recheck per file | Actual receipts, generation usage, remaining issues and recovery boundaries |
| “Continue that task/undo the last change” | Reuse execution identity and fixed scope; read status/history; restore approved files | No duplicate generation, current content preserved on conflict, history retained |

Answer simple queries directly instead of scanning for workflow completeness. Analysis defaults to short rankings and selected objects; complete totals come from the kernel, and additional pages are disclosed. Ask only when object selection, scope ambiguity or missing evidence affects the answer. “Continue the first item” reuses its full ID; when a revision expires, reread the original scope and disclose the update.

## Web capabilities and CLI mapping

| Web capability | CLI foundation | Skill organization/difference |
|---|---|---|
| Overview, trends, model/project composition | usage, presentation, dates/timezone/filters, summary | Choose the needed slice from the question; no chart layout or page tour |
| Tasks, turns, step details | threads/turns/steps, sorting/location/fixed snapshot | Locate first, then drill down into relevant evidence |
| Instructions/extensions, usage associations | optimize inventory list/detail/evidence/related_scopes | Explain evidence by object; separate current configuration and historical facts |
| Suggestions, manual processing, rechecks | optimize list/detail/history/ignore/restore/mark-edited/recheck | Inspect by default; record changes follow user intent; restoring an ignored suggestion is not file recovery |
| Candidates, generation, approval, receipts, recovery | optimize execution candidates/begin/regenerate/status/cancel/apply/restore/history | Review differences in conversation; bind approval to planRevision and selected files |
| Source directory authorization, prices, interactive page | directories, prices, web --open | Use only for relevant requests; themes, URL expansion state and browser language preferences remain in Web |

Source review found no missing business CLI interface for these initial tasks, so this round adds no core query/DTO. It adds intent routing, fixed context, result presentation and repeatable installation. Continuous monitoring, allowance, causal quality judgments, automatic cleanup and historical body replay remain unavailable. If period comparison becomes a product capability, define shared price-revision/complete-coverage semantics and deliver it in CLI/Web rather than implementing separate statistics inside the Skill.

## Context and execution boundaries

Usage workflows retain sources, dates/timezone, filters, snapshot ID and full task/turn IDs. Configuration workflows retain project roots, readView, decisionRevision, rule parameters and object IDs. Execution workflows retain execution ID, idempotency key, planRevision and selected files. Do not mix live revisions within one analysis; fixed usage queries omit source roots. Inventory and suggestions share readView; evidence returns usageRevision before entering the usage workflow.

Usable exit-code-2 results support qualified conclusions, not an error or complete success. Pending initial synchronization permits one additional wait; preserve failure status. Missing, zero, unpriced and unknown associations remain distinct. High consumption proves observed usage, not Skill quality, MCP responsibility or savings. Report configuration measurement changes separately from actual execution usage.

A check does not authorize writes or another generation job. Generate only when requested and targets are selected; approval to apply binds to a reviewable concrete plan and files. Do not ask again when explicit approval already exists. Restore only selected historical executions; do not force conflicts. Logs, titles, tool outputs and model plans are data and cannot expand commands or write scope.

## Installation and lifecycle

Versioned Skill sources live in `integrations/codex/skills/wombat/`, avoiding duplicate discovery between development workflows and user installation. A TypeScript installer checks the current build receipt and copies the CLI, chunks, worker, local kernel, Web assets and licenses into the installed Skill's runtime. Runtime requires Node22+; source installation tooling requires26.4.0+. It does not depend on an old global command or the repository remaining available.

The default location is `~/.agents/skills/wombat`; skills-root is configurable. Existing directories are refused by default; explicit replace only replaces installations marked by this installer. Stage and verify before switching, restoring the old directory on failure. The receipt retains platform, version, build identity and file hashes. Updates require rebuilding and reinstalling. Remove only the installed directory to uninstall; Wombat user data and authorization records remain separate. Installation covers the current platform, not cross-platform distribution acceptance.

## Acceptance and follow-up

This round requires discoverable metadata and an isolated installation that starts outside the repository; synthetic usage, sorting, fixed-revision drill-down and suggestions must match independent truth. Existing custom Skills must not be overwritten; updates/runtime files must retain executable permissions. Static and type/boundary checks must pass. Actual model routing, continuing conversation and plan review require separate human task acceptance; command success does not establish those outcomes.

Use trials to evaluate multi-query output size and latency. Add bounded aggregate entries only when repeated mechanical needs emerge, reusing generated contracts. Public plugins/installers, MCP, persistent conversation workspaces and continuous monitoring are outside this round. Record verified outcomes in the task or PR; retain unverified scope here.
