# CLI and automation

[中文](cli.md) | English

Wombat synchronizes local Codex logs incrementally by default and updates queries incrementally. An explicit refresh also saves a fixed snapshot. Current functionality includes usage, tasks, configuration measurements and manual review queries. Every subcommand works without a TTY; JSON and Web use the same Rust queries.

```sh
wombat prices --json
wombat prices update --json
wombat refresh --root /path/to/codex-home --json
wombat usage --since 2026-09-23 --until 2026-09-30 --timezone Asia/Shanghai --json
wombat threads --sort tokens --json
wombat turns --thread THREAD_ID --sort tokens --json
wombat steps --thread THREAD_ID --turn TURN_ID --sort time --json
```

Repeat `--root` to include multiple roots. Without it, use CODEX_HOME or `~/.codex`. Both sessions and archived_sessions are read; the display range does not limit historical collection. Refresh rejects query filters.


`wombat web --open` asks the OS to open a browser after startup. If opening fails, the server stays available with the printed URL.

Hook inventory JSON exposes the same per-project native registration and plugin identity as Web detail; text output also names the plugin. Registration does not establish execution. See the [configuration contract](../development/contracts.en.md) for supported declaration forms and unknown states.

## Codex Skill

The following installs the experimental technical draft. Product design is revising the task workflows; local installation and behavioral acceptance have not been completed.

Build from source and install the local `$wombat` Skill:

```sh
corepack pnpm build
corepack pnpm skills:install
```

The default location is `~/.agents/skills/wombat`. It includes the current platform's CLI, kernel and Web assets; runtime requires Node22+. Installation tooling requires Node26.4.0+. Existing directories are preserved; update a managed installation with `corepack pnpm skills:install -- --replace`. Use `--skills-root /path/to/skills` for another directory; replace does not overwrite a custom same-name Skill.

In Codex, ask `$wombat show today's usage and locate the main consuming tasks` or `$wombat check this project's instructions and extensions`. The Skill connects queries by task; configuration writes require review of a concrete plan. The [product plan](../project/codex-skill.en.md) defines Web differences and boundaries. Codex normally discovers new Skills automatically; restart if it does not appear. Uninstall by removing only the installed wombat directory, retaining independent product data. This is local Skill installation, not a public plugin or MCP release.

## Language

Choose presentation language with `--lang zh` or `--lang en`, or set `WOMBAT_LANG`. JSON fields and source content retain their original values. See [product language](../i18n/product.en.md) for precedence.

## Automatic synchronization

- Ordinary queries synchronize by default, waiting up to 2 seconds. Existing results are returned with `freshness`; without data, return `SYNC_PENDING`. Building a large initial index can take longer.
- `--fresh` waits up to 10 seconds for this synchronization and reports failure or timeout. `--cached` returns the committed index without scanning sources; it fails if no index exists.
- `usage --watch --json` emits one JSON object per line when the revision, date range, or status changes. Ctrl+C exits with 130. Ordinary `--json` still emits one object.
- `refresh --verify` rereads the full source before saving a snapshot, checking historical prefix edits that the append fast path cannot establish. Ordinary refresh uses incremental cursors.
- `--snapshot ID` pins a current snapshot. Continue pagination with the same snapshotId instead of resolving latest again. Unknown formats are explicitly rejected.
- Live queries accept `--root`. Omitting it always selects the default Codex source; another window's roots do not change this. Fixed snapshots cannot also specify source roots.

One data directory shares an on-demand Rust service. File notifications supplement polling roughly every 2 seconds; CLI watch queries roughly every second. Without a valid configuration view, the service exits about 15 seconds after its last call; configuration views last at most 10 minutes. Live operation has been accepted on macOS; Windows and Linux have not passed local installation acceptance. Accounting uses complete log records and cannot show tokens the model has not yet logged.

## Official price catalog

