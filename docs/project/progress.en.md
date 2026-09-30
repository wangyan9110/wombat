# Wombat progress and verification records

[中文](progress.md) | English

This page retains useful delivery results, failures, and evidence boundaries. Repeated implementation descriptions have been consolidated and obsolete commands removed. See [implementation status](status.en.md) for current status and the [support matrix](../reference/support-matrix.en.md) and source for feature semantics. Results apply to the builds recorded at the time, not subsequent working trees. Evidence files may be updated by later runs; their internal hashes and fixtures identify the exact run.

## Release Skill and npm candidate · 2026-09-30

Added the project [wombat-release Skill](../../.agents/skills/wombat-release/SKILL.md) for release baselines, build gates, transferable bundles, npm candidates, authentication, public publishing, and post-publication installation checks. Root guidance and the development workflow link to it. Existing scripts are reused; the npm installation smoke now checks the no-cache error with usage --cached, while ordinary empty live queries may succeed.

Prepared @wangyan9110/wombat@0.3.0 from committed 9ad9d47 plus that packaging fix (macOS arm64 / Node ≥26.4.0). The full release gate, 202 product tests, 6 repository tests, and clean installs of both original and scoped packages passed. Final terminal evidence covers 20 PTY journeys, with every JS and core hash matching the candidate archive; see the [candidate manifest](../benchmarks/npm-candidate-2026-09-30.json). The initial PTY failure came from a non-executable node-pty spawn-helper; restoring its execute permission resolved it, and the prerequisite is recorded in the Skill. Concurrent automatic-pricing and later interface changes were excluded; no public publication occurred.

The Skill creator validator passed using temporary YAML validation dependencies. The new Skill and documentation entry points passed repo:check on the isolated baseline; a subsequent shared-workspace review also passed repository checks and git diff --check. Static checks do not replace behavioral verification of concurrent product changes.

## Documentation directory upgrade · 2026-09-30

13 existing pages moved into guides/reference/development/project and gained English counterparts. The specification drops its pre-migration file inventory, implementation status retains only current delivery and gaps, and progress consolidates repeated history and removes obsolete operating commands. Lasting accounting and snapshot tradeoffs became 2 bilingual implemented decisions; raw synthetic evidence remains. Entry points, directory rules, budgets, pairing manifests, and release documentation paths were updated together.

`corepack pnpm repo:check` passed: 29 document pairs, 0 legacy monolingual entries, 6 decisions, 3 Skills, 10 length budgets, module/copy boundaries, and 6 checker tests. Local links and `corepack pnpm public:check --package` passed; the release manifest includes both languages for guides and references. `git diff --check` passed. This documentation work did not rerun product builds, behavior tests, or installation acceptance, and did not commit, push, or release. Runtime and dependency changes from concurrent tasks were preserved.

## Development script migration · 2026-09-30

The three Python scripts under `scripts/` were migrated to TypeScript: fixed-snapshot query benchmarking, live-index benchmarking, and real PTY terminal journeys. Terminal emulation now uses pinned Node development dependencies; product runtime dependencies are unchanged. The default fixed-snapshot corpus of 500 conversations and 10,000 measurements passed with 20 query samples; the default live-index corpus of 100,000 measurements and 12 appends also passed. Both corpus hashes match the old script evidence, and all 19 real PTY journeys passed. Build, types and module boundaries, license generation and checks, repository checks, and public package checks passed. Performance numbers apply to this build with uncontrolled system caches; they do not establish a product speed improvement. Commands are in the [development workflow](../development/workflow.en.md).

## Localization and governance · 2026-09-30

Localization and the decision-directory migration were committed and pushed as `e460db15384e66329e1147f9070ec01f0965b753`. The release candidate isolated startup UI changes from other tasks. Build, type checking, client 11, CLI 8, integration 12, and end-to-end 12 tests passed. Of 84 TUI tests, 83 passed; one automatic-update case expected fresh but received cached. It also reproduced with the baseline application file and must not be reported as a fully passing suite.

