# Web frontend

[中文](README.md) | English

`@wombat/ui` is the React / TypeScript / Vite presentation module. `App` receives `UsageClient`; the browser entry wires HTTP and the access token. Rust supplies scanning, pricing, totals, grouping, and matching-usage sorting. Old TUI pages are not migrated.

## Running

Build and start from the repository root:

```sh
corepack pnpm build
node dist/wombat.js web --lang zh
```

Open the printed link; the page reads local records, and Ctrl+C stops the service. Use `--root` for sources and `--port` for a port. The service listens on loopback only; the token remains in the browser session, and a service restart requires a new link.

## Pages and implementation boundaries

| Page | Connected | Explicit boundary |
|---|---|---|
| Shell | Directory scope × Usage / Conversations / Optimize; light/dark themes, Chinese/English, narrow navigation | Historical directory evidence is not project registration; unknown attribution is not labeled no project |
| Usage | Tokens and cost together, cache hit rate, period trends, directory/model ranking, folded details and related conversations | Unknown is never zero; costs are standard API equivalents |
| Conversations | Title/directory/full-ID search, matching-usage/latest-match sorting, pagination and ID page location | Safe metadata is shown, not full conversation bodies |
| Turns | Full/matching usage, historical models and efforts, folded provenance, chronological events and match labels | Unassociated measurements remain separate; operation costs are never inferred |
| Sources | Actual source identity, directory, capabilities, coverage status and issues | No health claims or source configuration changes |
| Cost basis and prices | Historical pricing versions, category costs, official sources, standard/long-context tiers and real updates | The price page shows the current catalog; fixed snapshots are not repriced |
| Optimize | An unavailable state consistent with the shell | Rules, recommendations, configuration preview, application and recovery remain unimplemented |

React structures follow the reviewed HTML/CSS and rendering functions. The [stylesheet](src/reference.css) retains the original bytes; runtime layout adaptations are separate in `style.css`. Required visual assets and hashes appear in the [manifest](reference-manifest.json). Builds and tests do not depend on an external design repository or ship demo data and simulated configuration operations.

Intentional differences from the design sample: the sidebar shows actual directories and unknown attribution; sources use the reference dialog, with a direct-URL page also available; search queries run on submission; language switching replaces demo settings; Optimize shows real unavailability. Record counts, models, prices and content dimensions vary with actual data. Shared styles do not imply pixel equality for every dynamic state.

## State and queries

Dates include both endpoints and convert to an exclusive API end; changing day/week/month leaves dates unchanged. All input includes cache reads/writes, while reasoning is a subset of output; existing `tokens.input` retains its uncached meaning. Derived values and directory/model groups come from generated contracts, with equivalent CLI queries.

URLs retain scope, filters, search, sorting, pagination, conversation and turn selection for browser back/forward. Pagination pins a version; expiry triggers one complete reread with a notice. Failure/cancellation retains the last complete query result and disables further drill-down from it. Browser reload retains the URL and reads a version again; the browser stores the theme, not results or full conversations. Local event pagination stays inside the component and does not survive reload.

## Development and verification

Only public client interfaces and locale services are imported, without Node, Tauri, terminal or raw source access. A full build copies static assets into `dist/web/`; rebuild and restart after edits. The desktop host remains unimplemented; see [architecture](../docs/development/architecture.en.md).

`corepack pnpm --filter @wombat/ui test` covers URL round trips, date conversion and fixed-version transport. Integration/end-to-end tests cover cross-language truth and the main flow. See [progress](../docs/project/progress.en.md) for browser coverage and unverified platforms. Builds and static checks do not replace real interaction or pixel comparison.