Live queries automatically check the official catalog when repairable missing rates are found. Failures retain results and expose `priceUpdate`. Downloads are throttled for 15 minutes after failure and 24 hours after success. Set `WOMBAT_AUTO_PRICES=0` to disable automatic networking; `--cached` and `--snapshot` never trigger it. Manual `prices update` bypasses the automatic retry interval.

`prices` (or `prices status`) reads the current full catalog offline. `prices update` explicitly downloads and validates a fixed official source. Its default output is a short result; `--json` returns `outputVersion:1`, action, origin, updated, source, sourceHash, catalogHash, and the complete catalog. Price responses and errors are versioned separately from usage v3. Errors use `{outputVersion:1,error:{code,message}}`, with exit code 1 or cancellation code 130. Common failures include PRICE_FETCH_FAILED, PRICE_SOURCE_CHANGED, PRICE_CACHE_INVALID, OUTPUT_LIMIT, TIMEOUT, and UPDATE_BUSY.

After a successful update, the next live synchronization creates a complete read revision using the new catalog. `refresh` can save another snapshot; old snapshots retain their amounts. Updates reject custom URLs, import paths, and usage filters. See [pricing](../reference/pricing.en.md#联网更新价表) for network scope, proxies, supported tables, and persistence.

## Filtering and pagination

- `usage --group day|week|month`: without dates, day selects the last 30 calendar days, week selects this month and the previous 5 months, and month selects this month and the previous 11. All end today; response until is tomorrow, exclusively. Explicit since/until takes precedence, and changing grouping preserves a manual range. A task filter without dates selects its full range. Weeks start on Monday; events are assigned by timestamp and selected timezone.
- `--since` is inclusive and `--until` exclusive. `--all-time` includes unknown dates and cannot accompany date bounds or --undated. CLI timezone defaults to UTC; Web uses the system timezone.
- `--model`, `--effort`, and `--project` match exactly. A project is observed directory evidence, not a path substring. `--model-unknown`, `--effort-unknown`, and `--undated` select missing model, effort, and date respectively, and cannot accompany corresponding explicit values or date ranges.
- `threads --search TEXT` searches titles or projects; its sorts are `tokens|cost|recent`, using matching usage or latest matching measurement. Turns and steps use `tokens|cost|time`.
- `--snapshot ID` pins a current snapshot. Continue pagination with the same snapshotId instead of resolving latest again. Unknown formats are explicitly rejected.
- `usage --presentation distribution|details`: defaults to details for category breakdowns; distribution returns only period subtotals. Explicitly setting this option pages by period: limit counts periods and details retain every model row in each selected period. Omitting it preserves row pagination. `--sort time|tokens|cost` orders by descending date or consumption. Complete-range distribution scales, peak scopes, unpriced tokens, and cost shares are computed before pagination; unknown costs sort after known costs.
- `--limit 1..500 --offset N`, default 50. Sorting, amounts, categories, and shares are computed over the full matching range before pagination.

## JSON

`outputVersion: 3`. Success includes action, snapshotRef, scope, availableRange, summary, items, page, and quality. Generated schemas validate runtime data; unknown arguments are rejected. Ordinary queries emit exactly one final JSON object on stdout, while watch emits NDJSON. Status goes to stderr. Live results also contain freshness; status distinguishes current, syncing, stale, failed, and fixed, and checkedAt is the last successful check. Current only means the observed log range has been processed.

Amounts are decimal strings; tokens are safe integers or null. `price.cost=null` means an incomplete amount; `knownCost` is the known subtotal, with priced, partial, and unknown statuses. Missing is not zero, and reportedCost is not added to the standard equivalent. Never sum amounts already rounded to two display decimals.

Tasks return matchedUsage and threadUsage. Turns cover the whole task by default while matchedUsage preserves incoming filters. Add --matched-only to turns to return only turns with matching measurements; --locate-turn ID locates its page, taking precedence over offset when found and otherwise using offset. Filtering turns does not change the full-task summary. Turn shares use the full task denominator; step shares use the full turn. Operations without exclusive accounting do not display a cost. `unassigned` holds records without a turn within the task.

Exit codes: 0 for success or an empty range; 2 for usable but incomplete reads or unconfirmed synchronization; 1 for errors; 130 for cancellation. Errors use `{outputVersion:3,error:{code,message}}`. Common codes include INVALID_ARGUMENT, NO_SNAPSHOT, SOURCE_UNREADABLE, SNAPSHOT_CORRUPT, UNSUPPORTED_VERSION, UPDATE_BUSY, CANCELLED, RESOURCE_LIMIT, and DETAIL_UNAVAILABLE. Partial results can still be queried using the returned fixed snapshot.

## Current formats

Only current v3 snapshots are readable. Unknown versions are rejected while existing files and user records remain intact. No migration or old-command/output compatibility is provided. Retired scan/report/checkup/quota/codex/observe/compare commands have no placeholder entries.

## Local Web

Run `wombat web` and open the printed link. `--port 0` selects a port automatically by default; repeat `--root <directory>` to restrict sources, use `--lang zh/en` for the initial language, and `--json` for one startup JSON record. Ctrl+C stops the service; closing a tab does not exit the CLI.

Access is local only; restart requires a new link. Pages provide usage, tasks, turns, sources, and prices; date, model, effort, and directory filters are retained in the URL. Reloading reads a local version again; use Refresh data to recover an expired version. Existing business interfaces are connected over HTTP and source logs remain read-only; remote deployment is unsupported. See [architecture](../development/architecture.en.md).

New queries: `usage --presentation projects|models` groups by historical directory or model; `--project-unknown` selects missing directory evidence, `--agent` / `--source` limits sources, and `threads --locate-thread ID` returns the page containing a full ID. Task sorting uses matching usage/latest matching measurement; full-task usage remains separate.

## Read-only configuration

`wombat web --project-root /path/to/project` adds a configuration folder absent from history and is repeatable; omission retains the launch directory. Local Web automatically adds reliable historical cwd values from current sources to its project catalog; direct CLI configuration queries still use `--project-root` for explicit scope. `--root` continues to select Codex sources separately from project configuration roots.

`wombat optimize inventory --json` provides equivalent non-TTY queries. Filter and sort with `--kind rule|skill|mcp`, `--observation used|loaded_only|unknown`, `--search`, and `--sort tokens|activity|size|name|content_tokens|characters|recent`. `--limit` defaults to50, maximum200; `--offset` starts at0. `--since` / `--until` include the start and exclude the end; `--timezone` defaults to UTC.

Details and evidence use `--action detail|evidence|related_scopes --item ID --read-view VERSION`; a new view can use `--snapshot live:…` to pin usage. Continued queries must keep the same source and project-root arguments; query the list again after expiry. `--thread ID` lists only configuration with evidence linked to that task. `--action capabilities` does not scan configuration. See `wombat optimize inventory --help` for all options.

Responses use configuration v1 JSON. Incomplete historical coverage currently returns exit code2 with usable results; argument/service errors return1 and cancellation130. File reads are not Skill calls; associated tokens are not exclusive configuration costs. Full-content tokens use a fixed reference method; static suggestions and manual rechecks are connected, while source changes remain closed. See the [configuration contract](../development/contracts.en.md) for scope and data semantics.

## Static suggestions and manual rechecks

Run `wombat optimize list --json` with the same `--root` / `--project-root` as configuration. Suggestions merge by object in repair/trim/organize/space categories; the latter two explicitly remain unavailable without adapters. Checks accept no usage dates/models, and static reminders do not establish configuration health.

```sh
wombat optimize list --project-root /path/to/project --json
wombat optimize detail --suggestion SUGGESTION_ID --read-view READ_VIEW --decision-revision REVISION --json
wombat optimize keep --reason necessary --suggestion SUGGESTION_ID --read-view READ_VIEW --decision-revision REVISION --json
wombat optimize history --read-view READ_VIEW --json
wombat optimize redisplay --suggestion SUGGESTION_ID --read-view READ_VIEW --decision-revision REVISION --json
wombat optimize not-applicable --reason incorrect_evidence --suggestion SUGGESTION_ID --read-view READ_VIEW --decision-revision REVISION --json
wombat optimize recheck --read-view READ_VIEW --decision-revision REVISION --json
wombat optimize capabilities --json
```

Retain original roots and project/source scope, using the returned decisionRevision after each operation. Reload on conflicts. detail/keep/not-applicable/redisplay require suggestion identity; keep/not-applicable also require a reason. Lists support category, offset and limit 1..200 (default 50). Edit outside Wombat, then recheck directly; --suggestion optionally limits rechecks to one problem. Rechecks do not write sources or revoke decisions; redisplay does not restore files. Configuration/review results use v1, exit 2 for evidence gaps, 1 for errors and 130 for cancellation. Capabilities do not scan. Index rebuilds retain product-data records.

Adjust product reminders with `--agents-bytes 16384 --description-characters 500`, retaining the same flags in subsequent operations. Values apply to authorized current configuration and stay in records. The body5,000 reference line and description1,024 specification maximum are immutable; the Web reminder panel shares this contract. Full/body estimates are separate; see [specification](../project/config-upgrade.en.md).

The Web optimization list presents a suggestion, value and key metric. Details expand handling steps and basis, with record counts, turn tokens and estimated API cost visible together. Related record dates do not change current static checks; exact turns return to the original suggestion and filters. No association remains unknown; costs are not allocated by counts. CLI/Agent first obtain item.id/readView from optimize, then use inventory --action evidence --item ID --read-view VERSION with date/timezone flags; returned usageRevision/threadId/turnId locate turns. Keep authorized roots and avoid mixing read versions. Explicit rechecks expose before/after text measurements through reviewBaseline/item; unknown or mismatched methods are incomparable, and changes do not establish savings.

## Local Codex handoff and account

A runnable local Codex is required; the native interface is verified on0.160.0. Codex owns sign-in, model review, execution and restoration. CLI and Web share the same selection; sign-in credentials are not copied.

```sh
wombat optimize handoff preview --project-root /path/to/project --json
wombat optimize handoff send --project-root /path/to/project --selection-version SELECTION_VERSION --read-view READ_VIEW --decision-revision REVISION --json
wombat account read --json
wombat account refresh --json
```

Review project working directories, files and evidence in preview, then send using its selectionVersion; retain the same source, project grants and filters. Omitting `--suggestion` selects all pending items independently of list pagination or category; repeat the flag for a single item/subset. Shared files appear once and same-file rules merge; changing projects requires a new confirmation. Changes to files/evidence before sending are explicitly rejected.

Delivery returns accepted, failed or unknown and an available Codex task ID; accepted establishes request acceptance only. Inspect with `codex resume TASK_ID`. After disconnection inspect Codex before deciding to resend; resending is manual, without execution receipts or historical lookup. Repeated manual sends may create new tasks; closing Wombat does not cancel accepted tasks. Use `optimize recheck` after handling to determine whether a problem remains.

The confirmation dialog can refresh allowance while retaining file selection. Low allowance only warns; a reliable native restriction on the current task prevents sending and requires another confirmation after refresh. Expired, unknown or other-model restrictions do not establish exhaustion for this task or trigger automatic retries. Sending checks the actual task again; a final restriction may leave an empty Codex task with no queued request.

The account v1 response has independent identity, allowance and activity status/read times, with masked email only. Actual window names, models, periods and resets come from Codex, without fixed five-hour/seven-day periods or legacy single-bucket fallback. Failures retain previous data/read times; account changes clear old facts. A past reset does not establish restored allowance. Balances and spending limits retain native decimal strings without guessing units. Reset credits are read-only; missing details and an empty list differ, and the 128-row detail limit never replaces the native count. Overview and account details share observations independently of project/date scope. Allowances are not added to or converted from project tokens/API estimates. Partial reads or unconfirmed delivery exit2, errors1 and cancellation130. `turns --sort recent` orders by reliable activity times, with unknown times last.