[Release-candidate terminal evidence](../benchmarks/i18n-publish-terminal-2026-09-30.json) covers 19 PTY journeys; earlier [localization terminal evidence](../benchmarks/i18n-terminal-2026-09-30.json) also covers 19. Shared catalogs, locale precedence, and L switching were delivered. Source text stays unchanged, and language preference is not persisted. Static checks then covered 14 bilingual pairs with 13 legacy pages awaiting translation; those counts describe the pre-migration baseline.

Decisions moved from the Agent work structure into public `docs/decisions/`, with 4 active records at the time. Migration verification covered 6 checker tests and 325 local links; business tests were not rerun for a documentation-only move.

## Live synchronization and memory · 2026-09-30

The basic synchronization flow was delivered: append cursors, SQLite transactions, on-demand service, fresh/cached/watch, fixed versions, explicit snapshots, and TUI updates. Full resource and scale goals remain undelivered; see the [proposal](../decisions/proposed/architecture/2026-09-30-live-usage.en.md).

| Iteration | Actual result | Evidence and limits |
|---|---|---|
| Basic flow | 174 tests passed after build; 100 files / 10,000 measurements, initial 952ms, hot queries 91–117ms, append 131–169ms; peak RSS 176,996,352 bytes | [Synthetic benchmark](../benchmarks/live-usage-2026-09-30.json); 1,100,000 baseline tokens and 1,100 appended tokens; caches were not strictly controlled |
| Terminal automatic updates | 16 PTY journeys; 120,000→240,000 tokens updated in 1,076.37ms, fixed view stayed at 120,000 | [Built terminal](../benchmarks/live-usage-terminal-2026-09-30.json), [global terminal](../benchmarks/live-usage-global-terminal-2026-09-30.json) |
| Shared facts and compact indexes | 500 files / 100,000 measurements / 100,000 operations / 12 appends; core peak RSS 1,584,988,160→590,577,664 bytes (62.74% reduction); conversation query 1,934→387ms | [Memory benchmark](../benchmarks/live-memory-2026-09-30.json); median append 1,015→744ms, hot queries 356–374ms; initial 7.77→8.29s did not improve |
| Memory iteration regression | 185 passed after build (Rust 59 / client 11 / TUI 83 / CLI 8 / integration 12 / end-to-end 12); 16 built and 19 global PTY journeys | [Built terminal](../benchmarks/live-memory-terminal-2026-09-30.json), [global terminal](../benchmarks/live-memory-global-terminal-2026-09-30.json); about 0.6% CPU over 5 idle seconds, exit about 14.7 seconds after the last call |

Independent truth was 110 tokens / $0.000265 per measurement. Memory figures cover only the core, with caches not strictly controlled; they do not prove whole-machine or constant memory use. Real-source checks remain outside the repository: an initial run reached about 1.6 GiB, and one optimized run peaked around 700 MiB. The changing corpus prevents a comparable benchmark. The 256 MiB, persistent MVCC, database aggregation, million-measurement, and 24-hour goals remain unverified.

## Terminal and command iterations · 2026-09-30

The table consolidates repeated build descriptions while retaining features, test counts, and traceable evidence. The environment was macOS arm64 / Node 26.4.0. PTY verifies interaction paths and terminal restoration; native cell tests verify specified geometry/colors. Neither establishes full visual fidelity.

