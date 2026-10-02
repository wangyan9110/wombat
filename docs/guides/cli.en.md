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

## Language

Choose presentation language with `--lang zh` or `--lang en`, or set `WOMBAT_LANG`. JSON fields and source content retain their original values. See [product language](../i18n/product.en.md) for precedence.

## Automatic synchronization

- Ordinary queries synchronize by default, waiting up to 2 seconds. Existing results are returned with `freshness`; without data, return `SYNC_PENDING`. Building a large initial index can take longer.
- `--fresh` waits up to 10 seconds for this synchronization and reports failure or timeout. `--cached` returns the committed index without scanning sources; it fails if no index exists.
- `usage --watch --json` emits one JSON object per line when the revision, date range, or status changes. Ctrl+C exits with 130. Ordinary `--json` still emits one object.
- `refresh --verify` rereads the full source before saving a snapshot, checking historical prefix edits that the append fast path cannot establish. Ordinary refresh uses incremental cursors.
- `--snapshot ID` fixes the read and disables automatic synchronization. A `live:…` identifier is a short-lived read revision; the service retains at most 8 revisions for 10 minutes. Expiration or restart can return `VIEW_EXPIRED`. For durable fixed data, run refresh and use its snapshot ID.
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
- `--snapshot ID` fixes a snapshot; a legacy v1/v2 file can be supplied explicitly. Continue pagination with the same snapshot instead of resolving latest again. An external legacy file returns its stable locator as snapshotRef.selector, which takes precedence over snapshotId for subsequent queries.
- `usage --presentation distribution|details`: defaults to details for category breakdowns; distribution returns only period subtotals. Explicitly setting this option pages by period: limit counts periods and details retain every model row in each selected period. Omitting it preserves row pagination. `--sort time|tokens|cost` orders by descending date or consumption. Complete-range distribution scales, peak scopes, unpriced tokens, and cost shares are computed before pagination; unknown costs sort after known costs.
- `--limit 1..500 --offset N`, default 50. Sorting, amounts, categories, and shares are computed over the full matching range before pagination.

## JSON

`outputVersion: 3`. Success includes action, snapshotRef, scope, availableRange, summary, items, page, and quality. Generated schemas validate runtime data; unknown arguments are rejected. Ordinary queries emit exactly one final JSON object on stdout, while watch emits NDJSON. Status goes to stderr. Live results also contain freshness; status distinguishes current, syncing, stale, failed, and fixed, and checkedAt is the last successful check. Current only means the observed log range has been processed.

Amounts are decimal strings; tokens are safe integers or null. `price.cost=null` means an incomplete amount; `knownCost` is the known subtotal, with priced, partial, and unknown statuses. Missing is not zero, and reportedCost is not added to the standard equivalent. Never sum amounts already rounded to two display decimals.

Tasks return matchedUsage and threadUsage. Turns cover the whole task by default while matchedUsage preserves incoming filters. Add --matched-only to turns to return only turns with matching measurements; --locate-turn ID locates its page, taking precedence over offset when found and otherwise using offset. Filtering turns does not change the full-task summary. Turn shares use the full task denominator; step shares use the full turn. Operations without exclusive accounting do not display a cost. `unassigned` holds records without a turn within the task.

Exit codes: 0 for success or an empty range; 2 for usable but incomplete reads or unconfirmed synchronization; 1 for errors; 130 for cancellation. Errors use `{outputVersion:3,error:{code,message}}`. Common codes include INVALID_ARGUMENT, NO_SNAPSHOT, SOURCE_UNREADABLE, SNAPSHOT_CORRUPT, UNSUPPORTED_VERSION, UPDATE_BUSY, CANCELLED, RESOURCE_LIMIT, and DETAIL_UNAVAILABLE. Partial results can still be queried using the returned fixed snapshot.

## Legacy migration

Usage and tasks in v1/v2 remain readable without writes. Missing turns and effort are not invented; legacy amounts retain their original policy. Refresh creates v3 without changing old files or recovery material. Former scan/report/checkup/quota/codex/observe/compare commands and their output protocols are retired. Commands without replacement capabilities have no placeholder entry.

## Local Web

Run `wombat web` and open the printed link. `--port 0` selects a port automatically by default; repeat `--root <directory>` to restrict sources, use `--lang zh/en` for the initial language, and `--json` for one startup JSON record. Ctrl+C stops the service; closing a tab does not exit the CLI.

