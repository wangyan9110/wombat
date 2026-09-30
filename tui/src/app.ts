import { t, locale } from '@wombat/client/locale';
import { browsePrices } from './state/prices.js';
import { OperationCancelled, type LoadingSpec } from './components/loading-model.js';
import { editTerminalFilters } from './state/filters.js';
import { loadFilterOptions, type FilterOptions } from './state/filter-options.js';
import { type Frame, type Choice, type RowPaint } from './components/view-model.js';
import { createTerminalUI, type TerminalUI } from './components/terminal-ui.js';
import { terminalText } from './display-text.js';
import { CoreError, type UsageClient, type UsageItem, type UsageRequest, type UsageResult, type UsageSummary } from '@wombat/client';
import { itemContent, usageLabel, rangeLabel, dateLabel, effort, activityRange, summaryMetrics, usageHeaderCells, usageTotalCells, categoryLabels, type ItemContent } from './screens/format.js';
interface Screen {
  request: UsageRequest;
  selected: number;
  viewportStart?: number;
  note?: { lines: string[] };
  expanded: Map<string, UsageResult>;
  details: Set<string>;
  stepSort?: Map<string, 'time' | 'tokens'>;
  thread?: Extract<UsageItem, {
    kind: 'thread';
  }>;
  result?: UsageResult;
}
function clearStepDetails(screen: Screen, turnId: string): void {
  for (const key of screen.details) if (key.startsWith(`step:${turnId}:`)) screen.details.delete(key);
}
function pageRequest(request: UsageRequest, forward: boolean, total: number): UsageRequest { const limit = request.limit ?? 50; return { ...request, offset: forward ? Math.min(Math.max(0, total - 1), (request.offset ?? 0) + limit) : Math.max(0, (request.offset ?? 0) - limit) }; }
function itemPaint(rows: string[]): RowPaint[] { return rows.map(() => ({ tone: 'muted' })); }
function clockStepContent(step: UsageItem, steps: UsageResult, turn: Extract<UsageItem, { kind: 'turn' }>, width: number): ItemContent {
  if (step.kind !== 'measurement' && step.kind !== 'operation') return itemContent(step, steps, width);
  const timezone = steps.scope.timezone ?? 'UTC';
  if (step.timePrecision !== 'date' && step.timePrecision !== 'unknown' && step.timestamp && turn.startedAt && turn.endedAt &&
    dateLabel(step.timestamp, steps.snapshotRef.createdAt, timezone) === dateLabel(turn.startedAt, steps.snapshotRef.createdAt, timezone) &&
    dateLabel(turn.endedAt, steps.snapshotRef.createdAt, timezone) === dateLabel(turn.startedAt, steps.snapshotRef.createdAt, timezone)) {
    const date = dateLabel(step.timestamp, steps.snapshotRef.createdAt, timezone);
    const time = dateLabel(step.timestamp, steps.snapshotRef.createdAt, timezone, true, step.timePrecision).slice(date.length + 1);
    return itemContent(step, steps, width, time);
  }
  return itemContent(step, steps, width);
}
function screenChoices(screen: Screen, width: number): Choice[] {
  const result = screen.result!;
  const choices: Choice[] = [];
  for (const [index, item] of result.items.entries()) {
    const id = `item:${index}`;
    const reportGroup = item.kind === 'usage' ? JSON.stringify([item.scope.since, item.scope.until, item.scope.undated]) : undefined;
    const content = itemContent(item, result, width);
    if (item.kind === 'turn' && content.headline)
      content.headline.label = `${screen.expanded.has(item.id) ? '⌄' : '›'} ${content.headline.label}`;
    if (item.kind === 'measurement' && content.headline)
      content.headline.label = `${screen.details.has(id) ? '⌄' : '›'} ${content.headline.label}`;
    choices.push({ id, ...content, paint: itemPaint(content.lines), reportGroup, turnGroup: item.kind === 'turn' ? item.id : undefined,
      expanded: screen.details.has(id),
      kind: item.kind === 'usage' ? item.isSubtotal ? 'subtotal' : 'model' : item.kind,
      separatorAfter: item.kind === 'thread',
      gapAfter: item.kind === 'thread' || (item.kind === 'turn' && !screen.expanded.has(item.id)),
      group: item.kind === 'usage' && !item.isSubtotal ? rangeLabel(item.scope.since, item.scope.until, result.snapshotRef.createdAt, result.scope.timezone ?? 'UTC') : undefined });
    if (screen.details.has(id) && 'usage' in item)
      choices.push({ id: `detail:${index}`, kind: 'detail', depth: 1, reportGroup, turnGroup: item.kind === 'turn' ? item.id : undefined, lines: [], metrics: summaryMetrics(item.usage) });
    if (item.kind === 'usage' && (index === result.items.length - 1 || (result.items[index + 1].kind === 'usage' && (result.items[index + 1] as Extract<UsageItem, { kind: 'usage' }>).isSubtotal))) choices[choices.length - 1].separatorAfter = true;
    if (item.kind === 'turn' && screen.expanded.has(item.id)) {
      const steps = screen.expanded.get(item.id)!;
      const sort = screen.stepSort?.get(item.id) ?? 'time';
      choices.push({ id: `step-sort:${item.id}`, kind: 'control', depth: 1, turnGroup: item.id, lines: [], controls: [
        { id: `step-sort:time:${item.id}`, label: t("common.chronological"), active: sort === 'time' },
        { id: `step-sort:tokens:${item.id}`, label: t("common.most_tokens"), active: sort === 'tokens' },
      ] });
      for (const [stepIndex, step] of steps.items.entries()) {
        const key = `step:${item.id}:${stepIndex}`;
        const stepContent = clockStepContent(step, steps, item, width);
        if (step.kind === 'operation' && screen.stepSort?.get(item.id) === 'tokens' && (stepIndex === 0 || steps.items[stepIndex - 1].kind !== 'operation')) stepContent.lines.unshift(t("tui.app.operations_chronological"));
        if (step.kind === 'measurement' && stepContent.headline)
          stepContent.headline.label = `${screen.details.has(key) ? '⌄' : '›'} ${stepContent.headline.label}`;
        choices.push({ id: key, ...stepContent, turnGroup: item.id, recordStart: true, expanded: screen.details.has(key), kind: step.kind === 'operation' ? 'operation' : 'measurement', depth: 1, paint: itemPaint(stepContent.lines) });
        if (screen.details.has(key) && step.kind === 'measurement')
          choices.push({ id: `step-detail:${item.id}:${stepIndex}`, kind: 'detail', depth: 2, turnGroup: item.id, lines: [], metrics: summaryMetrics(step.usage) });
      }
      if (steps.page.offset > 0)
        choices.push({ id: `step-prev:${item.id}`, depth: 1, turnGroup: item.id, lines: [t("tui.app.previous_records")] });
      if (steps.page.offset + steps.items.length < steps.page.total)
        choices.push({ id: `step-next:${item.id}`, depth: 1, turnGroup: item.id, lines: [t("tui.app.next_records")] });
    }
  }
  if (result.page.offset > 0)
    choices.push({ id: 'previous', lines: [t("tui.app.previous_page")] });
  if (result.page.offset + result.items.length < result.page.total)
    choices.push({ id: 'next', lines: [t("tui.app.next_page")] });
  return choices;
}
function selectedSummary(screen: Screen, choice: string | undefined): UsageSummary {
  if (choice?.startsWith('step-detail:')) choice = 'step:' + choice.slice('step-detail:'.length);
  else if (choice?.startsWith('detail:')) choice = 'item:' + choice.slice('detail:'.length);
  const result = screen.result!;
  if (choice?.startsWith('item:')) {
    const item = result.items[Number(choice.slice(5))];
    if (item && 'usage' in item)
      return item.usage;
    if (item?.kind === 'thread')
      return item.matchedUsage;
  }
  if (choice?.startsWith('step:')) {
    const end = choice.lastIndexOf(':');
    const item = screen.expanded.get(choice.slice(5, end))?.items[Number(choice.slice(end + 1))];
    if (item?.kind === 'measurement')
      return item.usage;
  }
  return result.summary;
}
export function priceBasisLines(summary: UsageSummary): string[] {
  if (summary.measurementCount === 0) return [t("common.no_usage_records")];
  const price = summary.price;
  return [
    t("tui.app.amount_value", { p0: price.cost == null ? price.status === 'partial' ? '$' + price.knownCost + '*' : t("common.cost_unknown") : '$' + price.cost }),
    t("tui.app.price_revision_value", { p0: price.priceRevision }),
    ...price.components.map(component => `${categoryLabels[component.category] ?? component.category} · ${component.ratePerMillion == null ? t("tui.app.rate_unknown") : '$' + component.ratePerMillion + t("tui.app.million_tokens")} · ${component.cost == null ? component.status === 'partial' ? '$' + component.knownCost + '*' : t("common.cost_unknown") : '$' + component.cost}`),
    ...price.basis.flatMap(basis => [
      `${basis.originalModel} → ${basis.pricingModel} · ${{ standard: t("common.standard_prices"), longContext: t("common.long_context_prices"), conditionUnknown: t("tui.app.unknown_pricing_condition") }[basis.condition] ?? basis.condition}`,
      basis.source,
    ]),
  ];
}
export function screenFrame(screen: Screen, tab: number, notice = ''): Frame {
  const result = screen.result!;
  const scope = result.scope;
  const timezone = scope.timezone ?? 'UTC';
    const makeLayout = (width: number): Partial<Frame> => {
      width = Math.min(width, 120);
      const range = rangeLabel(scope.since, scope.until, result.snapshotRef.createdAt, timezone);
      const updated = t("common.updated_value", { p0: dateLabel(result.snapshotRef.createdAt, result.snapshotRef.createdAt, timezone, true, 'minute') });
      const intro = width < 68 ? [range] : [t("common.local_codex") + range + ' · ' + updated];
      if (scope.project || screen.request.search) intro.push([scope.project && scope.project.split('/').filter(Boolean).at(-1), screen.request.search && t("tui.app.search") + screen.request.search].filter(Boolean).join(' · '));
      if (scope.model || scope.reasoningEffort) intro.push([scope.model, scope.reasoningEffort && effort(scope.reasoningEffort)].filter(Boolean).join(' · '));
      const context: NonNullable<Frame['context']> = [];
      if (screen.thread && width >= 68) context.push({ text: (screen.thread.project?.split('/').filter(Boolean).at(-1) ?? t("common.unknown_project")) + ' · ' + activityRange(screen.thread.startedAt, screen.thread.lastActivityAt, result.snapshotRef.createdAt, timezone) });
      const isUsage = screen.request.action === 'usage';
      const currentControl = isUsage ? ({ day: t("common.daily"), week: t("common.weekly"), month: t("common.monthly") }[screen.request.group ?? 'day']) : screen.request.sort === 'recent' ? t("common.recent_activity") : screen.request.sort === 'time' ? t("common.chronological") : t("common.most_tokens");
      const options = isUsage ? [t("common.daily"), t("common.weekly"), t("common.monthly")] : [t("common.most_tokens"), screen.request.action === 'threads' ? t("common.recent_activity") : t("common.chronological")];
      if (!isUsage && screen.thread && width >= 68) {
        context.push({ text: usageLabel(result.summary, false, true), summary: true });
        context.push({ text: (screen.thread.models.join(' / ') || t("common.unknown_model")) + ' · ' + (screen.thread.reasoningEfforts.map(effort).join(' / ') || '—') });
        if (screen.thread.matchedUsage.measurementCount !== screen.thread.threadUsage.measurementCount) context.push({ text: t("tui.app.selected_range") + usageLabel(screen.thread.matchedUsage) });
      }
      const actions = isUsage ? t("tui.app.f_filter_r_refresh_g_period") : screen.thread ? t("tui.app.d_thread_usage_s_sort_t") : t("tui.app.f_filter_search_r_refresh_s");
      const footer = screen.note ? t("tui.app.read_notes_collapse_esc_back") : width < 68 ? t("tui.app.select_enter_expand_tab_switch_value", { p0: screen.thread ? t("tui.app.d_usage") : t("tui.app.f_filter"), p1: isUsage ? t("tui.app.g_period") : t("tui.app.s_sort") }) : t("tui.app.select_enter_value_esc_back_cost", { p0: isUsage || screen.request.action === 'threads' ? t("tui.app.view") : t("tui.app.expand") });
      const disclosure = screen.note?.lines;
      const choices = screenChoices(screen, width);
      return { intro, context, actions, disclosure, disclosureAction: disclosure ? { label: t("tui.app.u_view_all_prices"), id: 'prices' } : undefined, controlKind: isUsage ? 'group' : 'sort', controlOptions: options, activeControl: currentControl, choices, footer,
        tableCells: isUsage && result.items.length ? usageHeaderCells(width) : undefined,
        totalCells: isUsage && result.items.length ? usageTotalCells(result.summary, width) : undefined,
        status: notice || (result.freshness?.status === 'syncing' ? t("tui.app.syncing_showing_committed_data") : result.freshness?.status === 'failed' ? t("tui.app.sync_failed_keeping_previous_data") : result.freshness?.status === 'current' ? t("tui.app.updating_automatically") : undefined) || (result.quality.status === 'partial' ? t("tui.app.data_notes_view") : undefined),
        empty: [t("tui.app.no_records_in_this_range"), t("tui.app.r_refresh_f_change_dates")],
      };
    };
    const title = 'Wombat / ' + (screen.request.action === 'turns' && screen.thread ? screen.thread.title ?? t("common.threads") : screen.request.action === 'usage' ? ({ day: t("tui.app.daily_report"), week: t("tui.app.weekly_report"), month: t("tui.app.monthly_report") }[screen.request.group ?? 'day']) : t("common.threads"));
    const nav = t("tui.app.1_usage_2_threads");
    return { title, nav, activeTab: tab === 0 ? t("common.1_usage") : t("common.2_threads"), viewportStart: screen.viewportStart, intro: [], choices: [], footer: '', layout: makeLayout };
}
export async function startTerminalApp(initial: UsageRequest, client: UsageClient): Promise<number> {
  return runTerminalAppWithUI(initial, client, await createTerminalUI());
}
/** Internal controller entry: embedding/tests can supply a real OpenTUI renderer. */
export async function runTerminalAppWithUI(initial: UsageRequest, client: UsageClient, ui: TerminalUI): Promise<number> {
  let initialLiveRead = true;
  const queryUsage: UsageClient['query'] = async (request, options = {}) => {
    const combined = { ...options, signal: options.signal ? AbortSignal.any([ui.signal, options.signal]) : ui.signal };
    if (client.live && (!request.snapshotId || request.snapshotId.startsWith('live:'))) {
      if (initialLiveRead && !request.snapshotId && request.action !== 'refresh') {
        initialLiveRead = false;
        try { return (await client.live({ query: request, mode: 'cached' }, combined)).result; }
        catch (error) { if (!(error instanceof CoreError) || !['SYNC_PENDING', 'NO_SNAPSHOT'].includes(error.code)) throw error; }
        return (await client.live({ query: request, mode: 'fresh' }, combined)).result;
      }
      return (await client.live({ query: request }, combined)).result;
    }
    return client.query(request, combined);
  };
  const choose = ui.choose.bind(ui), input = ui.input.bind(ui);
  try { const code = await run(); return ui.signal.aborted ? ui.exitCode : code; }
  catch (error) { if (ui.signal.aborted) return ui.exitCode; throw error; }
  finally { ui.destroy(); }
  async function run(): Promise<number> {
  const initialScope = { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...initial.scope };
  const homes: Screen[] = [{ request: { ...initial, action: 'usage', scope: { ...initialScope } }, selected: 0, expanded: new Map(), details: new Set() }, { request: { action: 'threads', scope: { timezone: initialScope.timezone }, sort: 'tokens' }, selected: 0, expanded: new Map(), details: new Set() }];
  let tab = 0;
  let screen = homes[0];
  const stack: Screen[] = [];
  let snapshotId = initial.snapshotId;
  let notice = '';
  let lastCode = 0;
  let startupChecked = Boolean(initial.snapshotId);
  let openedAny = false;
  const filterCache = new Map<string, FilterOptions>();
  const refreshUsage = (kind: LoadingSpec['kind'] = 'refresh') => ui.task({ kind, activeTab: tab === 0 ? 'usage' : 'threads' }, options =>
    queryUsage({ action: 'refresh', roots: initial.roots ?? screen.result?.quality.sources.map(source => source.source.root) }, options));
  async function editFilters() {
    const selector = screen.result?.snapshotRef.selector ?? screen.result?.snapshotRef.snapshotId ?? snapshotId;
    const scope = screen.request.scope;
    const key = JSON.stringify([selector, screen.request.action, scope?.agentKind, scope?.sourceInstanceId, scope?.threadId]);
    let candidates = selector ? filterCache.get(key) : undefined, error: string | undefined;
    if (!candidates) {
      try {
        candidates = await ui.task({ kind: 'query', message: t("tui.app.loading_filter_options"), activeTab: tab === 0 ? 'usage' : 'threads' }, options =>
          loadFilterOptions(request => queryUsage(request, options), { ...screen.request, snapshotId: selector }));
        if (selector) filterCache.set(key, candidates);
      } catch (cause) {
        if (cause instanceof OperationCancelled) { notice = t("common.loading_cancelled"); return { request: screen.request }; }
        if (ui.signal.aborted || (cause instanceof CoreError && cause.code === 'CANCELLED')) throw cause;
        error = t("tui.app.options_unavailable_enter_manually") + (cause instanceof Error ? cause.message : String(cause));
      }
    }
    return editTerminalFilters(screen.request, new Date().toISOString(), { form: ui.form.bind(ui) }, candidates, error);
  }
  async function managePrices(): Promise<boolean> {
    try {
      const action = await browsePrices(client, ui, tab === 0 ? 'usage' : 'threads');
      if (action === 'quit') return true;
      if (action === 'usage-tab' || action === 'threads-tab') { tab = action === 'usage-tab' ? 0 : 1; screen = homes[tab]; stack.length = 0; }
    } catch (error) {
      if (error instanceof CoreError && error.code === 'CANCELLED') throw error;
      notice = error instanceof Error ? error.message : String(error);
    }
    return false;
  }
  for (;;) {
    if (ui.signal.aborted) return 130;
    try {
      if (!screen.result) {
        screen.result = await ui.task({ kind: client.live && homes.includes(screen) && !initial.snapshotId ? 'open' : openedAny ? 'query' : 'snapshot', message: t("tui.app.loading_usage"), activeTab: tab === 0 ? 'usage' : 'threads' }, options => queryUsage({ ...screen.request, snapshotId: client.live && homes.includes(screen) && !initial.snapshotId ? undefined : snapshotId }, options));
        openedAny = true;
        notice = '';
        if (!startupChecked) {
          startupChecked = true;
          if (screen.result.quality.issues.some(issue => issue.code === 'LEGACY_DETAILS_UNAVAILABLE')) {
            try {
              const refreshed = await refreshUsage();
              snapshotId = refreshed.snapshotRef.snapshotId;
              screen.result = undefined;
              continue;
            } catch (error) {
              if (ui.signal.aborted) return ui.exitCode;
              notice = error instanceof OperationCancelled ? t("common.refresh_cancelled_showing_previous_results") : error instanceof Error ? error.message : String(error);
            }
          }
        }
        snapshotId = screen.result!.snapshotRef.selector ?? screen.result!.snapshotRef.snapshotId;
        // Keep implicit dates implicit: the core resolves them for each report group.
        // Copying the response range into the request freezes all later reports to it.
        lastCode = screen.result!.quality.status === 'partial' ? 2 : 0;
      }
    }
    catch (error) {
      if (!initial.snapshotId && error instanceof CoreError && error.code === 'VIEW_EXPIRED') {
        snapshotId = undefined; for (const home of homes) home.result = undefined;
        stack.length = 0; screen = homes[tab]; notice = t("tui.app.version_expired_reloading_the_list"); continue;
      }
      if (error instanceof CoreError && error.code === 'CANCELLED')
        return 130;
      if (!startupChecked && error instanceof CoreError && error.code === 'NO_SNAPSHOT') {
        startupChecked = true;
        try {
          const refreshed = await refreshUsage('first');
          snapshotId = refreshed.snapshotRef.snapshotId;
          continue;
        } catch (refreshError) {
          if (ui.signal.aborted) return ui.exitCode;
          notice = refreshError instanceof Error ? refreshError.message : String(refreshError);
        }
      }
      const answer = await choose({ title: t("common.wombat_usage"), intro: [notice || (error instanceof OperationCancelled ? t("tui.app.loading_cancelled_no_usage_results_yet") : error instanceof Error ? error.message : String(error))], choices: [{ id: 'refresh', lines: [t("tui.app.load_usage")] }, { id: 'retry', lines: [t("common.retry")] }, { id: 'prices', lines: [t("tui.app.update_official_prices")] }, { id: 'filters', lines: [t("tui.app.edit_filters")] }, { id: 'back', lines: [stack.length ? t("tui.app.back_to_threads") : t("tui.app.quit")] }], footer: t("tui.app.select_enter_confirm_esc_back") });
      if (answer.id === 'quit') return 1;
      if (answer.id === 'prices') { if (await managePrices()) return 1; continue; }
      if (answer.id === 'back') { const parent = stack.pop(); if (!parent) return 1; screen = parent; tab = screen.request.action === 'usage' ? 0 : 1; continue; }
      if (answer.id === 'filters') {
        if (screen.request.action === 'usage' || screen.request.action === 'threads') {
          const filtered = await editFilters();
          if (filtered.navigate) { tab = filtered.navigate === 'usage-tab' ? 0 : 1; screen = homes[tab]; stack.length = 0; }
          else screen.request = filtered.request;
        } else notice = t("common.return_to_the_thread_list_to");
      }
      if (answer.id === 'refresh') {
        try {
          const refreshed = await refreshUsage();
          snapshotId = refreshed.snapshotRef.snapshotId;
          for (const home of homes) {
            home.result = undefined;
            home.expanded.clear();
            home.details.clear();
          }
          screen = homes[tab];
          stack.length = 0;
        }
        catch (refreshError) {
          notice = refreshError instanceof Error ? refreshError.message : String(refreshError);
        }
      }
      continue;
    }
    const result = screen.result!;
    const scope = screen.request.scope ?? {};
    const timezone = scope.timezone ?? 'UTC';
    const frame = screenFrame(screen, tab, notice);
    const initialChoices = frame.layout!(ui.renderer.width).choices!;
    let update: UsageResult | undefined;
    let updateError: string | undefined;
    let updateAvailable = false;
    const polling = new AbortController();
    let busy = false;
    const follow = Boolean(client.live && !initial.snapshotId && homes.includes(screen) && !screen.note && !screen.details.size);
    const timer = follow ? setInterval(() => {
      if (busy) return;
      busy = true;
      void queryUsage({ ...screen.request, snapshotId: undefined }, { signal: polling.signal }).then(value => {
        if (polling.signal.aborted) return;
        if (value.snapshotRef.snapshotId !== result.snapshotRef.snapshotId || JSON.stringify(value.scope) !== JSON.stringify(result.scope) || value.freshness?.status !== result.freshness?.status) {
          if (ui.isFollowingTop && result.page.offset === 0) update = value;
          else { updateAvailable = true; if (notice === t("common.new_data_r_refresh")) return; }
          ui.invalidate();
        }
      }).catch(error => {
        if (!polling.signal.aborted) { updateError = error instanceof Error ? error.message : String(error); ui.invalidate(); }
      }).finally(() => { busy = false; });
    }, 1_000) : undefined;
    let answer;
    try {
      answer = await choose({ ...frame, selected: Math.min(screen.selected, Math.max(0, initialChoices.length - 1)), shortcuts: { '1': 'usage-tab', '2': 'threads-tab', v: 'details', q: 'quit', l: 'language', r: 'refresh', u: 'prices', f: 'filters', '/': 'search', s: 'sort', g: 'group', d: 'daily', '?': 'explain', n: 'next', p: 'previous' } });
    } finally { if (timer) clearInterval(timer); polling.abort(); }

    const choices = frame.layout!(ui.renderer.width).choices!;
    screen.selected = answer.selected;
    screen.viewportStart = answer.viewportStart;
    if (answer.id === 'live-update') {
      if (update) {
        const selectedChoice = choices[answer.selected];
        const oldItem = selectedChoice?.id.startsWith('item:') ? result.items[Number(selectedChoice.id.slice(5))] : undefined;
        const identity = (item: UsageItem) => 'id' in item ? item.id : JSON.stringify([item.kind, item.scope, item.model, item.reasoningEffort, item.isSubtotal]);
        const next = oldItem ? update.items.findIndex(item => identity(item) === identity(oldItem)) : -1;
        if (next >= 0) screen.selected = next;
        screen.result = update;
        snapshotId = update.snapshotRef.snapshotId;
        lastCode = update.quality.status === 'partial' ? 2 : 0;
        notice = '';
      } else if (updateAvailable) notice = t("common.new_data_r_refresh");
      else if (updateError) notice = t("tui.app.automatic_update_failed") + updateError;
      continue;
    }
    if (answer.id === 'language') { locale.setLocale(locale.getSnapshot().locale === 'zh' ? 'en' : 'zh'); notice = ''; screen.note = undefined; continue; }
    if (answer.id === 'quit')
      return lastCode;
    if (['tab', 'usage-tab', 'threads-tab'].includes(answer.id)) {
      tab = answer.id === 'tab' ? 1 - tab : answer.id === 'usage-tab' ? 0 : 1;
      screen = homes[tab];
      stack.length = 0;
      continue;
    }
    if (answer.id === 'back') {
      if (screen.note) { screen.note = undefined; continue; }
      const parent = stack.pop();
      if (parent) {
        screen = parent;
        tab = screen.request.action === 'usage' ? 0 : 1;
      }
      else
        return lastCode;
      continue;
    }
    if (answer.id === 'prices') { if (await managePrices()) return lastCode; continue; }
    if (answer.id === 'explain') {
      screen.note = screen.note ? undefined : { lines: [t("tui.app.cost_basis_standard_api_equivalent"), t("tui.app.not_an_account_bill_marks_the"), ...priceBasisLines(selectedSummary(screen, choices[answer.selected]?.id)), ...result.quality.issues.map(issue => issue.message)] };
      continue;
    }
    if (answer.id === 'refresh') {
      try {
        const refreshed = await refreshUsage();
        snapshotId = refreshed.snapshotRef.snapshotId;
        for (const home of homes) {
          home.result = undefined;
          home.expanded.clear();
          home.details.clear();
        }
        screen = homes[tab];
        stack.length = 0;
        screen.result = undefined;
        screen.expanded.clear();
        notice = '';
      }
      catch (error) {
        notice = error instanceof OperationCancelled ? t("common.refresh_cancelled_showing_previous_results") : error instanceof Error ? error.message : String(error);
      }
      continue;
    }
    if (answer.id === 'filters') {
      if (screen.request.action !== 'usage' && screen.request.action !== 'threads') { notice = t("common.return_to_the_thread_list_to"); continue; }
      const filtered = await editFilters();
      if (filtered.navigate) { tab = filtered.navigate === 'usage-tab' ? 0 : 1; screen = homes[tab]; stack.length = 0; continue; }
      if (filtered.request === screen.request) continue;
      screen.request = filtered.request;
      screen.result = undefined;
      screen.expanded.clear();
      screen.details.clear();
      screen.selected = 0;
      continue;
    }
    if (answer.id === 'search') {
      if (screen.request.action !== 'threads') {
        notice = t("tui.app.search_in_threads");
        continue;
      }
      const search = await input({ title: t("tui.app.search_threads"), value: screen.request.search ?? '' });
      if (search !== null) {
        screen.request = { ...screen.request, search: search || undefined, offset: 0 };
        screen.result = undefined;
        screen.details.clear();
        screen.selected = 0;
      }
      continue;
    }
    if (answer.id === 'group' || answer.id.startsWith('group:')) {
      if (screen.request.action !== 'usage')
        continue;
      const groups = ['day', 'week', 'month'] as const;
      screen.request.group = answer.id.startsWith('group:') ? groups[Number(answer.id.slice(6))] : groups[(groups.indexOf(screen.request.group ?? 'day') + 1) % 3];
      screen.request.offset = 0;
      screen.result = undefined;
      screen.details.clear();
      screen.selected = 0;
      continue;
    }
    if (answer.id === 'sort' || answer.id.startsWith('sort:')) {
      if (screen.request.action === 'usage')
        continue;
      screen.request.sort = answer.id === 'sort:0' ? 'tokens' : answer.id === 'sort:1' ? (screen.request.action === 'threads' ? 'recent' : 'time') : screen.request.sort === 'tokens' ? (screen.request.action === 'threads' ? 'recent' : 'time') : 'tokens';
      screen.request.offset = 0;
      screen.result = undefined;
      screen.expanded.clear();
      screen.details.clear();
      screen.selected = 0;
      continue;
    }
    if (answer.id === 'next' || answer.id === 'previous') {
      if (answer.id === 'next' && result.page.offset + result.items.length >= result.page.total)
        continue;
      screen.request = pageRequest(screen.request, answer.id === 'next', result.page.total);
      screen.result = undefined;
      screen.details.clear();
      screen.selected = 0;
      continue;
    }
    if (answer.id === 'daily') {
      if (!screen.thread)
        continue;
      stack.push(screen);
      screen = { request: { action: 'usage', scope: { timezone, threadId: screen.thread.id } }, selected: 0, expanded: new Map(), details: new Set(), thread: screen.thread };
      tab = 0;
      continue;
    }
    if (answer.id.startsWith('step-sort:') || answer.id.startsWith('step-prev:') || answer.id.startsWith('step-next:')) {
      const prefix = answer.id.slice(0, answer.id.indexOf(':'));
      const target = answer.id.slice(answer.id.indexOf(':') + 1);
      const explicitSort = prefix === 'step-sort' ? /^(time|tokens):/.exec(target)?.[1] as 'time' | 'tokens' | undefined : undefined;
      const turnId = explicitSort ? target.slice(explicitSort.length + 1) : target;
      const previous = screen.expanded.get(turnId)!;
      const stepSort = screen.stepSort ??= new Map();
      const sort = explicitSort ?? (prefix === 'step-sort' ? (stepSort.get(turnId) === 'tokens' ? 'time' : 'tokens') : (stepSort.get(turnId) ?? 'time'));
      const request: UsageRequest = { action: 'steps', threadId: screen.request.threadId, turnId, scope: screen.request.scope, sort, offset: prefix === 'step-next' ? previous.page.offset + previous.page.limit : prefix === 'step-prev' ? Math.max(0, previous.page.offset - previous.page.limit) : 0 };
      try {
        const steps = await ui.task({ kind: 'query', message: t("common.loading_turn_records"), activeTab: 'threads' }, options => queryUsage({ ...request, snapshotId }, options));
        screen.expanded.set(turnId, steps);
        stepSort.set(turnId, sort);
        clearStepDetails(screen, turnId);
      }
      catch (error) {
        notice = error instanceof Error ? error.message : String(error);
      }
      continue;
    }
    if (answer.id.startsWith('step:')) {
      if (screen.details.has(answer.id))
        screen.details.delete(answer.id);
      else
        screen.details.add(answer.id);
      continue;
    }
    if (answer.id === 'details') {
      const id = choices[answer.selected]?.id;
      if (id) { if (screen.details.has(id)) screen.details.delete(id); else screen.details.add(id); }
      continue;
    }
    if (!answer.id.startsWith('item:'))
      continue;
    const item = result.items[Number(answer.id.slice(5))];
    if (!item)
      continue;
    if (item.kind === 'usage') {
      stack.push(screen);
      screen = { request: { action: 'threads', scope: { ...item.scope, timezone }, sort: 'tokens' }, selected: 0, expanded: new Map(), details: new Set() };
      tab = 1;
      continue;
    }
    if (item.kind === 'thread') {
      stack.push(screen);
      screen = { request: { action: 'turns', threadId: item.id, scope: { ...scope }, sort: 'tokens' }, selected: 0, expanded: new Map(), details: new Set(), thread: item };
      continue;
    }
    if (item.kind === 'turn') {
      if (screen.expanded.has(item.id))
        screen.expanded.delete(item.id);
      else
        try {
          const sort = screen.stepSort?.get(item.id) ?? 'time';
          const steps = await ui.task({ kind: 'query', message: t("common.loading_turn_records"), activeTab: 'threads' }, options => queryUsage({ action: 'steps', snapshotId, threadId: item.threadId, turnId: item.id, scope, sort }, options));
          screen.expanded.set(item.id, steps);
          clearStepDetails(screen, item.id);
        }
        catch (error) {
          notice = error instanceof Error ? error.message : String(error);
        }
      continue;
    }
    if (item.kind === 'measurement') {
      if (screen.details.has(answer.id))
        screen.details.delete(answer.id);
      else
        screen.details.add(answer.id);
    }
  }
}

}
