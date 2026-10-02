# Wombat usage and conversations: version-one specification

[中文](specification.md) | English

This page maintains requirements and acceptance criteria, baselined on 2026-09-30. It does not establish acceptance of every target. See [implementation status](status.en.md) for delivery and gaps and [progress](progress.en.md) for results. The pre-migration code inventory is retired from the current specification; lasting tradeoffs are in the [independent-accounting decision](../decisions/implemented/architecture/2026-09-30-independent-accounting.en.md) and [snapshot decision](../decisions/implemented/architecture/2026-09-30-snapshot-storage.en.md).

Shared Rust queries present usage and tasks, aggregating complete ranges before pagination and separating matching from full-task usage. Additional page, configuration measurement and manual-review requirements are in the [upgrade specification](config-upgrade.en.md).

## Scope

| Item | Requirement |
|---|---|
| Product entry | `wombat` defaults to usage text; `web` opens the local interactive page; explicit commands require no TTY |
| Sources | Register only Codex in version one, reading active/archive/multiple-root logs; the protocol permits future agents with different capabilities |
| Usage | Daily/weekly/monthly, date/timezone, model, effort, project, and conversation scopes; date subtotals, model components, complete totals |
| Conversations | Cross-day/model lists, native titles, title/project search, consumption or recent-activity sorting |
| Turns and records | In-place expansion, time/consumption sorting, accounting categories, safe operation metadata; no text replay |
| Multiple entries | Rust operations reach Node CLI, JSON, and local Web through generated contracts; future hosts reuse the same narrow interface |
| Platform and language | Node.js ≥26.4.0, first accepted on macOS arm64; Chinese/English follow the [language contract](../i18n/product.en.md); other platforms need separate installation acceptance |

No quota, checkup, automatic configuration writes/repair, evidence-package export, threshold notifications, comparison, parent/child task analysis or HTML reports. Read-only configuration, static reminders and manual reviews follow the upgrade specification; desktop hosting remains future work. Inheritance/fork facts serve only necessary attribution and deduplication. See the [support matrix](../reference/support-matrix.en.md) for complete current boundaries.

## User journeys

1. Build a local index initially. With an index, wait for the current read when opening a main view and update main lists after synchronization. Explicit refresh saves a fixed snapshot; explicit snapshots never refresh automatically. Failure, incomplete synchronization, and old results must be distinguishable.
2. Daily reports default to 30 calendar days; weekly to this month plus 5 previous months; monthly to this month plus 11 previous months, all through today. Explicit CLI dates override; changing Web periods retains current dates. Weeks start Monday; grouping uses each event timestamp and selected timezone. A conversation filter without dates uses its full range.
3. Date/model/effort rows open related conversations with full filters. `matchedUsage` retains incoming conditions and `threadUsage` the whole conversation; a partial cross-day amount must not masquerade as complete.
4. Conversations expand full turns. Inside turns, chronological order is default; consumption order places measured records first, then operations chronologically. Unassigned measurements remain in Other records without loss or allocation.
5. Turn shares use complete conversation tokens; step shares use complete turn tokens. Pagination, sorting, and expansion never change denominators; zero denominators display missing values. Returning preserves filters, pagination, selection, and expansion.
6. Usage and conversations link both ways and keep independent main-view filters. Cancelling filter drafts leaves applied queries unchanged; old snapshots without details explicitly report unavailability.

The [frontend guide](../../ui/README.en.md) owns pages, prices, themes, and widths; the [CLI guide](../guides/cli.en.md) owns commands, filters, and errors. This specification does not duplicate help.

## Data and presentation constraints

