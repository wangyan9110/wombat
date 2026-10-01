# Using the terminal

[中文](terminal.md) | English

Run `wombat` in an interactive terminal with Node.js 26.4.0 or newer. The independent `tui/` module draws the interface with OpenTUI; the CLI supplies FFI arguments. First use builds a local Codex index. Opening Usage or Threads waits for the current read; main lists check for updates about once a second, preserving selection and scrolling. Filter drafts, expanded costs, and drill-down retain their current view. R synchronizes and saves an immutable snapshot; an explicit `--snapshot` opens historical data without automatic refresh. Without a TTY, the default is a usage query.

Choose `--lang zh` or `--lang en` at startup; L switches language on main screens and during reads. Filters and prices inherit the language, while original titles remain unchanged. See [product language](../i18n/product.en.md) for precedence and boundaries.

## Navigation and viewing

The home screen has only Usage / Threads. Usage defaults to period distribution: daily covers 30 calendar days, weekly the current month plus five preceding months, and monthly the current month plus eleven preceding months, all through today. Changing reports restores that grouping's default range while retaining model and project filters; F → Time selects presets or custom dates. Distribution bars use the maximum across the complete query range; shares use its total. Pagination does not change scales, shares, or peaks. Peaks link directly to related threads; unknown costs are not zero.

M or the metric button switches Tokens / Est. USD. V or the view button switches distribution / details. S or the order button switches recent dates / highest consumption. Details retain period subtotals, models, and reasoning effort; a period or model opens related threads. Threads sort by whole-thread consumption or recent activity. A report link shows both selected-range and whole-thread usage; A returns to all threads. Turns always include the complete thread, and cost shares use its complete priced amount. D opens the daily report over the thread's full recorded date range.

Arrows select, Enter opens or expands, N/P pages, B or Esc returns, Tab or 1/2 switches sections, and Q quits. Returning restores filters, pagination, selection, and expansion; each section retains independent main-view state. X or Esc cancels a read. Cancellation or read failure opens recovery without presenting an old result as current; Ctrl+C cancels and exits. The loading mark indicates activity only, and phase text follows real progress.

Arrows can select across pages in usage and conversation lists. Home/End scroll to the current page's beginning/end; End also reveals the range total. Resizing adjusts page capacity while retaining the selected record, without splitting a date's detail group. Clicking the current period preserves date filters; changing the metric or conversation/turn order retains selected identities and expanded records. Period and metric controls use complete character borders; tables share integer-cell tracks and native wrapping for long model names.

## Filters

F opens a native form on the same page. Usage shows time first: Follow report, Today, Last 30 days, Last 6 months, Last 12 months, This week, This month, and Custom. Custom reveals start/end dates and requires at least one; model, effort, project, and timezone are under More filters. Threads show search and project; applying them clears incoming report date, model, and effort conditions.

Wide screens use two columns, narrow screens one. Tab / Shift+Tab changes fields. Text is entered directly; Enter expands time, project, model, and effort choices in place. Ctrl+S or Apply submits; Esc discards drafts. With a dropdown open, the first Esc closes it and restores the previous value. Text-field keys do not trigger main-screen shortcuts; switching sections discards unapplied drafts. Project/model choices cover the complete snapshot source range, independent of the page or selected dates; identical names retain full paths. Failed candidate reads show an error and retain manual input.

Dropdown markers and focus borders identify the current field. With a dropdown closed and focus outside a text field, L changes language and T changes theme while retaining drafts. The price table also supports L; expanded model evidence is a separate reading area, so clicking its text does not collapse the model row.

## Presentation and data boundaries

The interface uses the alternate screen, fixes the header and keyboard hints, and restores the terminal on exit. Controls, table headers, records, totals, actions, and notes share one body scroll area; filter actions scroll with the form. Brand, version, and sections occupy the first row; title and range appear separately. Detail numbers align right. At 40 columns model and effort occupy their own row with long names wrapping, while dates stay complete. At 80 columns details retain date, model, effort, tokens, and cost; 120 columns show categories. Wider terminals center the 120-column content. Titles and tool names are sanitized text, never executable control sequences or commands.

Expanded turns show time/consumption controls and records. Measurements expand into categorized tokens and costs; operations receive no allocated fee and remain chronological in consumption order. Dates use the selected timezone and language, including years across year boundaries. Repeated dates within a same-day turn are omitted; date-only records receive no invented time. Chinese quantities use 万/亿, English uses compact K/M notation, and category details retain complete numbers.

Costs estimate standard API equivalent rates. Unknown amounts are labeled; partial amounts carry an asterisk. When pricing is partial, cost shares represent the priced subtotal. Cost view also lists unpriced tokens, leaving unconfirmed quantities unknown. Clicking Data notes / Price basis at the end of the body or pressing C expands the notes; arrows scroll the body, and clicking or Esc collapses them while preserving selection. ? opens the complete price catalog directly.

Memory rendering, color/geometry comparison, and actual PTY interaction establish separate evidence; see the [support matrix](../reference/support-matrix.en.md) and [progress](../project/progress.en.md). Terminal tests use synthetic data, not private conversations. A character grid cannot match browser pixels point for point.

## Price catalog

? or U opens the complete local catalog. Click controls or press S to switch standard/long-context tiers; Enter expands aliases, applicable thresholds, and official sources. Arrows select models, N/P pages, and Esc returns. Wide screens use tables, narrow screens two-column price cards. Not listed is not zero; an unavailable tier displays “—”. Pricing notes expands the estimate explanation. Official sources use native terminal links whose click support depends on the terminal. U on the price page explicitly updates online; failure retains the catalog. Returning to the main list automatically synchronizes new prices; R can save a snapshot, while old snapshots retain their amounts.

## Themes

Forest is the default. T cycles Forest, Midnight, Paper, and Amber, retaining the choice during the session. Set a default with an environment variable:

```sh
WOMBAT_THEME=forest node dist/wombat.js
WOMBAT_THEME=midnight node dist/wombat.js
WOMBAT_THEME=paper node dist/wombat.js
WOMBAT_THEME=amber node dist/wombat.js
```

The legacy `graphite` name maps to Midnight. `NO_COLOR=1` disables colors while retaining selection structure. Themes do not change data or layout; invalid names fall back to Forest.

Developers can run `corepack pnpm --filter @wombat/tui test` after building the client; use `corepack pnpm smoke:terminal` for actual terminal acceptance.
