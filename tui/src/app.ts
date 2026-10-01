import { automaticPriceText } from '@wombat/client/locale';
import { t, locale } from '@wombat/client/locale';
import { browsePrices } from './state/prices.js';
import { OperationCancelled, type LoadingSpec } from './components/loading-model.js';
import { editTerminalFilters } from './state/filters.js';
import { loadFilterOptions, type FilterOptions } from './state/filter-options.js';
import { type Frame, type Choice, type RowPaint } from './components/view-model.js';
import { createTerminalUI, type TerminalUI } from './components/terminal-ui.js';
import { terminalText } from './display-text.js';
import { CoreError, type UsageClient, type UsageItem, type UsageRequest, type UsageResult, type UsageSummary } from '@wombat/client';
import { itemContent, usageLabel, metricPair, reportCost, reportMoney, tokens, compactTokens, rangeLabel, dateLabel, effort, activityRange, summaryMetrics, usageHeaderCells, usageTotalCells, categoryLabels, type ItemContent } from './screens/format.js';
interface Screen {
  request: UsageRequest;
  selected: number;
  metric?: 'tokens' | 'cost';
  linked?: boolean;
  anchor?: UsageItem;
  anchorChoice?: string;
  selectLast?: boolean;
  readError?: Error;
  viewportStart?: number;
  note?: { lines: string[] };
  expanded: Map<string, UsageResult>;
  details: Set<string>;
  stepSort?: Map<string, 'time' | 'tokens' | 'cost'>;
  thread?: Extract<UsageItem, {
    kind: 'thread';
  }>;
  result?: UsageResult;
}
function reportShare(value: number | null | undefined): string { return value == null ? '—' : value > 0 && value < .001 ? '<0.1%' : (value * 100).toFixed(1) + '%'; }
function reportPageLimit(ui: TerminalUI): number { return ui.renderer.width < 68 ? Math.max(1, Math.min(3, Math.floor((ui.renderer.height - 10) / 3))) : 6; }
function clearStepDetails(screen: Screen, turnId: string): void {
  for (const key of screen.details) if (key.startsWith(`step:${turnId}:`)) screen.details.delete(key);
}
function sameItem(a: UsageItem, b: UsageItem): boolean {
  return a.kind === 'usage' && b.kind === 'usage' ? a.date === b.date && a.model === b.model && a.reasoningEffort === b.reasoningEffort && a.isSubtotal === b.isSubtotal
    : 'id' in a && 'id' in b && a.kind === b.kind && a.id === b.id;
}
function stepDetailKey(screen: Screen, choice: string): string {
  const end = choice.lastIndexOf(':');
  const turnId = choice.slice(5, end), step = screen.expanded.get(turnId)?.items[Number(choice.slice(end + 1))];
  return step && 'id' in step ? `step:${turnId}:${step.id}` : choice;
}
function rememberSelection(screen: Screen, choices: Choice[], selected: number): void {
  const choice = choices[selected];
  if (!choice) return;
  if (choice.id.startsWith('item:')) screen.anchor = screen.result?.items[Number(choice.id.slice(5))];
  else if (choice.turnGroup) {
    screen.anchor = screen.result?.items.find(item => item.kind === 'turn' && item.id === choice.turnGroup);
    screen.anchorChoice = choice.id.startsWith('step:') ? stepDetailKey(screen, choice.id) : choice.id;
  }
}
function pageRequest(request: UsageRequest, forward: boolean, total: number): UsageRequest { const limit = request.limit ?? 50; return { ...request, offset: forward ? Math.min(Math.max(0, total - 1), (request.offset ?? 0) + limit) : Math.max(0, (request.offset ?? 0) - limit) }; }
function itemPaint(rows: string[]): RowPaint[] { return rows.map(() => ({ tone: 'muted' })); }
function clockStepContent(step: UsageItem, steps: UsageResult, turn: Extract<UsageItem, { kind: 'turn' }>, width: number, metric: 'tokens' | 'cost' = 'tokens'): ItemContent {
  if (step.kind !== 'measurement' && step.kind !== 'operation') return itemContent(step, steps, width, undefined, metric);
  const timezone = steps.scope.timezone ?? 'UTC';
  if (step.timePrecision !== 'date' && step.timePrecision !== 'unknown' && step.timestamp && turn.startedAt && turn.endedAt &&
    dateLabel(step.timestamp, steps.snapshotRef.createdAt, timezone) === dateLabel(turn.startedAt, steps.snapshotRef.createdAt, timezone) &&
    dateLabel(turn.endedAt, steps.snapshotRef.createdAt, timezone) === dateLabel(turn.startedAt, steps.snapshotRef.createdAt, timezone)) {
    const date = dateLabel(step.timestamp, steps.snapshotRef.createdAt, timezone);
    const time = dateLabel(step.timestamp, steps.snapshotRef.createdAt, timezone, true, step.timePrecision).slice(date.length + 1);
    return itemContent(step, steps, width, time, metric);
  }
  return itemContent(step, steps, width, undefined, metric);
}
function screenChoices(screen: Screen, width: number): Choice[] {
  const result = screen.result!;
  const choices: Choice[] = [];
  for (const [index, item] of result.items.entries()) {
    const id = `item:${index}`;
    const reportGroup = item.kind === 'usage' ? JSON.stringify([item.scope.since, item.scope.until, item.scope.undated]) : undefined;
    if (item.kind === 'usage' && screen.request.presentation === 'distribution' && !item.isSubtotal) continue;
    const content = itemContent(item, result, width, undefined, screen.metric, screen.request.group);
    if (screen.linked && item.kind === 'thread') content.lines.splice(1, content.lines.length, t('tui.report.thread_comparison', { selected: usageLabel(item.matchedUsage, false, true), whole: usageLabel(item.threadUsage, false, true) }));
    if (screen.linked && item.kind === 'turn' && item.matchedUsage.measurementCount === item.usage.measurementCount) content.lines.push(t('tui.screens.format.filtered_value', { p0: usageLabel(item.matchedUsage, false, true) }));
    if (item.kind === 'usage' && screen.request.presentation === 'distribution') {
      const cost = screen.metric === 'cost', stats = result.distribution;
      const known = item.usage.price.status !== 'unknown' && item.usage.measurementCount > 0;
      const amount = cost ? known ? Number(item.usage.price.cost ?? item.usage.price.knownCost) : undefined : item.usage.tokens.total ?? undefined;
      const maximum = cost ? stats?.maxCost == null ? undefined : Number(stats.maxCost) : stats?.maxTokens ?? undefined;
      choices.push({ id, lines: [], kind: 'subtotal', separatorAfter: true, distribution: { label: item.date && screen.request.group === 'month' ? dateLabel(item.date.slice(0, 7), result.snapshotRef.createdAt, result.scope.timezone ?? 'UTC') : item.date ? rangeLabel(item.scope.since, item.scope.until, result.snapshotRef.createdAt, result.scope.timezone ?? 'UTC') : t('common.unknown_date'), value: cost ? reportCost(item.usage) : compactTokens(item.usage.tokens.total), share: reportShare(cost ? item.costShare : item.share), ratio: amount == null || maximum == null ? undefined : maximum > 0 ? amount / maximum : 0, peak: maximum != null && maximum > 0 && result.page.total > 1 && ((cost ? stats?.peakCostDates : stats?.peakTokenDates)?.includes(item.date ?? null) ?? false), peakLabel: t(cost && result.summary.price.status === 'partial' ? 'tui.report.priced_peak' : 'tui.report.peak') } });
      continue;
    }
    if (item.kind === 'turn' && content.headline)
      content.headline.label = `${screen.expanded.has(item.id) ? '⌄' : '›'} ${content.headline.label}`;
    if (item.kind === 'measurement' && content.headline)
      content.headline.label = `${screen.details.has(id) ? '⌄' : '›'} ${content.headline.label}`;
    choices.push({ id, ...content, paint: itemPaint(content.lines).map((paint, i) => item.kind === 'thread' && i > 0 ? { tone: 'disclosureSummary' } : paint), reportGroup, turnGroup: item.kind === 'turn' ? item.id : undefined,
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
        { id: `step-sort:${screen.metric === 'cost' ? 'cost' : 'tokens'}:${item.id}`, label: t(screen.metric === 'cost' ? 'tui.report.highest_cost' : 'common.most_tokens'), active: sort === (screen.metric === 'cost' ? 'cost' : 'tokens') },
      ] });
      for (const [stepIndex, step] of steps.items.entries()) {
        const key = `step:${item.id}:${stepIndex}`;
        const detailKey = 'id' in step ? `step:${item.id}:${step.id}` : key;
        const stepContent = clockStepContent(step, steps, item, width, screen.metric);
        if (step.kind === 'operation' && ['tokens', 'cost'].includes(screen.stepSort?.get(item.id) ?? '') && (stepIndex === 0 || steps.items[stepIndex - 1].kind !== 'operation')) stepContent.lines.unshift(t("tui.app.operations_chronological"));
        if (step.kind === 'measurement' && stepContent.headline)
          stepContent.headline.label = `${screen.details.has(detailKey) ? '⌄' : '›'} ${stepContent.headline.label}`;
        choices.push({ id: key, ...stepContent, turnGroup: item.id, recordStart: true, expanded: screen.details.has(detailKey), kind: step.kind === 'operation' ? 'operation' : 'measurement', depth: 1, paint: itemPaint(stepContent.lines) });
        if (screen.details.has(detailKey) && step.kind === 'measurement')
          choices.push({ id: `step-detail:${item.id}:${stepIndex}`, kind: 'detail', depth: 2, turnGroup: item.id, lines: [], metrics: summaryMetrics(step.usage) });
      }
      if (steps.page.offset > 0)
        choices.push({ id: `step-prev:${item.id}`, depth: 1, turnGroup: item.id, lines: [t("tui.app.previous_records")] });
      if (steps.page.offset + steps.items.length < steps.page.total)
        choices.push({ id: `step-next:${item.id}`, depth: 1, turnGroup: item.id, lines: [t("tui.app.next_records")] });
    }
  }
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
export function screenFrame(screen: Screen, tab: number, notice = '', canBack = Boolean(screen.thread || screen.linked)): Frame {
  const result = screen.result!;
  const scope = result.scope;
  const timezone = scope.timezone ?? 'UTC';
    const makeLayout = (width: number): Partial<Frame> => {
      width = Math.min(width, 120);
      const range = rangeLabel(scope.since, scope.until, result.snapshotRef.createdAt, timezone);
      const intro = width < 68 ? [range] : [t("common.local_codex") + range];
      if (scope.project || screen.request.search) intro.push([scope.project && scope.project.split('/').filter(Boolean).at(-1), screen.request.search && t("tui.app.search") + screen.request.search].filter(Boolean).join(' · '));
      if (scope.model || scope.reasoningEffort) intro.push([scope.model, scope.reasoningEffort && effort(scope.reasoningEffort)].filter(Boolean).join(' · '));
      const context: NonNullable<Frame['context']> = [];
      if (screen.thread) context.push({ text: (screen.thread.project?.split('/').filter(Boolean).at(-1) ?? t("common.unknown_project")) + ' · ' + activityRange(screen.thread.startedAt, screen.thread.lastActivityAt, result.snapshotRef.createdAt, timezone) });
      const isUsage = screen.request.action === 'usage';
      const consumption = t(screen.metric === 'cost' ? 'tui.report.highest_cost' : 'common.most_tokens');
      const currentControl = isUsage ? ({ day: t("common.daily"), week: t("common.weekly"), month: t("common.monthly") }[screen.request.group ?? 'day']) : screen.request.sort === 'recent' ? t("common.recent_activity") : screen.request.sort === 'time' ? t("common.chronological") : consumption;
      const options = isUsage ? [t("common.daily"), t("common.weekly"), t("common.monthly")] : [consumption, screen.request.action === 'threads' ? t("common.recent_activity") : t("common.chronological")];
      if (!isUsage && screen.thread) {
        context.push({ text: metricPair(result.summary, screen.metric ?? 'tokens'), summary: true });
        context.push({ text: (screen.thread.models.join(' / ') || t("common.unknown_model")) + ' · ' + (screen.thread.reasoningEfforts.map(effort).join(' / ') || '—') });
        if (screen.linked || screen.thread.matchedUsage.measurementCount !== screen.thread.threadUsage.measurementCount) context.push({ text: t('tui.report.thread_comparison', { selected: usageLabel(screen.thread.matchedUsage, false, true), whole: usageLabel(screen.thread.threadUsage, false, true) }), notice: true });
      }
      const actions = (isUsage ? t('tui.report.usage_actions') : screen.thread ? t('tui.report.turn_actions') : t('tui.report.threads_actions')) + (screen.linked ? ' · ' + t('tui.report.all_threads') : '');
      const disclosure = screen.note?.lines;
      const choices = screenChoices(screen, width);
      const distribution = isUsage && screen.request.presentation === 'distribution';
      const hasRows = result.items.length > 0;
      const nextPage = result.page.nextOffset != null || result.page.nextOffset === undefined && result.page.offset + result.items.length < result.page.total;
      const hasPages = result.page.offset > 0 || nextPage;
      const isTurn = screen.request.action === 'turns';
      const footer = !hasRows ? t(isTurn ? 'tui.report.empty_turn_footer' : 'tui.report.empty_footer')
        : isTurn ? t('tui.report.turn_footer') : t('tui.report.footer', { page: hasPages ? ' · N/P' : '', back: canBack ? t('tui.report.back_hint') : '' });
      const compactFooter = !hasRows ? (isTurn ? 'B · Q' : 'R · F · ? · Q')
        : '↑↓ · Enter' + (hasPages ? ' · N/P' : '') + (isTurn ? '' : ' · F · ?') + (isTurn || canBack ? ' · B' : '') + ' · Q';
      const metricLabel = t(screen.metric === 'cost' ? 'tui.report.cost' : 'tui.report.tokens');
      const tools: NonNullable<Frame['tools']> = [{ id: 'metric', label: metricLabel + ' ⇄', compactLabel: (screen.metric === 'cost' ? '≈USD' : t('tui.report.tokens')) + ' ⇄', disabled: result.summary.measurementCount === 0 }];
      if (isUsage) tools.push({ id: 'presentation', label: (distribution ? '▤ ' : '≡ ') + t(distribution ? 'tui.report.distribution' : 'tui.report.details'), compactLabel: distribution ? '▤' : '≡' }, { id: 'sort', label: (screen.request.sort === 'tokens' || screen.request.sort === 'cost' ? '↓ ' : '◷ ') + t(screen.request.sort === 'tokens' || screen.request.sort === 'cost' ? screen.metric === 'cost' ? 'tui.report.highest_cost' : 'tui.report.consumption' : 'tui.report.recent'), compactLabel: screen.request.sort === 'tokens' || screen.request.sort === 'cost' ? '↓' : '◷' });
      const maximum = screen.metric === 'cost' ? reportMoney(result.distribution?.maxCost) : compactTokens(result.distribution?.maxTokens);
      const peaks = screen.metric === 'cost' ? result.distribution?.peakCostDates : result.distribution?.peakTokenDates;
      const peakScopes = screen.metric === 'cost' ? result.distribution?.peakCostScopes : result.distribution?.peakTokenScopes;
      const peakValue = screen.metric === 'cost' ? Number(result.distribution?.maxCost) : result.distribution?.maxTokens;
      const metricTotal = screen.metric === 'cost' ? Number(result.summary.price.cost ?? result.summary.price.knownCost) : result.summary.tokens.total;
      const partial = screen.metric === 'cost' && result.summary.price.status === 'partial';
      const peakName = t(partial ? (peaks?.length ?? 0) > 1 ? 'tui.report.tied_priced_peak' : 'tui.report.priced_peak' : (peaks?.length ?? 0) > 1 ? 'tui.report.tied_peak' : 'tui.report.peak');
      const peakActions = distribution && result.page.total > 1 && width >= 68 && peakValue != null && peakValue > 0 ? peakScopes?.slice(0, 1).map(peakScope => ({ id: 'peak:0', label: peakName + ' · ' + rangeLabel(peakScope.since, peakScope.until, result.snapshotRef.createdAt, timezone) + ' · ' + maximum + (screen.metric === 'cost' ? '' : ' ' + t('tui.report.tokens')) + ' · ' + reportShare(metricTotal ? peakValue / metricTotal : undefined) })) : undefined;
      if (screen.linked && screen.request.action === 'threads') context.unshift({ text: t('tui.report.linked', { range, model: scope.model ?? (scope.modelUnknown ? t('common.unknown_model') : t('common.all')), effort: scope.effortUnknown ? t('tui.report.effort_unknown') : scope.reasoningEffort ? effort(scope.reasoningEffort) : t('common.all') }), notice: true });
      return { intro, context, actions, disclosure, tools, peakActions, compactFooter, pagination: hasPages ? { label: t('tui.prices.page', { current: Math.floor(result.page.offset / result.page.limit) + 1, total: Math.max(1, Math.ceil(result.page.total / result.page.limit)) }), previous: result.page.offset > 0, next: nextPage } : undefined, controlLabel: isTurn ? t('tui.report.turns_heading') : undefined, disclosureLabel: t(result.summary.price.status === 'unknown' ? 'tui.report.notes' : 'tui.report.price_basis'),
        distributionHeader: distribution && hasRows ? { maximum, metric: metricLabel, share: t(screen.metric === 'cost' && result.summary.price.status === 'partial' ? 'tui.report.priced_share' : 'tui.report.share') } : undefined,
        totalLabel: distribution && hasRows ? t(screen.metric === 'cost' && result.summary.price.status === 'partial' ? 'tui.report.priced_subtotal' : 'tui.report.range_total') : undefined,
        total: distribution && hasRows ? (screen.metric === 'cost' ? reportCost(result.summary) : compactTokens(result.summary.tokens.total) + ' ' + t('tui.report.tokens')) : undefined,
        totalSecondary: distribution && hasRows ? screen.metric === 'cost' ? compactTokens(result.summary.tokens.total) + ' ' + t('tui.report.tokens') : reportCost(result.summary) : undefined,
        totalNote: isUsage && screen.metric === 'cost' && result.distribution?.unpricedTokens ? t('tui.report.unpriced_tokens', { value: compactTokens(result.distribution.unpricedTokens) }) : undefined, disclosureAction: disclosure ? { label: t("tui.app.u_view_all_prices"), id: 'prices' } : undefined, controlKind: isUsage ? 'group' : 'sort', controlOptions: options, activeControl: currentControl, choices, footer,
        tableCells: isUsage && !distribution ? usageHeaderCells(width, screen.metric) : undefined,
        totalCells: isUsage && !distribution && result.items.length ? usageTotalCells(result.summary, width) : undefined,
        status: notice || automaticPriceText(result) || (result.freshness?.status === 'syncing' ? t("tui.app.syncing_showing_committed_data") : result.freshness?.status === 'failed' ? t("tui.app.sync_failed_keeping_previous_data") : result.freshness?.status === 'current' ? t("tui.app.updating_automatically") : undefined) || (result.quality.status === 'partial' ? t("tui.app.data_notes_view") : undefined),
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
        try { return (await client.live({ query: request, mode: 'fresh' }, combined)).result; }
        catch (error) { if (!(error instanceof CoreError) || !['SYNC_PENDING', 'NO_SNAPSHOT'].includes(error.code)) throw error; }
        return (await client.live({ query: request, mode: 'fresh' }, combined)).result;
      }
      return (await client.live({ query: request, mode: initialLiveRead ? 'fresh' : undefined }, combined)).result;
    }
    return client.query(request, combined);
  };
  const choose = ui.choose.bind(ui), input = ui.input.bind(ui);
  try { const code = await run(); return ui.signal.aborted ? ui.exitCode : code; }
  catch (error) { if (ui.signal.aborted) return ui.exitCode; throw error; }
  finally { ui.destroy(); }
  async function run(): Promise<number> {
  const initialScope = { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...initial.scope };
  const homes: Screen[] = [{ request: { ...initial, action: 'usage', presentation: initial.presentation ?? 'distribution', limit: initial.limit ?? reportPageLimit(ui), scope: { ...initialScope } }, metric: initial.sort === 'cost' ? 'cost' : 'tokens', selected: 0, expanded: new Map(), details: new Set() }, { request: { action: 'threads', limit: reportPageLimit(ui), scope: { timezone: initialScope.timezone }, sort: 'tokens' }, selected: 0, expanded: new Map(), details: new Set() }];
  let tab = 0;
  let screen = homes[0];
  const stack: Screen[] = [];
  const enterHome = (target: number) => {
    tab = target; screen = homes[tab];
    screen.result = undefined; screen.readError = undefined; screen.note = undefined;
    screen.expanded.clear(); screen.details.clear();
    initialLiveRead = true; stack.length = 0;
  };
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
      if (action === 'usage-tab' || action === 'threads-tab') enterHome(action === 'usage-tab' ? 0 : 1);
    } catch (error) {
      if (error instanceof CoreError && error.code === 'CANCELLED') throw error;
      notice = error instanceof Error ? error.message : String(error);
    }
    return false;
  }
  for (;;) {
    if (ui.signal.aborted) return 130;
    try {
      if (screen.readError) throw screen.readError;
      if (!screen.result) {
        screen.result = await ui.task({ kind: client.live && homes.includes(screen) && !initial.snapshotId ? 'open' : openedAny ? 'query' : 'snapshot', message: t('tui.app.loading_usage'), activeTab: tab === 0 ? 'usage' : 'threads' }, async options => {
          let value = await queryUsage({ ...screen.request, snapshotId: client.live && homes.includes(screen) && !initial.snapshotId ? undefined : snapshotId }, options);
          while (screen.anchor && !value.items.some(item => sameItem(item, screen.anchor!) || item.kind === 'usage' && screen.anchor!.kind === 'usage' && item.date === screen.anchor!.date)) {
            const next = value.page.nextOffset ?? (value.page.nextOffset === undefined && value.page.offset + value.items.length < value.page.total ? value.page.offset + value.page.limit : undefined);
            if (next == null || next <= value.page.offset) break;
            value = await queryUsage({ ...screen.request, offset: next, snapshotId: value.snapshotRef.selector ?? value.snapshotRef.snapshotId }, options);
          }
          screen.request.offset = value.page.offset;
          return value;
        });
        if (screen.anchor) {
          const anchor = screen.anchor;
          const exact = screen.result.items.findIndex(item => sameItem(item, anchor));
          const index = exact >= 0 ? exact : Math.max(0, screen.result.items.findIndex(item => item.kind === 'usage' && anchor.kind === 'usage' && item.date === anchor.date && item.isSubtotal));
          const choices = screenChoices(screen, ui.renderer.width);
          const nested = screen.anchorChoice ? choices.findIndex(choice => (choice.id.startsWith('step:') ? stepDetailKey(screen, choice.id) : choice.id) === screen.anchorChoice) : -1;
          screen.selected = nested >= 0 ? nested : Math.max(0, choices.findIndex(choice => choice.id === `item:${index}`));
          screen.anchor = undefined;
          screen.anchorChoice = undefined;
        }
        if (screen.selectLast) { screen.selected = Math.max(0, screenChoices(screen, ui.renderer.width).length - 1); screen.selectLast = false; }
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
      screen.readError ??= error instanceof Error ? error : new Error(String(error));
      const answer = await choose({ nav: t('tui.app.1_usage_2_threads'), activeTab: tab === 0 ? t('common.1_usage') : t('common.2_threads'), shortcuts: { '1': 'usage-tab', '2': 'threads-tab', '?': 'prices', r: 'refresh' }, title: t(tab === 0 ? 'common.usage' : 'common.threads'), intro: [t('common.local_codex').replace(/ · $/, '')],
        notice: notice || (error instanceof OperationCancelled ? t('tui.loading.no_current_result') : error instanceof Error ? error.message : String(error)),
        choices: [{ id: 'refresh', kind: 'control', lines: [t('tui.loading.read_again')], paint: [{ tone: 'accent' }] }], footer: t('tui.loading.failed_footer'), compactFooter: t('tui.loading.failed_footer') });
      if (answer.id === 'quit') return 1;
      if (['usage-tab', 'threads-tab', 'tab'].includes(answer.id)) { enterHome(answer.id === 'tab' ? 1 - tab : answer.id === 'usage-tab' ? 0 : 1); continue; }
      if (['retry', 'refresh', 'filters'].includes(answer.id)) screen.readError = undefined;
      if (answer.id === 'prices') { if (await managePrices()) return 1; continue; }
      if (answer.id === 'back') { const parent = stack.pop(); if (parent) { screen = parent; tab = screen.request.action === 'usage' ? 0 : 1; } continue; }
      if (answer.id === 'filters') {
        if (screen.request.action === 'usage' || screen.request.action === 'threads') {
          const filtered = await editFilters();
          if (filtered.navigate) enterHome(filtered.navigate === 'usage-tab' ? 0 : 1);
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
    const frame = screenFrame(screen, tab, notice, stack.length > 0);
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
        if (value.snapshotRef.snapshotId !== result.snapshotRef.snapshotId || JSON.stringify(value.scope) !== JSON.stringify(result.scope) || value.freshness?.status !== result.freshness?.status || JSON.stringify(value.priceUpdate) !== JSON.stringify(result.priceUpdate)) {
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
      answer = await choose({ ...frame, requeryOnResize: ['usage', 'threads'].includes(screen.request.action), pageNavigation: ['usage', 'threads'].includes(screen.request.action), selected: Math.min(screen.selected, Math.max(0, initialChoices.length - 1)), shortcuts: { '1': 'usage-tab', '2': 'threads-tab', v: 'presentation', m: 'metric', c: 'explain', a: 'all-threads', q: 'quit', l: 'language', r: 'refresh', u: 'prices', f: 'filters', '/': 'search', s: 'sort', g: 'group', d: 'daily', '?': 'prices', n: 'next', p: 'previous' } });
    } finally { if (timer) clearInterval(timer); polling.abort(); }

    const choices = frame.layout!(ui.renderer.width).choices!;
    screen.selected = answer.selected;
    screen.viewportStart = answer.viewportStart;
    if (answer.id === 'resize') {
      const limit = reportPageLimit(ui);
      if (limit !== screen.request.limit) {
        rememberSelection(screen, choices, answer.selected);
        screen.request = { ...screen.request, limit, offset: 0 }; screen.result = undefined;
      }
      continue;
    }
    if (answer.id.startsWith('cursor:')) {
      const next = answer.id === 'cursor:home' ? 0 : answer.id === 'cursor:end' ? choices.length - 1 : answer.selected + (answer.id === 'cursor:down' ? 1 : -1);
      if (next >= 0 && next < choices.length) { screen.selected = next; continue; }
      if (next < 0 && result.page.offset > 0) { screen.selectLast = true; answer.id = 'previous'; }
      else if (next >= choices.length && (result.page.nextOffset != null || result.page.nextOffset === undefined && result.page.offset + result.items.length < result.page.total)) answer.id = 'next';
      else continue;
    }
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
      enterHome(answer.id === 'tab' ? 1 - tab : answer.id === 'usage-tab' ? 0 : 1);
      continue;
    }
    if (answer.id === 'back') {
      if (screen.note) { screen.note = undefined; continue; }
      const parent = stack.pop();
      if (parent) {
        screen = parent;
        tab = screen.request.action === 'usage' ? 0 : 1;
      }
      continue;
    }
    if (answer.id === 'prices') { if (await managePrices()) return lastCode; continue; }
    if (answer.id === 'explain') {
      const selected = choices[answer.selected];
      const source = selected?.kind === 'detail' ? choices.slice(0, answer.selected).findLast(choice => choice.kind !== 'detail') : selected;
      const subject = source?.headline?.label ?? source?.distribution?.label ?? source?.cells?.slice(0, screen.request.action === 'usage' && ui.renderer.width >= 68 ? 3 : 1).map(cell => cell.text).filter(Boolean).join(' · ');
      screen.note = screen.note ? undefined : { lines: [...(subject ? [subject] : []), t("tui.app.cost_basis_standard_api_equivalent"), t("tui.app.not_an_account_bill_marks_the"), ...priceBasisLines(selectedSummary(screen, selected?.id)), ...result.quality.issues.map(issue => issue.message)] };
      continue;
    }
    if (answer.id === 'refresh') {
      screen.result = undefined; screen.expanded.clear(); screen.details.clear();
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
        notice = error instanceof OperationCancelled ? t('tui.loading.no_current_result') : error instanceof Error ? error.message : String(error);
        screen.readError = new Error(notice);
      }
      continue;
    }
    if (answer.id === 'filters') {
      if (screen.request.action !== 'usage' && screen.request.action !== 'threads') { notice = t("common.return_to_the_thread_list_to"); continue; }
      const filtered = await editFilters();
      if (filtered.navigate) { enterHome(filtered.navigate === 'usage-tab' ? 0 : 1); continue; }
      if (filtered.request === screen.request) continue;
      screen.request = filtered.request;
      if (screen.linked && screen.request.action === 'threads') { screen.request.scope = { timezone: scope.timezone, agentKind: scope.agentKind, sourceInstanceId: scope.sourceInstanceId, project: filtered.request.scope?.project }; screen.linked = false; }
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
        if (screen.linked) { screen.request.scope = { timezone: scope.timezone, project: scope.project }; screen.linked = false; }
        screen.result = undefined;
        screen.details.clear();
        screen.selected = 0;
      }
      continue;
    }
    if (answer.id.startsWith('peak:')) {
      const peakScope = (screen.metric === 'cost' ? result.distribution?.peakCostScopes : result.distribution?.peakTokenScopes)?.[Number(answer.id.slice(5))];
      if (peakScope) { stack.push(screen); screen = { request: { action: 'threads', scope: peakScope, sort: screen.metric ?? 'tokens' }, selected: 0, expanded: new Map(), details: new Set(), linked: true, metric: screen.metric }; tab = 1; }
      continue;
    }
    if (answer.id === 'all-threads' && screen.linked) { enterHome(1); continue; }
    if (answer.id === 'metric') {
      if (result.summary.measurementCount === 0) continue;
      const metric = screen.metric === 'cost' ? 'tokens' : 'cost';
      const reordered = new Map<string, UsageResult>();
      try {
        const targets = [...screen.expanded].filter(([id]) => ['tokens', 'cost'].includes(screen.stepSort?.get(id) ?? 'time'));
        if (targets.length) await ui.task({ kind: 'query', message: t('common.loading_turn_records'), activeTab: 'threads' }, async options => {
          for (const [turnId, steps] of targets) reordered.set(turnId, await queryUsage({ action: 'steps', threadId: screen.request.threadId, turnId, scope: screen.request.scope, sort: metric, offset: steps.page.offset, limit: steps.page.limit, snapshotId: result.snapshotRef.selector ?? result.snapshotRef.snapshotId }, options));
        });
      } catch (error) { notice = error instanceof Error ? error.message : String(error); continue; }
      rememberSelection(screen, choices, answer.selected);
      for (const [turnId, steps] of reordered) { screen.expanded.set(turnId, steps); (screen.stepSort ??= new Map()).set(turnId, metric); }
      screen.metric = metric;
      if (screen.request.sort === 'tokens' || screen.request.sort === 'cost') screen.request.sort = screen.metric;
      screen.request.offset = 0;
      screen.result = undefined; continue;
    }
    if (answer.id === 'presentation') {
      const selectedItem = result.items[Number(choices[answer.selected]?.id.replace('item:', ''))];
      if (selectedItem?.kind === 'usage') screen.anchor = selectedItem;
      if (screen.request.action !== 'usage') continue;
      screen.request.presentation = screen.request.presentation === 'distribution' ? 'details' : 'distribution';
      screen.request.offset = 0; screen.request.limit = reportPageLimit(ui);
      screen.result = undefined; screen.details.clear(); continue;
    }
    if (answer.id === 'group' || answer.id.startsWith('group:')) {
      if (screen.request.action !== 'usage')
        continue;
      const groups = ['day', 'week', 'month'] as const;
      const group = answer.id.startsWith('group:') ? groups[Number(answer.id.slice(6))] : groups[(groups.indexOf(screen.request.group ?? 'day') + 1) % 3];
      if (!group || group === (screen.request.group ?? 'day')) continue;
      screen.request.group = group;
      screen.request.offset = 0;
      screen.request.scope = { ...screen.request.scope, since: undefined, until: undefined, undated: undefined };
      screen.result = undefined;
      screen.details.clear();
      screen.selected = 0;
      continue;
    }
    if (answer.id === 'sort' || answer.id.startsWith('sort:')) {
      if (screen.request.action === 'usage') { screen.request.sort = screen.request.sort === 'tokens' || screen.request.sort === 'cost' ? 'time' : screen.metric ?? 'tokens'; screen.request.offset = 0; screen.result = undefined; screen.selected = 0; continue; }
      const sort = answer.id === 'sort:0' ? screen.metric ?? 'tokens' : answer.id === 'sort:1' ? (screen.request.action === 'threads' ? 'recent' : 'time') : ['tokens', 'cost'].includes(screen.request.sort ?? '') ? (screen.request.action === 'threads' ? 'recent' : 'time') : screen.metric ?? 'tokens';
      if (sort === (screen.request.sort ?? 'tokens')) continue;
      rememberSelection(screen, choices, answer.selected);
      screen.request.sort = sort;
      screen.request.offset = 0;
      screen.result = undefined;
      continue;
    }
    if (answer.id === 'next' || answer.id === 'previous') {
      if (answer.id === 'next' && result.page.nextOffset == null && (result.page.nextOffset !== undefined || result.page.offset + result.items.length >= result.page.total))
        continue;
      screen.request = answer.id === 'next' && result.page.nextOffset != null ? { ...screen.request, offset: result.page.nextOffset } : pageRequest(screen.request, answer.id === 'next', result.page.total);
      screen.result = undefined;
      screen.details.clear();
      screen.selected = 0;
      continue;
    }
    if (answer.id === 'daily') {
      if (!screen.thread)
        continue;
      stack.push(screen);
      screen = { request: { action: 'usage', presentation: 'distribution', limit: reportPageLimit(ui), scope: { timezone, threadId: screen.thread.id } }, selected: 0, expanded: new Map(), details: new Set(), thread: screen.thread, metric: screen.metric };
      tab = 0;
      continue;
    }
    if (answer.id.startsWith('step-sort:') || answer.id.startsWith('step-prev:') || answer.id.startsWith('step-next:')) {
      const prefix = answer.id.slice(0, answer.id.indexOf(':'));
      const target = answer.id.slice(answer.id.indexOf(':') + 1);
      const explicitSort = prefix === 'step-sort' ? /^(time|tokens|cost):/.exec(target)?.[1] as 'time' | 'tokens' | 'cost' | undefined : undefined;
      const turnId = explicitSort ? target.slice(explicitSort.length + 1) : target;
      const previous = screen.expanded.get(turnId)!;
      const stepSort = screen.stepSort ??= new Map();
      const sort = explicitSort ?? (prefix === 'step-sort' ? (stepSort.get(turnId) === 'tokens' ? 'time' : 'tokens') : (stepSort.get(turnId) ?? 'time'));
      const request: UsageRequest = { action: 'steps', threadId: screen.request.threadId, turnId, scope: screen.request.scope, sort, offset: prefix === 'step-next' ? previous.page.offset + previous.page.limit : prefix === 'step-prev' ? Math.max(0, previous.page.offset - previous.page.limit) : 0 };
      try {
        const steps = await ui.task({ kind: 'query', message: t("common.loading_turn_records"), activeTab: 'threads' }, options => queryUsage({ ...request, snapshotId }, options));
        screen.expanded.set(turnId, steps);
        stepSort.set(turnId, sort);
      }
      catch (error) {
        notice = error instanceof Error ? error.message : String(error);
      }
      continue;
    }
    if (answer.id.startsWith('step:')) {
      const key = stepDetailKey(screen, answer.id);
      if (screen.details.has(key))
        screen.details.delete(key);
      else
        screen.details.add(key);
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
      screen = { request: { action: 'threads', limit: reportPageLimit(ui), scope: { ...item.scope, timezone }, sort: screen.metric ?? 'tokens' }, selected: 0, expanded: new Map(), details: new Set(), metric: screen.metric, linked: true };
      tab = 1;
      continue;
    }
    if (item.kind === 'thread') {
      stack.push(screen);
      screen = { request: { action: 'turns', threadId: item.id, scope: { ...scope }, sort: screen.metric ?? 'tokens' }, selected: 0, expanded: new Map(), details: new Set(), thread: item, metric: screen.metric, linked: screen.linked };
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
