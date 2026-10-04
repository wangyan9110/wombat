# Wombat implementation status

[中文](status.md) | English

Updated 2026-10-04. This page tracks current delivery and unfinished boundaries. Requirements are in the [version-one specification](specification.en.md), dated verification is in [progress](progress.en.md), and feature semantics are in the [support matrix](../reference/support-matrix.en.md). Historical test passes do not establish full acceptance of the current working tree. The project is entering the `v0.1.0-dev.1` Development Preview; public installability depends on the GitHub Pre-release and the five-platform release workflow.

## Five surfaces and the full optimization lifecycle · Stage acceptance failed

Every work package in the [current specification](optimization-lifecycle.en.md) remains in the confirmed scope. On 2026-10-04 the user requested an end to implementation and handover for product acceptance. Product review permits a bounded local macOS trial but fails full acceptance: 10 of 48 scenarios satisfied, 12 unsatisfied and 26 insufficiently evidenced, plus three P2 product findings. The 32 passing product tests are focused tests, not a full regression. Twelve unsatisfied cases are not twelve new bugs; insufficient evidence does not directly establish missing implementation or failure. Feedback has been checked and [archived](../benchmarks/2026-10-04-product-acceptance-feedback.json). The user subsequently explicitly requested development fixes. F01–F03 are implemented and passed focused local verification, pending product recheck. The earlier failed full-acceptance result and existing requirement gaps remain.

### Product findings register

These three findings are implemented, with [fix evidence](../benchmarks/2026-10-04-product-acceptance-fixes.json), pending product recheck. They remain separate from existing requirement gaps.

| ID | Priority and assessment | Independent correction requirement and location |
|---|---|---|
| F01 | P2, fixed, pending product recheck | A send failure must not use a read-failure heading. Use “未能发送给Codex” / “Could not send to Codex.” and recovery guidance when installation is unavailable. Preserve definite failure versus uncertain delivery; do not automatically resend uncertain requests. Located in `ui/src/optimize/Handoff.tsx`, `ui/src/Feedback.tsx` and shared messages. |
| F02 | P2, fixed, pending product recheck | Instructions should describe AGENTS.md only; Extensions should describe Skills/MCP/Hooks. Use “预估Token” / “Estimated tokens” for the extension column. Located in `ui/src/ConfigView.tsx`, `ui/src/Inventory.tsx`, `config.instructionsScopeNote` / `config.extensionsScopeNote` and `config.content_tokens`. |
| F03 | P2, refined, pending product recheck | The Tasks page adds a purpose line and current-filter summary. Rows prioritize title, directory, date, explicitly associated turn count, tokens/API estimate and related recommendations when evidence exists; details link to latest/all/highest-usage turns. Missing turn associations remain unknown, while full versions and hashes stay behind disclosure. Query, accounting and recommendation-association rules are unchanged. Full visual acceptance was not performed. |

### Existing requirement gaps register

These remain existing scope, not future candidates reassigned because of acceptance. Registration does not start implementation.

| ID | Gap and acceptance boundary |
|---|---|
| G01 | Complete Skill/Hook runtime and MCP prompts; the tool/resource-attempt and fork-replay subsets have focused verification. |
| G02 | Reliable acquisition and text/Token measurement of MCP definitions; unknown is correct degradation, not completed functionality. |
| G03 | The “Automatically added context” inventory entry and recorded counts; accept separately from actual duplicate-injection detection. |
| G04 | Actual same-request duplicate injection needs request, context, generation, historical content version and real position evidence. Exact blocks and replay deduplication cannot substitute. |
| G05 | Skill/MCP inactivity needs 30 days of continuous enablement, stable identity and complete coverage, including failed attempts. Current `inactivity:false`. |
| G06 | Worktree/temporary-file/cache candidates need 14-day observation, ownership, protection, running-task and recovery conditions. Current `spaceCleanup:false`. |
| G07 | Complete rapid-check rules need task conditions, overall sample/date thresholds, recent hits and modifiable locations. |
| G08 | Natural adoption, recurrence and optimization-usage reconciliation need reliable historical versions. Preserve existing no-record, version-unknown and unavailable states. |
| G09 | Windows Hooks, the five-platform release set and public release are unfinished. Full faults, cross-platform journeys, native-select keyboard and multiwidth journeys retain separate insufficient-evidence judgments. Tauri remains undelivered future desktop scope under the architecture convention, outside current Web/CLI fixes. |

