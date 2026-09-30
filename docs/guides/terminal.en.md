# Using the terminal

[中文](terminal.md) | English

Run `wombat` in an interactive terminal with Node.js 26.4.0 or newer. The independent `tui/` module draws the interface with OpenTUI; the CLI supplies required FFI arguments automatically. First use builds a local Codex index; an existing index opens committed data before automatic synchronization. Main lists check for updates about once a second, preserving selection and scrolling. Editing filters, expanded costs, and drill-down retain the current view. R synchronizes and saves an immutable snapshot. An explicit `--snapshot` opens historical data without automatic refresh. Without a TTY, the default is a usage query.

Choose `--lang zh` or `--lang en` at startup; press L on the usage/conversation main screen to switch. Filters and prices inherit the language; original titles remain unchanged. See [product language](../i18n/product.en.md) for precedence and boundaries.

## Navigation and viewing

The home screen has only Usage / Conversations. Usage supports daily, weekly, and monthly reports: defaults are the last 7 days, this week plus the previous 3, and this month plus the previous 11, all through today. Changing reports adjusts automatic ranges; manual dates remain. F → Time → Follow report restores the automatic range. A date or model row opens related conversations. Conversations sort by consumption or recent activity. Enter expands turns in place, followed by records and categorized costs. Returning restores filters, pagination, selection, and expansion. Thread usage opens the conversation's complete range across days.

Primary actions appear below content and navigation keys in the footer. Arrows select, Enter opens or expands, Esc returns, Tab or 1 / 2 switches views, and Q quits. Enter on a usage row opens related conversations; V expands category costs in place. Ctrl+C cancels reads and exits without committing incomplete snapshots.

## Filters

F opens a native form on the same page. Usage shows time first; Custom reveals start/end dates and requires at least one. Model, effort, project, and timezone are under More filters. Conversations show search and project. Wide screens use two columns, narrow screens one. Tab / Shift+Tab changes fields; text is entered directly, while Enter expands time, project, model, and effort choices in place. Ctrl+S or Apply submits; Esc discards the draft. With a dropdown open, the first Esc only closes it and restores the previous value. Letters and digits in text fields remain input rather than main-screen shortcuts. Switching views discards unapplied filters. Project/model choices cover the whole snapshot source range, independent of the current page or selected dates. Identical names retain full project paths. Failed candidate reads show an error and retain manual input.

## Presentation and data boundaries

The interface uses the terminal's alternate screen, keeps header/footer fixed, and restores the terminal on exit. Date subtotals, model rows, and totals share right-aligned numeric columns. Scrolling retains the date for its model rows; selection does not move the list while still visible. At 40 columns rows wrap; 80 retains date, model, effort, tokens, and cost; 120 shows categories. Wider terminals center the 120-column content. Titles and tool names are sanitized text and never execute control sequences or commands.

Conversation details use the native title in the header. Turn consumption and share bars appear together. Expansion exposes Chronological / Most tokens; Enter on that control switches ordering. Model usage expands into token and cost categories; tool operations follow recorded facts. Repeated dates within a same-day turn are omitted; dates remain across days, and date-only records receive no invented time.

Dates use the selected timezone and presentation language, with years across year boundaries. Token retains its familiar spelling; Chinese uses 万/亿 and English uses compact K/M notation, while category details retain complete numbers. Cost follows usage; unknown amounts are labeled and partial amounts carry an asterisk. ? expands pricing basis and necessary data notes in the current footer. Arrows scroll the notes; ? or Esc collapses them without changing list selection.

OpenTUI migration acceptance continues. This page describes current interaction design and source behavior; see the [support matrix](../reference/support-matrix.en.md), [implementation status](../project/status.en.md), and [progress](../project/progress.en.md) for verified scope. Previews and PTY records from former renderers do not establish equivalent acceptance of the new interface. Terminal tests use synthetic data, not private conversations.

## Price catalog

Press U from usage or pricing basis to view the full local model catalog. Click controls or press S to switch standard/long-context tiers. Enter expands aliases, applicable thresholds, and official sources; arrows select models, N/P pages, and Esc returns. Wide screens use tables and narrow screens two-column price cards. Not separately priced is not zero; an unavailable long-context tier displays “—”. Official sources use native terminal links, whose click support depends on the terminal. U on the price page explicitly updates online; failure retains the current catalog. Returning to the main list automatically synchronizes new prices; R can save another snapshot, while old snapshots retain their amounts.

## Themes

Forest is the default. T cycles Forest, Light, and Graphite, retaining the choice during the session. Set a default with an environment variable:

```sh
WOMBAT_THEME=forest node dist/wombat.js
WOMBAT_THEME=paper node dist/wombat.js
WOMBAT_THEME=graphite node dist/wombat.js
```

`NO_COLOR=1` disables colors but retains selection arrows and structure. Independent semantic themes cover brand, headings, values, backgrounds, text, muted text, separators, accents, selection, subtotals, and details without changing data or layout. Invalid theme names fall back to Forest.

Developers can run `corepack pnpm --filter @wombat/tui test` after building the client. OpenTUI memory rendering and simulated input establish component regression coverage; visual comparison and real terminal interaction require separate acceptance.
