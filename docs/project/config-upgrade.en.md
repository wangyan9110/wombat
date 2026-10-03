# Overview, tasks and configuration optimization specification

[中文](config-upgrade.md) | English

This is the independent public specification for the 2026-10-01 upgrade, not a completion claim. See the [support matrix](../reference/support-matrix.en.md) for current capabilities and [progress](progress.en.md) for evidence.

## Entry points and scope

The GUI has Overview, Tasks, Configuration and Optimize entry points. CLI and Web consume shared Rust business logic and generated contracts in parallel; protocol identities such as thread remain unchanged. TUI does not return; Tauri is a future host. Projects remain explicitly authorized directory evidence, not a project registry.

Overview shows Token, standard API-equivalent cost with a USD label, trends, project distribution, recent tasks and an optimization summary together; a single project shows high-usage tasks. Increased usage does not imply waste. Clicking usage or cost opens the same right-side detail with composition, time, model, project and related tasks. Task details expand Token and cost composition by default, with source details disclosed on demand. Overview cost uses two decimals and a threshold for positive values below 0.01; details use four decimals. Algorithms and sorting never use display rounding.

Dates support all records, including separately labelled records with unknown dates. Configuration events and usage share the range; current configuration content does not change with the date filter. Detection uses its own check time, never usage model or date filters as an inactivity window. Language retains zh/en; switching preserves state. Preferences live in the local product data directory, with an explicit launch language taking priority. Real task titles, paths and protocol fields are not translated.

## Configuration facts

Inventory includes only the exact name AGENTS.md, in source user roots and through bounded discovery in authorized projects; it does not interpret loading precedence. Project discovery excludes .git, node_modules, target, dist and symlink directories. Missing, unreadable, invalid encoding, resource limits and complete empty content are distinct. Reliable filesystem metadata may independently supply bytes, with its origin and state declared; previous content measurements remain labelled as old, never paired with new metadata.

AGENTS.md character counts are Unicode code points, including spaces and newlines. Skill measurement covers the entire SKILL.md including front matter, without referenced files. Description length requires a successfully parsed field. MCP measures only a trusted complete model-visible definition snapshot; without one it remains unknown. Connection configuration is not measured and servers are not executed to obtain definitions.

Content Token uses one offline, fixed-version o200k_base ordinary-text reference across the table, recording method, version, hash and applicability. It is not actual input for an unknown model and excludes chat wrapping. Limits or failures remain unknown; truncated input is never presented as a full estimate. Cache keys include content fingerprints and method versions, never bodies.

Usage counts include only explicit independent Skill invocations and MCP tool calls/resource reads. Reads, loading and connections are separate. Duplicate logs are deduplicated; failed attempts and independent retries still count. AGENTS.md has no usage count. Unobservable events or inadequate coverage never turn absent records into zero. Associated usage includes deduplicated measurements within reliably associated turns that match the range. Configuration rows may overlap and are not added together or treated as exclusive cost.

## Suggestions and handling