Later user decisions removed historical send deduplication and execution receipts from the old acceptance table. Use the current lifecycle specification and do not restore those flows. Preserve verified behavior: no double-counting ledger subsets, no zero-filling unknown prices, exact-turn returns and no savings claims from text changes.

| Work package | Current source and evidence | Unfinished requirements |
|---|---|---|
| A Data and navigation | Five surfaces with separate filters; two-level Overview/task/related-instruction returns, operation pagination and reload position verified in both locales at four widths; independent check facts and user decisions; MCP tool/resource attempts and fork replay are integrated; continuous five-page cross-project journeys and date/model/effort boundaries have focused verification in both locales at four widths | Remaining fault/context journeys, Skill/Hook runtime and MCP prompt events and natural adoption |
| B Surface interactions | Instruction trees, extension inventory, help, suggestion details and direct rechecks exist; suggestion details now order the issue, visible location/evidence, action, related usage, collapsed methodology and history, with safe structural format diagnostics | Native select-menu keyboard operation, remaining Overview/Tasks fault journeys and full surface acceptance |
| C Rules and evidence | Static Unicode metadata, references, exact blocks and declared copies; independent outcomes; Hook declaration measurement and version-bound native registry observations for authorized projects, standalone/inline plugin JSON declarations, native-expanded paths and Unix static script references | Windows Hook commands, runtime injection, continuous inactivity, resource and rapid-check adapters |
| D Codex handoff | Single/all-pending batch selection, merged shared targets, per-project cwd and version checks; native 0.160.0 acceptance and task retention after disconnect; suppression only while sending; selection/failure/unknown-delivery, cancellation/closure and keyboard flows have focused acceptance in both locales at four widths | Other platforms remain unverified; no historical deduplication or execution receipts |
| E Rechecks and decisions | Keep/not-applicable decisions survive rechecks; original metadata and per-rule facts persist; target-based navigation, decision labels, redisplay and late cross-project responses have browser evidence; verified records derive natural associations as no observation, version unknown or unavailable | Confirmed adoption/runtime recurrence, complete fault/changed-instance journeys and optimization usage reconciliation |
| F Startup and accounts | Host selection/confirmation/persistent grants; independent account/allowance/summary reads, actual windows/native balances/spending limits/read-only reset credits, shared account-wide sidebar summary/dialog observations, one compact mobile entry, masked identity, section degradation and account-switch clearing; bounded initial task previews followed by completed usage; explicit model-restriction rechecks before sending and expiry to unknown | Full startup/cancellation/faults, real exhaustion, full browser acceptance of the account summary, other-platform acceptance and resource targets |

The missing local Codex native executable has been repaired using the desktop application's bundled 0.160.0 runtime and existing login. Earlier macOS arm64 generation/application/restoration tests belong to the superseded workflow and do not establish acceptance of the current Codex handoff. This does not complete the work packages above or establish verification on other operating systems.

Current work prioritizes functionality at the user’s request. Performance testing is paused; resource targets remain unverified.

## Delivered baseline