| Iteration | Verification | Evidence or boundary |
|---|---|---|
| Full model catalog | 158 tests; 14 PTY journeys each for built, isolated, and global installs; tables/cards, tiers, source expansion | [Built](../benchmarks/usage-v1-opentui-prices-view-built-2026-09-30.json), [isolated](../benchmarks/usage-v1-opentui-prices-view-installed-2026-09-30.json), [global](../benchmarks/usage-v1-opentui-prices-view-global-2026-09-30.json) |
| Daily/weekly/monthly defaults | 150 tests; 14 PTY journeys; 120,000 / 360,000 / 840,000 tokens | [Range evidence](../benchmarks/usage-v1-report-ranges-2026-09-30.json) |
| Summary, cost, and footer | 153 tests; 14 PTY journeys per entry; explanation limited to 55% of available height | [Built](../benchmarks/usage-v1-opentui-detail-layout-built-2026-09-30.json), [isolated](../benchmarks/usage-v1-opentui-detail-layout-installed-2026-09-30.json), [global](../benchmarks/usage-v1-opentui-detail-layout-global-2026-09-30.json) |
| Native filter candidates | 138 tests; 13 PTY journeys per entry; candidates still use full scope beyond 500 records | [Built](../benchmarks/usage-v1-opentui-filter-options-built-2026-09-30.json), [isolated](../benchmarks/usage-v1-opentui-filter-options-installed-2026-09-30.json), [global](../benchmarks/usage-v1-opentui-filter-options-global-2026-09-30.json); includes undated, unassigned, and failure fallback cases |
| Official catalog updates | 131 tests; 12 PTY journeys; new cost $0.435→$0.4125, old snapshot stayed $0.435 with tokens unchanged | [Catalog evidence](../benchmarks/usage-v1-official-prices-2026-09-30.json); 41 models parsed in one run, unknown models stayed unknown, webpage interfaces have no stability guarantee |
| Native filter form | 123 tests; 11 PTY journeys; drafts, cancellation, and text input | [Global terminal](../benchmarks/usage-v1-opentui-global-terminal-2026-09-30.json); this file was updated in later iterations |
| CLI black-box regression | 114 tests; 11 PTY journeys; 491,210 tokens / $1.7382; 18 error request categories, SIGINT 130, and child cleanup | [CLI terminal](../benchmarks/usage-v1-cli-selftest-terminal-2026-09-30.json); the old global install still had a pagination issue, and concurrent filter edits later failed type rechecking, so the results were not uniformly passing |
| Header/footer and geometry | Header iteration 109 tests; geometry iteration 102 tests; 11 PTY journeys each; 80/120/160-column coordinates and colorless selection | [Native preview inventory](../benchmarks/usage-v1-opentui-preview-images.json); the terminal controls font family/size, and early nine-color mappings did not cover child inheritance |
| Independent modules and OpenTUI | 97 tests; 11 PTY journeys each for built, isolated, and global installs; JS chunk and core hashes checked | [Built](../benchmarks/usage-v1-opentui-terminal-2026-09-30.json), [isolated](../benchmarks/usage-v1-opentui-installed-terminal-2026-09-30.json), [global](../benchmarks/usage-v1-opentui-global-terminal-2026-09-30.json) |
| Early renderer structure | TS 21 / integration 10 / end-to-end 4; 11 PTY journeys | [Structure evidence](../benchmarks/usage-v1-tui-code-parity-2026-09-30.json); 160-column centering only had unit coverage, and offline PNGs are not system terminal screenshots |
| Early themes and layout | TS 11 / integration 10 / end-to-end 4; 8 PTY journeys | [Theme evidence](../benchmarks/usage-v1-tui-fidelity-2026-09-30.json); old renderer evidence does not verify current OpenTUI |

Other local checks: 33 critical-width cases covered 68/80/110/120 columns and several heights; 28 vertical-layout/navigation cases covered 80×24, 120×32, and 160×40. Startup drafts were then blocked by type errors and did not produce new installation acceptance. The prototype conversion Skill first passed 2 Python synthetic extraction cases and nine-color mapping checks, then moved to standalone TypeScript tooling with 20 synthetic tests. Python Skill validation was previously not run because PyYAML was unavailable. These tools are not product runtime dependencies; private prototypes and extraction results remain outside the repository.