Detection is separate from object suggestions. Format, description and body findings merge, prioritizing format/specification issues. Identity includes source, object and scope; equal names across sources do not merge. The2026-10-02 revision uses static-config-v2: AGENTS.md >16,384 B is an adjustable product reminder, without host loading-budget diagnosis. Skill no longer uses a16KiB file reminder; independently estimated body tokens ≥5,000 trigger after successful parsing. The exact body excludes YAML/delimiters while preserving whitespace/newlines, separately recording method, tokenizer version, hash and containing configuration version. Unknown never becomes zero; full estimates are never subtracted or replaced by character constants. Inventory still measures full files. Description uses Unicode code points:501–1,024 is a product reminder; >1,024 is a specification issue replacing the duplicate500 reminder. Manual shortening can change category or close it. See the [Agent Skills specification](https://agentskills.io/specification). Body values are not host limits, consumption or predicted savings, and specification violations do not establish local loading failures. Incomplete extension parsing is not a format failure.

Rules return defaults, user overrides, fixed body/specification lines and authorized-current-config applicability. CLI flags or the Web reminder panel adjust only product reminders; values remain in links/review evidence. Specification constraints are immutable. Old caches without body measurements remain unknown; old ignores remain readable without suppressing new rules. Rechecks separately record current rules and cannot pass with unknown body estimates.

Optimize separately shows pending suggestions and handling history, with four action categories: repair configuration, trim content, organize extensions and clean space. Each suggestion supplies evidence, a check version, primary action and recheck result. The first delivery includes static checks and a complete manual-edit workflow: locate the file, mark awaiting recheck and recollect. Ignore binds the object, specific issue and scope; independent new issues remain visible. Ignore decisions and handling history persist separately from rebuildable indexes. There are no timed snooze or retention periods.

The optimization list shows a specific suggestion, one value sentence and one key metric. Its right-side detail presents suggestion/action, related usage and a collapsed check basis; manual steps expand on demand. Record counts, deduplicated turn tokens and estimated API cost appear together through evidence queries pinned to configuration/usage versions, without copied demo values. Related dates filter records only, leaving static checks, current configuration and inactivity windows unchanged. Exact task turns link back to the original suggestion, record, dates, project/source, category, page, reminder values and filters; missing turn identity disables exact navigation. Unknown usage with no association, unavailable history and incomplete coverage remain distinct.

Manual marking retains original safe measurements. Recheck shows only comparable before/after bytes, codepoints, description length and reference tokens with matching methods; old records without a baseline remain unknown. Related usage, smaller files and threshold differences do not establish savings.

The Skill/MCP30×24-hour window is an inventory cycle with one cutoff and inclusive continuous complete coverage. “No observed use” requires currently enabled objects, stable identity, all applicable projects/clients/event categories covered and no positive evidence. Failed attempts/distinct retries count as use; reliable Skill instruction reads block inactivity, and recognizable MCP resource-read/prompt-fetch events cannot be omitted. Installation/modification/last-call timestamps do not establish coverage. Complete observation adapters are absent, so inactivity remains unsupported without suggestions.

The worktree14×24-hour window is only supporting evidence: tasks must have ended, trusted state must establish no running associated tasks, main/locked/retained folders are protected, and observation must be complete. Execution independently checks uncommitted/untracked/needed ignored files, recoverable commits and host registration. Incomplete coverage/state generates no cleanup suggestions. Git’s default3-month period concerns stale administrative records for disappeared folders, not deletion of existing folders; see [Git worktree](https://git-scm.com/docs/git-worktree). These adapters are absent and storage remains closed; MCP faults still require explicit connection/cause evidence.

Configuration writes remain closed until ChangePlan, prerequisite fingerprints, accurate diffs, recovery materials, idempotency, per-item receipts and recovery-conflict verification exist. Manual editing does not imply host adoption. Failed rechecks do not pass, and smaller files do not establish savings. The read-only first delivery exposes no arbitrary file writes, shell or dispatch.

## User interface and help · 2026-10-03

Normal pages explain what users can see and do, and how far the results can be trusted. Usage and configuration findings appear by default, without requiring search or filters first. Development stages, review scenarios, simulated-result controls and internal execution identities stay outside product navigation and ordinary details. File paths, verifiable content positions, thresholds, check times and applicability remain useful evidence. Unknown values, partial coverage, estimated costs and unverified effects stay beside the relevant results. Chinese and English use their own natural phrasing. The brand remains “让 AI 工作更高效” and “Make AI work better.”.

Shared help is collapsed by default. Local links open the relevant topic; closing help returns to the original page or drawer and restores focus. Keep five topics:

1. How are tokens and costs calculated?
2. What counts as usage?
3. How are text size and estimated tokens measured?
4. What does related usage include?
5. Common questions.

Explain zero, unknown and incomplete records within usage counting. Input includes cache tokens and output includes reasoning tokens; do not add them again. API estimates are neither subscription bills nor remaining allowances. Reading a file does not prove Skill invocation. Related-turn totals are not a file's exclusive cost, and smaller text does not establish savings. Present detection evidence through readable methods, conditions and file positions. Rule codes, relation identities, raw evidence codes and hashes are not ordinary page explanations. Keep protocol and pinned-version identities; simplifying presentation must not remove business evidence.

### Source mapping and gaps

This table records source inspection on 2026-10-03, not browser or end-to-end acceptance in this round. The [support matrix](../reference/support-matrix.en.md) still defines support limits.

| Area | Current code | Remaining difference |
|---|---|---|
| Default overview and four pages | [App](../../ui/src/App.tsx) defaults to usage and the optimization summary; normal navigation has no review selector | Preserve default value and remove development-facing copy throughout the pages |
| Contextual help | [Basis](../../ui/src/components.tsx) provides cost evidence; other explanations are spread across details | No shared five-topic help, local deep links or return-focus rule yet |
| Configuration and finding evidence | [Configuration details](../../ui/src/ConfigView.tsx) and [optimization details](../../ui/src/OptimizeView.tsx) retain positions and evidence | Rule versions, content hashes, evidence codes and some source identities still need presentation mapping |
| Initial waiting and cancellation | The [coordinator](../../ui/src/workspace.ts) handles real pending states, follow-up reads, old results and cancellation of this view; [waiting feedback](../../ui/src/Preparation.tsx) shows elapsed time | No per-file progress or reliable ETA; fixed delays must not announce completion or claim to stop shared scanning |
| Manual edits and rechecks | The [operation contract](../../core/src/optimize_dto.rs) supports marking, ignoring, restoring ignored findings and rechecking collected files | Restoring an ignored finding does not undo file edits; plan generation, file application and file recovery are absent |
| Prices and sources | Real queries, price updates, background pricing, startup authorization roots and restart instructions are connected | Authorization recovery mainly requires restarting, rather than interactive directory authorization; preserve failures and unknown values |
| Usage and text results | Independent accounting, deduplicated related usage, complete measurements with matching methods and review baselines are connected | Actual injection, continuous inactivity and complete MCP runtime health lack reliable evidence; do not invent findings or success |

### Delivery order and acceptance

1. Improve presentation first: shared five-topic help, local links and focus restoration; map evidence and known errors through the shared locale package. Preserve paths, positions, conditions, unknown values and recovery actions. Ordinary pages must not emit internal identities or unexplained fields. Copy changes do not rewrite existing Rust rules or accounting.
2. Then verify real states: actual queries and committed results drive waiting, failure, stopping the wait and rechecks. Complete late-response, multiple-window, disconnection and persistence-failure acceptance under the [startup specification](startup-rules.en.md). Extend Rust-generated contracts only for observable needs. File writes, checks passing, runtime effects and actual usage changes have distinct outcomes.
3. Deliver execution separately and last: complete narrow tasks, content-sending scope, ChangePlan, preview baselines, recovery materials, per-file receipts, idempotent continuation and conflict handling before enabling model generation, application or recovery. After closing, disconnection or restart, query the persisted execution identity before proceeding; do not resend automatically. Recovery must not overwrite later user edits, and multiple files must not be described as atomically completed. Deduplicate optimization-task usage against later logs by actual measurement identity; add it to total usage without offsetting smaller text. Capability responses mark unsupported actions unavailable rather than showing success first.

Presentation acceptance covers both languages on all four pages, five help topics, drawer returns and keyboard focus, narrow screens and unknown/partial results. State acceptance uses synthetic faults with the real core. Execution separately verifies sending scope, cancellation, conflicts, partial application, recovery and accounting conservation. Static-design timers, preset diffs, measurements and success messages are not production completion conditions. Private materials must not become public build or test dependencies.

## Acceptance

1. CLI/Web agree at the same range and version; pagination preserves totals, and cross-day turns distinguish complete from matching usage.
2. Equal names across sources remain isolated; duplicates count once, independent retries twice, loading never as invocation, and unknown never as zero.
3. Empty, missing, unreadable, invalid encoding, oversized and absent MCP definitions have distinct states; newline changes invalidate caches.
4. Multiple findings on one Skill share one primary workflow; after format repair size findings remain, and unknown descriptions never become zero.
5. Ignoring does not hide new issues; rechecks after manual edits update current configuration and suggestions while historical measurements stay fixed.
6. Configuration-to-task-turn navigation and return restore object, filters and reading position; expiration is explicit.
7. Verify language switching, refresh, restart preferences, dialogs, focus, long labels and narrow screens; source content stays untranslated.
8. Verify with synthetic corpora; prototype or build success cannot substitute for real execution, other platforms or later capabilities.
