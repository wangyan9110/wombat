# Support matrix

[中文](support-matrix.md) | English

Version one covers usage and conversations. Core and former CLI/TUI verification is recorded in [progress](../project/progress.en.md). CLI and local Web are the current entries; TUI has been removed; see [implementation status](../project/status.en.md). Historical terminal tests do not replace new-interface acceptance, and historical commands are not current support.

| Capability | Implemented scope | Boundaries |
|---|---|---|
| Sources | Active and archived Codex JSONL, isolated roots | Other agents have only a generic protocol and test adapter, no product integration |
| Usage | Daily / weekly / monthly; defaults of 30 days / 6 months / 12 months; distribution/details, token/estimated-cost views; timezone, model, effort, project, conversation filters | Includes current period through today; explicit CLI dates override, Web period changes retain dates; event timestamps determine dates, missing dates are not invented |
| Conversations | Across days and models; search, ordering, fixed-snapshot pagination | Titles come only from the native index, not generated question summaries |
| Turns | Whole-conversation totals, incoming matched usage, matching-turn filters and page location, token/cost share, other records | Missing associations are not guessed by time |
| Records | Time or consumption ordering; measurement categories and actual operations | Tool calls get no independently allocated tokens/cost; no body replay |
| Prices | Offline official-standard API conversion, decimal components, versions and basis; checked catalog models include GPT-5.3-Codex, GPT-5.4/5.5, GPT-5.6 Sol/Terra, GPT-6 Sol/Astra | `codex-auto-review` without published standard API rates and records without historical model evidence remain unknown; not subscription spending |
| Catalog updates | prices/status/update and full Web catalog; standard/long-context tiers, thresholds, aliases, source expansion; official standard-text/Codex download, validation, versioned persistence | Automatic checks for missing rates and explicit updates; 15-minute failure/24-hour success cooldown, with an offline opt-out; affects the next live revision/new snapshot, never reprices old snapshots; format changes rejected and unpublished prices remain unknown |
| Old snapshots | Read-only v1/v2 usage and conversations, original policy amounts | Missing turns/effort remain unavailable; no original-file overwrite |
| Local Web | CLI lifecycle, usage/conversations/turns, sources, prices, date/model/effort filters, light/dark themes; real progress and cancellation, overview updates, new-data notices while reading details, on-demand turn/trend pagination, empty-record guidance and expired-connection recovery | Loopback only; directory evidence is not project registration; optimization rules and Tauri host are not delivered |
| Live synchronization | Append cursors, SQLite transactions, single on-demand service, notifications/polling, automatic lists, fresh/cached/watch, full verification | Unix sockets / Windows named pipes share service logic; tested on macOS, Windows acceptance pending; exits after about 15 seconds idle without a valid configuration view; at most 8 short-term revisions for 10 minutes; persistent MVCC and million-record resource targets not delivered |
| Presentation language | `--lang zh/en`, `WOMBAT_LANG`, system language; main-screen `L` switching | [Language contract](../i18n/product.en.md); source content and JSON data are not translated; no preference file |
| Configuration analysis | Codex rule/Skill/MCP inventory, evidence, deduplicated associated turn usage, Web/CLI fixed views and bidirectional links | Explicitly authorized folders; no loading-precedence resolution, content-token estimates or historical content versions; no MCP execution or configuration writes; [contract](../development/contracts.en.md) |
| Automation | refresh / usage / threads / turns / steps, JSON v3; optimize inventory, JSON v1 | Works without TTY; former command protocol removed |
| Failures | Independent source rollback, retained old contributions while healthy sources advance; explicit partial status, restart recovery, snapshot hashes, refresh locks, cancellation | Multiple source log files are not an atomic snapshot |
| Read resources | Complete large lines, tail waiting; shared facts/basis, compact indexes, bounded per-version query caching, grouped aggregation, incremental corrections/retractions | Fixed fixtures of 100,000 measurements and 100,000 operations tested; reconciliation still retains all safe facts, not constant memory; million-record/long-running targets unverified |
| npm distribution | One package with macOS arm64/x64, Linux glibc arm64/x64, and Windows x64 cores; target selection; five-target CI and installation gates | Locally verified only on macOS arm64; other targets await hosted CI. Linux baseline is Ubuntu 24.04; musl/Windows ARM64 excluded. A candidate is not a published release |

See [adapter cases](../development/adapters.en.md) for source boundaries and independent acceptance cases, and [pricing](pricing.en.md) for price rules.

Not delivered: installation acceptance on other platforms, other production agent adapters, guaranteed coverage of all historical formats, model-quality/causal diagnostics, actual subscription invoices, desktop, permanent background monitoring, configuration writes/repair, HTML reports, and evidence-package export. New work must not reintroduce retired product entries.
