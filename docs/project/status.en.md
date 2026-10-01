# Wombat implementation status

[中文](status.md) | English

Updated 2026-10-01. This page tracks current delivery and unfinished boundaries. Requirements are in the [version-one specification](specification.en.md), dated verification is in [progress](progress.en.md), and feature semantics are in the [support matrix](../reference/support-matrix.en.md). Historical test passes do not establish full acceptance of the current working tree. The project has not been publicly released.

## Delivered baseline

| Area | Current delivery | Verification boundary |
|---|---|---|
| Sources and ledger | Independent Codex adapter, historical settings, deduplication, measurements and safe operations; heterogeneous source protocol tests | Codex is the only production source; not all historical formats are covered; [independent cases](../development/adapters.en.md) |
| Cost | Official standard API equivalent pricing, decimal breakdowns, explicit catalog updates, original policies retained in old snapshots | Not subscription payments; unknown models and conditions are not zero-filled; [pricing reference](../reference/pricing.en.md) |
| Fixed queries | Immutable v3 snapshots, shards and checksums, stable pagination and shares, narrow read-only v1/v2 compatibility | Synthetic failures, cancellation, conservation, and macOS installation verified; [snapshot decision](../decisions/implemented/architecture/2026-09-30-snapshot-storage.en.md) |
| Modules and contracts | core/client/ui/web/cli, generated types and validation, public package boundaries, injected client | Historical build and cross-module evidence exists; future GUI is not delivered |
| CLI / Web | Usage and conversations, drill-down, filters, themes, catalog, JSON queries | macOS arm64 / Node ≥26.4.0; browser and component coverage do not establish acceptance on other platforms |
| Automatic synchronization | Append cursors, SQLite transactions, on-demand service, fresh/cached/watch, fixed versions, automatic updates | Basic flow and memory optimization verified; the full [live proposal](../decisions/proposed/architecture/2026-09-30-live-usage.en.md) remains proposed |
| Bilingual support | Shared Chinese/English catalogs, CLI locale resolution, Web language button, paired docs and static checks | Source text and protocol values stay unchanged; no persisted language preference; [language contract](../i18n/product.en.md) |

## Remaining work and acceptance responsibility

| Item | Next acceptance requirement |
|---|---|
| Live scale and resources | Persistent MVCC, dependency-closure merging, database aggregation, million-measurement and 24-hour acceptance; the 500-file sample still exceeds the 256 MiB peak target |
| Platforms and sources | Windows/Linux, other architectures, and other production Agent adapters each need installation and factual truth verification; compilation alone does not establish support |
| Public release | Resolve the npm package name and publishing permissions; verify platform binaries, clean installation, licenses, and public materials; the package is still private |
| Product outcomes | Record real user tasks separately; test counts do not establish usability, savings, or user value |

Future candidates are in the [roadmap](roadmap.en.md). This page does not duplicate individual styling fixes, old test counts, or retired commands; historical evidence explains the corresponding builds.

## First Web Delivery · 2026-10-01

`ui/`, `web/`, and the HTTP client provide revised usage, conversation, turn, source, and price pages, started by the CLI. New grouping and matching-usage sorting use shared Rust contracts. Desktop still uses the selected Tauri 2; project registration, optimization rules, and other-platform browser verification remain pending. See [frontend scope](../../ui/README.en.md) and [verification](progress.en.md).