The Codex nested historical-settings fix preserved model, provider, and reasoning effort; the offline catalog revision then became `openai-standard-2026-09-30.2`. Rust 48 / TS 45 / integration 11 / end-to-end 4 tests passed. Measurements without public standard pricing or request-length evidence stayed unknown/partially priced. Real-source checks did not add private summaries to the repository.

## Version-one consolidation · 2026-09-30

The independent ledger, official decimal pricing, v3 sharded snapshots, two CLI/TUI entry areas, and read-only old-snapshot support were delivered. Old quota, checkup, repair, diagnostics, and HTML report flows were removed, together with ccusage, React/Vite, and old report assets. Lasting rationale is in the [independent accounting](../decisions/implemented/architecture/2026-09-30-independent-accounting.en.md) and [snapshot decisions](../decisions/implemented/architecture/2026-09-30-snapshot-storage.en.md).

- 67 passed after build: Rust 46, TS 7, integration 10, CLI end-to-end 4. Coverage included independent truth, identity/policy, inheritance and deduplication, time zones, undated facts, body allowlists, cancellation, failures, corruption, and publication limits. Build, types, contracts, and Rust fmt/clippy passed.
- 40×14, 80×24, and 120×32 PTY journeys and return from external old snapshots passed; see [initial terminal evidence](../benchmarks/usage-v1-terminal-2026-09-30.json).
- 500 conversations / 5,000 turns / 10,000 measurements conserved 11,000,000 tokens / $28.35 across layers and all pages. Measurements included startup, I/O, serialization, and 120-column rendering; file caches were not cleared. See the [query benchmark](../benchmarks/usage-v1-query-2026-09-30.json).
- An empty macOS arm64 directory installed a local tgz with production dependencies only, verifying entry points, permissions, non-TTY queries, unchanged original sources, and conservation of 120,000 tokens / $0.505. See [installation evidence](../benchmarks/usage-v1-install-2026-09-30.json). An empty Rust target also built offline with locked dependencies, without reusing old business assets.
- Licenses for 51 Node / 114 Rust packages, public materials, and package checks passed at the time. Those counts are not the current inventory. Supplemental license sources and hashes are maintained in the [dependency inventory](../dependency-licenses.json). This did not establish cross-platform compatibility or public release.

## Retired product history · 2026-09-28 through 2026-09-29

The old 0.3.0 preview included a ccusage closure, React reports, checkups, quotas, and repair. These were removed from current scope, and old English-diagnostics or repair tasks are no longer current delivery requirements. The following evidence remains for regression research; use the [current CLI guide](../guides/cli.en.md) for operation.

| Historical scope | Results and limits | Evidence |
|---|---|---|
| 2026-09-29 build and installation | 95 tests (Rust 22 / TS 25 / integration 24 / end-to-end 24); macOS arm64 | [Checkup installation](../benchmarks/checkup-install-2026-09-29.json), [package installation](../benchmarks/public-package-install-2026-09-29.json) |
| Old terminal paths | Chinese/English at 40/80/120 columns, cancellation, material review, and process cleanup | [Checkup](../benchmarks/checkup-review-terminal-2026-09-29.json), [analysis](../benchmarks/analysis-review-terminal-2026-09-29.json) |
| 2026-09-28 resource samples | Large-line integrity, fixed queries, and observation; local parsing does not prove faster full scanning | [Large lines](../benchmarks/large-line-2026-09-28.json), [queries](../benchmarks/layered-query-2026-09-28.json), [observation](../benchmarks/analysis-observation-2026-09-28.json) |
| 2026-09-29 repair prototype | 104 tests (22 / 27 / 24 / 31); version/fingerprint, ChangePlan, receipts, undo conflicts, cancellation cleanup; PTY exercised only planning and cancellation | [Repair terminal](../benchmarks/codex-repair-terminal-2026-09-29.json); manual local signing and account queries were not automatic product capabilities, and private materials were excluded |

Public materials contain no real conversations, tool bodies, or account data. Interpret historical evidence by its date, corpus, and hashes; user trials, current builds, and target platforms require their own acceptance.