- Namespace identity by agent, source instance, and upstream identity. Names, equal token counts, and nearby times do not establish duplication. Projects use exact directory evidence; verifiable stable legacy identities remain.
- Modern responses are independent measurements. Cumulative telemetry, compaction copies, and inherited replay must not double count. Bad lines, replay, or context switches end untrusted inheritance; current configuration never fills historical models, providers, or effort.
- Link tools through call/item identity within the conversation. Without explicit response association, display actual order without time-based cost allocation. Only explicit file arguments to `SKILL.md` establish a Skill-file read, not responsibility for a turn's consumption.
- Uncached input, cache read, cache creation, and output do not overlap; reasoning belongs to output. Preserve missing, zero, conflicting, and unknown, with traceable original models/effort and provenance.
- Standard API equivalents remain separate from source reportedCost, old policies, and subscription spending. Price per-request conditions, aggregate unrounded measurements in Rust, and format only in Node. The [pricing reference](../reference/pricing.en.md) owns details.
- Lists normally show two decimals and details four. Use thresholds for nonzero amounts below display precision, never zero. Label unknown/partial amounts; never sum rounded display values.
- Missing native titles do not become generated question summaries; missing turn numbers do not become claimed native numbers. Dates follow actual timezone/language and source precision without invented seconds.
- Use readable desktop and390px layouts and retain full costs on narrow screens. Avoid repeated branding; explanations expand in the footer. Source text is sanitized for control characters and remains data.

## Storage, resources, and extension

Adapters own formats; the public model depends on neither JSONL nor Codex private databases. Capability descriptions differ from actual field availability. A daily-only source cannot manufacture responses or turns. A test-only heterogeneous adapter does not establish production support. See [source acceptance](../development/adapters.en.md) for rules and independent truth.

Collection scope and display scope are separate. Process complete valid large lines; wait on incomplete tails. Truncation, replacement, failures, and resource limits produce receipts. Fix each file's observed boundary per read without claiming atomic source consistency across files. Do not persist messages, model text, full command arguments, or tool output by default; source data cannot trigger commands.

Explicit v3 snapshots use immutable generations, manifests, partitions, and checksums. Failure/cancellation never publishes partial snapshots. Narrow read-only v1/v2 compatibility retains original identity, cost policy, and missing semantics without deleting original files or recovery materials. Later live indexes and the on-demand service are partially delivered; the [live architecture proposal](../decisions/proposed/architecture/2026-09-30-live-usage.en.md) still owns the full target without changing explicit snapshot responsibilities.

Snapshot list/expansion p95 ≤300ms and cold query ≤1s are original targets, not measurements. Reports must state fixed fixtures, release build, cache state, process startup, I/O, serialization, rendering, and peak memory. Diagnose reading/projection bottlenecks before choosing indexes; local parsing speedups do not establish complete-chain improvement.

## Acceptance and delivery

| Category | Required verification |
|---|---|
| Source extension | Identity isolation, different cache semantics, no-turn capability, unknown providers, failure isolation; no source-specific public-query branches |
| Ledger | Independent A01–A12 truth, old/new formats, copies/inheritance, cumulative rollback, historical context, conflicts/unknowns; no ccusage comparison dependency |
| Scope and conservation | Timezones/DST, day/month/year/model/effort boundaries, archives and roots, unknown dates, unassigned measurements; complete ledger agrees with every aggregation layer |
| Costs | Exact/alias/provider matching, below/equal/above thresholds, cache categories, zero/unknown, policy isolation, tiny values, catalog upgrades, fixed old results |
| Queries | Full-range sorting before pagination, stable denominators, bidirectional links, fixed revisions, cancellation/busy/partial failures, corruption/missing details |
| Web | Chinese/English switching, long names, narrow layouts, filters, expansion, return, cancellation, and host shutdown |
| Safety and installation | Large lines, tails/truncation, allowlisted metadata without bodies, no arbitrary execution, clean builds/installs, executable permissions/notices, no source writes |

Select checks through the [development workflow](../development/workflow.en.md): build before cross-language tests, check generated contracts/module boundaries, update licenses with dependencies, and verify package contents/clean installation for releases. Web and noninteractive delivery together complete a capability; builds cannot replace browser acceptance. Only actual evidence enters [progress](progress.en.md); other platforms and real-user outcomes require separate acceptance.
