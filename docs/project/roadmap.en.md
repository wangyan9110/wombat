# Wombat roadmap

[中文](roadmap.md) | English

This page lists future directions without release-date commitments. Independent Codex accounting, official pricing, both views, and current-format snapshots form the baseline. See the [version-one specification](specification.en.md) for requirements, [implementation status](status.en.md) for delivery and gaps, and [progress](progress.en.md) for evidence.

1. Improve user-facing presentation, contextual help and detection evidence under the [interface and configuration upgrade specification](config-upgrade.en.md), then complete A5 scale/platform acceptance, B3 effective Hook registry adaptation and incremental block caching under the [startup and rule upgrade specification](startup-rules.en.md), retaining evidence gates for actual injection and execution.
2. Deliver the remaining [automatic-update proposal](../decisions/proposed/architecture/2026-09-30-live-usage.en.md): persistent MVCC, dependency-local reconciliation, database aggregation, million-record performance, and 24-hour acceptance. Append cursors, SQLite transactions, the on-demand service, and automatic queries are already connected; the whole proposal cannot be marked complete.
3. Continue checking source versions, correctness, and end-to-end resource use with fixed fixtures. Record real user tasks separately and confirm performance targets through measurement.
4. Resolve the npm name, permissions, and target platforms for public release, then verify clean installation, licenses, and public materials per platform.
5. Add another Agent or desktop host when real requirements justify it; reuse the shared adapter protocol and narrow client before extending product entry points.
6. Evaluate a narrow extension under [Codex task timing research and technical design](../decisions/proposed/architecture/2026-10-04-codex-task-timing.en.md): native timing, overlap, and context evidence first, with explicit gaps. Unimplemented; it neither restores legacy diagnostic/compare semantics nor promises causal conclusions.

Chinese and English CLI/Web are delivered; source text and unknown core diagnostics retain their original language. Accounts and local Codex handoff are added under the [lifecycle specification](optimization-lifecycle.en.md). Historical environment management, diagnostics, automatic application/restoration and reports do not establish current support or a commitment to restore them.

## Current Migration Sequence

CLI+Web is implemented on shared Rust contracts, and TUI product code has been removed. Continue the shared frontend and selected Tauri 2 host against the revised product specification.
