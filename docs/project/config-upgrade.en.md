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

## Acceptance

1. CLI/Web agree at the same range and version; pagination preserves totals, and cross-day turns distinguish complete from matching usage.
2. Equal names across sources remain isolated; duplicates count once, independent retries twice, loading never as invocation, and unknown never as zero.
3. Empty, missing, unreadable, invalid encoding, oversized and absent MCP definitions have distinct states; newline changes invalidate caches.
4. Multiple findings on one Skill share one primary workflow; after format repair size findings remain, and unknown descriptions never become zero.
5. Ignoring does not hide new issues; rechecks after manual edits update current configuration and suggestions while historical measurements stay fixed.
6. Configuration-to-task-turn navigation and return restore object, filters and reading position; expiration is explicit.
7. Verify language switching, refresh, restart preferences, dialogs, focus, long labels and narrow screens; source content stays untranslated.
8. Verify with synthetic corpora; prototype or build success cannot substitute for real execution, other platforms or later capabilities.