| Area | Current delivery | Verification boundary |
|---|---|---|
| Sources and ledger | Independent Codex adapter, historical settings, deduplication, measurements and safe operations; heterogeneous source protocol tests | Codex is the only production source; not all historical formats are covered; [independent cases](../development/adapters.en.md) |
| Cost | Official standard API equivalent pricing, decimal breakdowns, explicit catalog updates, original policies retained in old snapshots | Not subscription payments; unknown models and conditions are not zero-filled; [pricing reference](../reference/pricing.en.md) |
| Fixed queries | Immutable v3 snapshots, shards and checksums, stable pagination and shares, current formats only | Synthetic failures, cancellation, conservation, and macOS installation verified; [snapshot decision](../decisions/implemented/architecture/2026-09-30-snapshot-storage.en.md) |
| Modules and contracts | core/client/ui/web/cli, generated types and validation, public package boundaries, injected client | Historical build and cross-module evidence exists; future GUI is not delivered |
| CLI / Web | Usage and conversations, drill-down, filters, themes, catalog, JSON queries | macOS arm64 / Node ≥26.4.0; browser and component coverage do not establish acceptance on other platforms |
| Automatic synchronization | Append cursors, SQLite transactions, on-demand service, fresh/cached/watch, fixed versions, automatic updates | Basic flow and memory optimization verified; the full [live proposal](../decisions/proposed/architecture/2026-09-30-live-usage.en.md) remains proposed |
| Bilingual support | Shared Chinese/English catalogs, CLI locale resolution, Web language button, paired docs and static checks | Source text and protocol values stay unchanged; Web preferences persist locally; [language contract](../i18n/product.en.md) |

## Remaining work and acceptance responsibility

| Item | Next acceptance requirement |
|---|---|
| Startup and deterministic rules | A1–A4 and deterministic B0/B1/B2/B4 branches in the [specification](startup-rules.en.md) are implemented; A5 retains scale/platform and real-failure acceptance, B3 has Codex0.160.0 registry observations and a Unix static command subset; inline plugin declarations and native-expanded static paths are implemented, remaining dynamic expressions stay unknown, and Windows remains pending; Codex owns execution, while the full lifecycle, runtime observation and desktop remain undelivered |
| Live scale and resources | Persistent MVCC, dependency-closure merging, database aggregation, million-measurement and 24-hour acceptance; the 500-file sample still exceeds the 256 MiB peak target |
| Platforms and sources | Windows/Linux, other architectures, and other production Agent adapters each need installation and factual truth verification; compilation alone does not establish support |
| Public release | The `v0.1.0-dev.1` Development Preview is prepared; self-contained GitHub Release archives, one-command installation, and in-product updates are implemented; the macOS arm64 development candidate passed, while the free five-platform hosted release gate and first Pre-release are in progress; no stable release exists |
| Product outcomes | Record real user tasks separately; test counts do not establish usability, savings, or user value |

Future candidates are in the [roadmap](roadmap.en.md). This page does not duplicate individual styling fixes, old test counts, or retired commands; historical evidence explains the corresponding builds.

## First Web Delivery · 2026-10-01

`ui/`, `web/`, and the HTTP client provide revised usage, conversation, turn, source, and price pages, started by the CLI. New grouping and matching-usage sorting use shared Rust contracts. Desktop still uses the selected Tauri 2; project registration, actual execution, and other-platform browser verification remain pending. See [frontend scope](../../ui/README.en.md) and [verification](progress.en.md).

## Configuration measurement and manual reviews · 2026-10-02

Overview, Tasks, Configuration and Optimize now connect shared usage details, all dates, full-content token/code-point/byte measurements, static Skill checks, object suggestions and the complete manual-review flow. Decisions persist independently, and language preferences survive service restarts. Web/CLI use the same generated contracts. See the [upgrade specification](config-upgrade.en.md) and [configuration contract](../development/contracts.en.md).

That delivery did not include continuous-coverage inactivity, MCP faults, storage adapters, source execution or recovery. Current handoff and authorization boundaries are listed above; the full scope remains in progress. Loading precedence, explicit Skill/Hook invocation and MCP prompt adapters, historical content, persistent composite views, incremental evidence indexes, cooperative cancellation and Tauri remain undelivered. Browser and performance evidence is in [progress](progress.en.md).
