# Support matrix

[中文](support-matrix.md) | English

Version one covers usage and conversations. Core and former CLI/TUI verification is recorded in [progress](../project/progress.en.md). Root modules and OpenTUI migration are undergoing complete-chain acceptance; see [implementation status](../project/status.en.md). Historical terminal tests do not replace new-interface acceptance, and historical commands are not current support.

| Capability | Implemented scope | Boundaries |
|---|---|---|
| Sources | Active and archived Codex JSONL, isolated roots | Other agents have only a generic protocol and test adapter, no product integration |
| Usage | Daily / weekly / monthly; defaults of 7 days / 4 weeks / 12 months; timezone, model, effort, project, conversation filters | Includes current period through today; manual dates override; event timestamps determine dates, missing dates are not invented |
| Conversations | Across days and models; search, ordering, fixed-snapshot pagination | Titles come only from the native index, not generated question summaries |
| Turns | Whole-conversation totals, incoming matched usage, token share, other records | Missing associations are not guessed by time |
| Records | Time or consumption ordering; measurement categories and actual operations | Tool calls get no independently allocated tokens/cost; no body replay |
| Prices | Offline official-standard API conversion, decimal components, versions and basis; checked catalog models include GPT-5.3-Codex, GPT-5.4/5.5, GPT-5.6 Sol/Terra, GPT-6 Sol/Astra | `codex-auto-review` without published standard API rates and records without historical model evidence remain unknown; not subscription spending |
| Catalog updates | prices/status/update and full terminal catalog; standard/long-context tiers, thresholds, aliases, source expansion; official standard-text/Codex download, validation, versioned persistence | Explicit network use; affects the next live revision/new snapshot, never reprices old snapshots; format changes rejected and unpublished prices remain unknown |
| Old snapshots | Read-only v1/v2 usage and conversations, original policy amounts | Missing turns/effort remain unavailable; no original-file overwrite |
| Terminal | Independent OpenTUI module, Chinese/English views, filters, expanded turns/costs, footer notes, three themes; Node.js 26.4.0+ | Migration acceptance ongoing: 40 / 80 / 120 columns, centering on wider screens, input, resizing, and exit need current-chain evidence; first accepted on macOS Apple Silicon; core diagnostics may retain original language; no GUI/Web |
| Live synchronization | Append cursors, SQLite transactions, single on-demand service, notifications/polling, automatic lists, fresh/cached/watch, full verification | Tested on macOS; exits after about 15 seconds idle; at most 8 short-term revisions for 10 minutes; persistent MVCC and million-record resource targets not delivered |
| Presentation language | `--lang zh/en`, `WOMBAT_LANG`, system language; main-screen `L` switching | [Language contract](../i18n/product.en.md); source content and JSON data are not translated; no preference file |
| Automation | refresh / usage / threads / turns / steps, JSON v3 | Works without TTY; former command protocol removed |
| Failures | Source isolation, explicit partial status, snapshot hashes, refresh locks, cancellation | Multiple source log files are not an atomic snapshot |
| Read resources | Complete large lines, tail waiting; shared facts/basis, compact indexes, grouped aggregation, incremental corrections/retractions | Fixed fixtures of 100,000 measurements and 100,000 operations tested; reconciliation still retains all safe facts, not constant memory; million-record/long-running targets unverified |

See [adapter cases](../development/adapters.en.md) for source boundaries and independent acceptance cases, and [pricing](pricing.en.md) for price rules.

Not delivered: installation acceptance on other platforms, other production agent adapters, guaranteed coverage of all historical formats, model-quality/causal diagnostics, actual subscription invoices, desktop, permanent background monitoring, configuration writes/repair, HTML reports, and evidence-package export. New work must not reintroduce retired product entries.
