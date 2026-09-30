# Wombat roadmap

[中文](roadmap.md) | English

This page lists future directions without release-date commitments. Independent Codex accounting, official pricing, both views, and read-only old snapshots form the baseline. See the [version-one specification](specification.en.md) for requirements, [implementation status](status.en.md) for delivery and gaps, and [progress](progress.en.md) for evidence.

1. Complete acceptance of current OpenTUI startup, synchronization, failure, and return after cancellation, plus full-page visuals, narrow terminals, and resizing.
2. Deliver the remaining [automatic-update proposal](../decisions/proposed/architecture/2026-09-30-live-usage.en.md): persistent MVCC, dependency-local reconciliation, database aggregation, million-record performance, and 24-hour acceptance. Append cursors, SQLite transactions, the on-demand service, and automatic queries are already connected; the whole proposal cannot be marked complete.
3. Continue checking source versions, correctness, and end-to-end resource use with fixed fixtures. Record real user tasks separately and confirm performance targets through measurement.
4. Resolve the npm name, permissions, and target platforms for public release, then verify clean installation, licenses, and public materials per platform.
5. Add another Agent or desktop host when real requirements justify it; reuse the shared adapter protocol and narrow client before extending product entry points.

Chinese and English CLI/TUI are delivered; source text and unknown core diagnostics retain their original language. Former environment management, quota, diagnostics, repair, observation, and reports are outside version one. Historical implementations do not establish current support or a commitment to restore them.