Access is local only; restart requires a new link. Pages provide usage, tasks, turns, sources, and prices; date, model, effort, and directory filters are retained in the URL. Reloading reads a local version again; use Refresh data to recover an expired version. Existing business interfaces are connected over HTTP and source logs remain read-only; remote deployment is unsupported. See [architecture](../development/architecture.en.md).

New queries: `usage --presentation projects|models` groups by historical directory or model; `--project-unknown` selects missing directory evidence, `--agent` / `--source` limits sources, and `threads --locate-thread ID` returns the page containing a full ID. Task sorting uses matching usage/latest matching measurement; full-task usage remains separate.

## Read-only configuration

`wombat web --project-root /path/to/project` authorizes configuration folders and is repeatable; omission authorizes the launch directory. Historical task cwd values do not grant read access. `--root` still selects Codex sources separately from project configuration roots.

`wombat optimize inventory --json` provides equivalent non-TTY queries. Filter and sort with `--kind rule|skill|mcp`, `--observation used|loaded_only|unknown`, `--search`, and `--sort tokens|activity|size|name|content_tokens|characters|recent`. `--limit` defaults to50, maximum200; `--offset` starts at0. `--since` / `--until` include the start and exclude the end; `--timezone` defaults to UTC.

Details and evidence use `--action detail|evidence|related_scopes --item ID --read-view VERSION`; a new view can use `--snapshot live:…` to pin usage. Continued queries must keep the same source and project-root arguments; query the list again after expiry. `--thread ID` lists only configuration with evidence linked to that task. `--action capabilities` does not scan configuration. See `wombat optimize inventory --help` for all options.

Responses use configuration v1 JSON. Incomplete historical coverage currently returns exit code2 with usable results; argument/service errors return1 and cancellation130. File reads are not Skill calls; associated tokens are not exclusive configuration costs. Full-content tokens use a fixed reference method; static suggestions and manual rechecks are connected, while source changes remain closed. See the [configuration contract](../development/contracts.en.md) for scope and data semantics.

## Static suggestions and manual rechecks

Run `wombat optimize list --json` with the same `--root` / `--project-root` as configuration. Suggestions merge by object in repair/trim/organize/space categories; the latter two explicitly remain unavailable without adapters. Checks accept no usage dates/models, and static reminders do not establish configuration health.

```sh
wombat optimize list --project-root /path/to/project --json
wombat optimize detail --suggestion SUGGESTION_ID --read-view READ_VIEW --decision-revision REVISION --json
wombat optimize ignore --suggestion SUGGESTION_ID --read-view READ_VIEW --decision-revision REVISION --json
wombat optimize history --read-view READ_VIEW --json
wombat optimize restore --suggestion SUGGESTION_ID --read-view READ_VIEW --decision-revision REVISION --json
wombat optimize mark-edited --suggestion SUGGESTION_ID --read-view READ_VIEW --decision-revision REVISION --json
wombat optimize recheck --read-view READ_VIEW --decision-revision REVISION --json
wombat optimize capabilities --json
```

Retain original authorized roots and project/source scope, using the new decisionRevision returned by each action. Reload on version conflicts. detail/ignore/mark-edited/restore require suggestion identity. `--category`, `--offset` and `--limit 1..200` filter/page lists, default50. Editing happens outside the product; mark-edited only records pending recheck, and recheck recollects without writing sources. Configuration/review results independently use v1, exit2 for evidence gaps,1 for errors and130 for cancellation. Capabilities never scan. Product-data review records survive index rebuilds.

Adjust product reminders with `--agents-bytes 16384 --description-characters 500`, retaining the same flags in subsequent operations. Values apply to authorized current configuration and stay in records. The body5,000 reference line and description1,024 specification maximum are immutable; the Web reminder panel shares this contract. Full/body estimates are separate; see [specification](../project/config-upgrade.en.md).

The Web optimization list presents a suggestion, value and key metric. Details expand handling steps and basis, with record counts, turn tokens and estimated API cost visible together. Related record dates do not change current static checks; exact turns return to the original suggestion and filters. No association remains unknown; costs are not allocated by counts. CLI/Agent first obtain item.id/readView from optimize, then use inventory --action evidence --item ID --read-view VERSION with date/timezone flags; returned usageRevision/threadId/turnId locate turns. Keep authorized roots and avoid mixing read versions. Manual marking and rechecks expose before/after text measurements through reviewBaseline/item; unknown or mismatched methods are incomparable, and changes do not establish savings.
