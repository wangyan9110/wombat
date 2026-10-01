# Decision Note: Report distribution and full-range queries

[中文](2026-09-30-report-distribution.md) | English

Status: implemented

## Problem

Distribution bars, shares, and peaks must describe the entire filtered range. Aggregating the current page changes the scale during pagination. Row pagination can also split a period subtotal from its model rows. Report-linked threads must describe both selected-range and complete-thread usage without sorting whole threads by their selected fragments.

## Decision

The core calculates distribution metadata, token share, and costShare before pagination, shared by CLI/TUI. Cost shares use the complete range's priced subtotal; unknown costs are not zero and a zero denominator returns absence. Unpriced tokens count unknown-price components per measurement without counting reasoning tokens again; missing component facts return absence.

Explicit usage presentation distribution or details pages by period, with details retaining every model/effort row in selected periods. Omitting presentation retains row pagination for existing callers and candidate queries. Threads sort by threadUsage; matchedUsage describes only the selected fragment, and turns retain complete records. TUI owns metric, presentation, and navigation state and queries generated contracts without aggregating hidden pages.

## Alternatives considered

Aggregating the current page in TUI was considered, but cannot provide hidden-page maxima, tied peaks, or denominators, so metadata covers the entire range. Retaining row pagination for every query was also considered, but explicit details would split period groups. Optional presentation distinguishes pagination units while preserving existing queries.

## Impact and verification

This is an optional v3 field extension. Rust DTOs generate TS/Schema and validators, with no added dependencies. Synthetic queries verify unchanged scales and shares across pages, complete detail groups, unpriced components, and full-thread links. See [progress](../../../project/progress.en.md) for bilingual native rendering and actual terminal verification, and [contracts](../../../development/contracts.en.md) for field semantics.
