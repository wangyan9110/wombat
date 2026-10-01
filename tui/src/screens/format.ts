import { t, locale, labels } from '@wombat/client/locale';
import { terminalText } from '../display-text.js';
import type { UsageItem, UsageResult, UsageSummary } from '@wombat/client';
import type { Choice, TableCell } from '../components/view-model.js';
import { tableTracks } from '../components/table-tracks.js';
export function money(value: string | null | undefined, places = 2): string {
  if (value == null || !/^\d+(?:\.\d+)?$/.test(value))
    return '—';
  const [whole, fraction = ''] = value.split('.');
  const unit = 10n ** BigInt(places);
  const original = BigInt(whole + fraction);
  if (original > 0n && BigInt(whole) === 0n && fraction.slice(0, places).padEnd(places, '0') === '0'.repeat(places))
    return `<$0.${'0'.repeat(places - 1)}1`;
  let scaled = BigInt(whole) * unit + BigInt(fraction.slice(0, places).padEnd(places, '0') || '0');
  if (Number(fraction[places] ?? '0') >= 5)
    scaled += 1n;
  const digits = (scaled / unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${digits}.${(scaled % unit).toString().padStart(places, '0')}`;
}
export function tokens(value: number | null | undefined): string { return value == null ? '—' : value.toLocaleString('en-US'); }
export function reportMoney(value: string | null | undefined): string {
  return money(value, Number(value) > 0 && Number(value) < .01 ? 4 : 2);
}
export function compactTokens(value: number | null | undefined): string {
  return value == null ? '—' : value < 10000 ? tokens(value) : new Intl.NumberFormat(locale.getSnapshot().locale === 'zh' ? 'zh-CN' : 'en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}
export function usageLabel(usage: UsageSummary, detail = false, compact = false): string {
  if (usage.measurementCount === 0) return t("common.no_usage_records");
  const price = usage.price.status === 'unknown' ? t("common.cost_unknown") : (detail ? money(usage.price.cost ?? usage.price.knownCost, 4) : reportMoney(usage.price.cost ?? usage.price.knownCost)) + (usage.price.status === 'partial' ? '*' : '');
  const total = usage.tokens.total;
  const count = compact && total != null && total >= 10000 ? new Intl.NumberFormat(locale.getSnapshot().locale === 'zh' ? 'zh-CN' : 'en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(total) : tokens(total);
  return `${count} ${t('tui.report.token_unit')} · ${price}`;
}
export function metricPair(summary: UsageSummary, metric: 'tokens' | 'cost', detail = false): string {
  if (metric === 'tokens') return usageLabel(summary, detail, true);
  return reportCost(summary) + ' · ' + compactTokens(summary.tokens.total) + ' ' + t('tui.report.token_unit');
}
function dateParts(value: string, timezone: string): Record<string, string> { return Object.fromEntries(new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map(p => [p.type, p.value])); }
export function dateLabel(value: string | null | undefined, reference: string, timezone = 'UTC', withTime = false, precision?: string, forceYear = false): string {
  if (!value)
    return '—';
  if (/^\d{4}-\d{2}$/.test(value)) { const [year, month] = value.split('-'); return locale.getSnapshot().locale === 'en' ? new Intl.DateTimeFormat('en-US', { month: 'short', ...(forceYear || year !== dateParts(reference, timezone).year ? { year: 'numeric' as const } : {}), timeZone: 'UTC' }).format(new Date(value + '-01T00:00:00Z')) : t('date.month', { year: forceYear || year !== dateParts(reference, timezone).year ? year + t('date.year_suffix') : '', month: Number(month) }); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return t("date.month_day", { p0: !forceYear && year === dateParts(reference, timezone).year ? '' : year + t("date.year_suffix"), p1: Number(month), p2: Number(day) });
  }
  if (!Number.isFinite(Date.parse(value)))
    return terminalText(value);
  const p = dateParts(value, timezone);
  const year = !forceYear && p.year === dateParts(reference, timezone).year ? '' : p.year + t("date.year_suffix");
  const showTime = withTime && precision !== 'date' && precision !== 'unknown';
  const showSeconds = precision ? ['second', 'millisecond', 'microsecond', 'nanosecond'].includes(precision) : /T\d{2}:\d{2}:\d{2}/.test(value);
  const fractionalDigits = ({ millisecond: 3, microsecond: 6, nanosecond: 9 } as Record<string, number>)[precision ?? ''] ?? 0;
  const fraction = value.match(/T\d{2}:\d{2}:\d{2}\.(\d+)/)?.[1];
  return t("date.month_day_time", { p0: year, p1: p.month, p2: p.day, p3: showTime ? ` ${p.hour}:${p.minute}${showSeconds ? ':' + p.second : ''}${fractionalDigits && fraction ? '.' + fraction.slice(0, fractionalDigits) : ''}` : '' });
}
export function calendarDateShift(value: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
    return value;
  return new Date(Date.parse(value) + days * 86400000).toISOString().slice(0, 10);
}
export function rangeLabel(since: string | null | undefined, until: string | null | undefined, reference: string, timezone = 'UTC'): string {
  if (!since && !until)
    return t("common.all_dates");
  const end = until && /^\d{4}-\d{2}-\d{2}$/.test(until) ? new Date(Date.parse(until) - 86400000).toISOString().slice(0, 10) : until;
  if (since === end)
    return dateLabel(since, reference, timezone);
  const crossYear = Boolean(since && end && since.slice(0, 4) !== end.slice(0, 4));
  const a = dateLabel(since, reference, timezone, false, undefined, crossYear);
  const b = dateLabel(end, reference, timezone, false, undefined, crossYear);
  if (since && end && since.slice(0, 7) === end.slice(0, 7))
    return t("date.same_month_range", { p0: a, p1: Number(end.slice(8, 10)) });
  return `${since ? a : t("common.start")}—${end ? b : t("common.now")}`;
}
export function activityRange(start: string | null | undefined, end: string | null | undefined, reference: string, timezone: string, withTime = false): string {
  if (!start || !end) return dateLabel(start ?? end, reference, timezone, withTime);
  const a = dateLabel(start, reference, timezone, withTime), b = dateLabel(end, reference, timezone, withTime);
  if (a === b) return a;
  const date = dateLabel(start, reference, timezone);
  return a + '—' + (withTime && date === dateLabel(end, reference, timezone) ? b.slice(date.length + 1) : b);
}
const effortLabels: Record<string, string> = labels({ none: "common.none", minimal: "common.minimal", low: "common.low", medium: "common.medium", high: "common.high", xhigh: "common.extra_high", max: "common.maximum", ultra: "common.ultra" });
export function effort(value: string | null | undefined): string { return value ? effortLabels[value] ?? terminalText(value) : '—'; }
export function modelLabel(model: string | null | undefined, reasoning: string | null | undefined): string { return `${model ?? t("common.unknown_model")} · ${effort(reasoning)}`; }
export function statusLabel(status: string): string { return ({ completed: t("common.completed"), complete: t("common.completed"), success: t("common.completed"), failed: t("common.failed"), error: t("common.failed"), running: t("common.running"), interrupted: t("common.interrupted"), observed: t("common.recorded"), pending: t("common.pending"), started: t("common.start"), aborted: t("common.interrupted"), cancelled: t("common.cancelled"), unknown: '', in_progress: t("common.running") } as Record<string, string>)[status] ?? terminalText(status); }
function percent(value: number | null | undefined): string { return value == null ? '' : value > 0 && value < .001 ? '<0.1%' : `${(value * 100).toFixed(1)}%`; }
export function tableCount(value: number | null | undefined): string {
  const exact = tokens(value);
  if (exact.length <= 12 || value == null)
    return exact;
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}
export function reportCost(summary: UsageSummary): string {
  return summary.price.status === 'unknown' ? t("common.cost_unknown") : reportMoney(summary.price.cost ?? summary.price.knownCost) + (summary.price.status === 'partial' ? '*' : '');
}
function tableCells(values: string[], width: number): TableCell[] {
  // Reserve whole terminal cells for numbers; fractional text tracks can paint
  // beyond their parent in the native renderer. Labels use the remaining space.
  if (width < 68) return values.map((text, index) => ({ text, width: index === 0 ? Math.max(0, width - 27) : index === 1 ? 8 : 12, align: index === 0 ? 'left' : 'right' }));
  const tracks = width >= 120
    ? [{ width: 10 }, { grow: 1.8, minWidth: 15 }, { width: 8 }, ...Array.from({ length: 6 }, (_, i) => ({ grow: .8, minWidth: i === 5 ? 12 : 11 }))]
    : [{ grow: 1.1, minWidth: 10 }, { grow: 1.8, minWidth: 14 }, { width: 8 }, { width: 12 }, { width: 13 }];
  const widths = tableTracks(Math.min(width, 120) - 7 - (tracks.length - 1), tracks);
  return values.map((text, index) => ({ text, width: widths[index], align: index >= 3 ? 'right' : 'left' }));
}
export function usageHeaderCells(width: number, metric: 'tokens' | 'cost' = 'tokens'): TableCell[] {
  if (width < 68) return tableCells([t('common.date') + '/' + t('common.model'), 'Token', t('common.cost_usd')], width);
  return tableCells(width >= 120 ? [t("common.date"), t("common.model"), t("common.effort"), t("common.uncached_input"), t("common.output"), t("common.cache_write"), t("common.cache_read"), t('common.total_tokens'), t("common.cost_usd")] : [t("common.date"), t("common.model"), t("common.effort"), 'Token', t("common.cost_usd")], width);
}
export function usageTotalCells(summary: UsageSummary, width: number): TableCell[] {
  if (width < 68) return tableCells([t('common.total'), compactTokens(summary.tokens.total), reportCost(summary)], width);
  return tableCells([t("common.total"), '', '', ...(width >= 120 ? [summary.tokens.input, summary.tokens.output, summary.tokens.cacheCreate, summary.tokens.cacheRead].map(tableCount) : []), width >= 120 ? tableCount(summary.tokens.total) : compactTokens(summary.tokens.total), reportCost(summary)], width);
}
export type ItemContent = Pick<Choice, 'lines' | 'cells' | 'headline' | 'bar' | 'operation'>;
/** Content and column constraints only; OpenTUI owns wrapping, alignment and layout. */
export function itemContent(item: UsageItem, result: UsageResult, width: number, timestampLabel?: string, metric: 'tokens' | 'cost' = 'tokens', group?: 'day' | 'week' | 'month' | null): ItemContent {
  const reference = result.snapshotRef.createdAt;
  const timezone = result.scope.timezone ?? 'UTC';
  if (item.kind === 'usage') {
    const date = item.date && group === 'month' ? dateLabel(item.date.slice(0, 7), reference, timezone) : item.date ? rangeLabel(item.scope.since, item.scope.until, reference, timezone) : t("common.unknown_date");
    if (width < 68) return { lines: [], cells: tableCells([item.isSubtotal ? `${date} ›` : `↳ ${modelLabel(item.model, item.reasoningEffort)}`, compactTokens(item.usage.tokens.total), reportCost(item.usage)], width).map((cell, index) => ({ ...cell, date: item.isSubtotal && index === 0, stackWhenLong: !item.isSubtotal && index === 0, tone: item.isSubtotal ? 'subtotalForeground' : index === (metric === 'cost' ? 2 : 1) ? 'heading' : index === 0 ? 'tableMarkerForeground' : 'tablePartForeground', bold: item.isSubtotal || index === (metric === 'cost' ? 2 : 1) })) };
    const values = [item.isSubtotal ? date + ' ›' : '↳', item.isSubtotal ? '' : item.model ?? t("common.unknown_model"), item.isSubtotal ? '' : effort(item.reasoningEffort)];
    if (width >= 120) values.push(...[item.usage.tokens.input, item.usage.tokens.output, item.usage.tokens.cacheCreate, item.usage.tokens.cacheRead].map(tableCount));
    values.push(width >= 120 ? tableCount(item.usage.tokens.total) : compactTokens(item.usage.tokens.total), reportCost(item.usage));
    return { lines: [], cells: tableCells(values, width).map((cell, index) => ({ ...cell, date: item.isSubtotal && index === 0, inset: !item.isSubtotal && index < 2 ? 1 : 0, tone: item.isSubtotal ? 'subtotalForeground' : index === values.length - (metric === 'cost' ? 1 : 2) ? 'heading' : index === 0 ? 'tableMarkerForeground' : index === 1 ? 'modelForeground' : 'tablePartForeground', bold: item.isSubtotal || index === values.length - (metric === 'cost' ? 1 : 2) })) };
  }
  if (item.kind === 'thread') {
    const lines = [`${item.project?.split('/').filter(Boolean).at(-1) ?? t("common.unknown_project")} · ${activityRange(item.startedAt, item.lastActivityAt, reference, timezone)}`];
    if (item.matchedUsage.measurementCount !== item.threadUsage.measurementCount) lines.push(t("tui.screens.format.selected_range_value", { p0: usageLabel(item.matchedUsage, false, true) }));
    return { headline: { label: item.title ?? t("common.untitled_thread"), amount: metricPair(item.threadUsage, metric) }, lines };
  }
  if (item.kind === 'turn') {
    const lines = [t(metric === 'cost' && result.summary.price.status === 'partial' ? "tui.screens.format.priced_share" : "tui.screens.format.thread_share_value_value_value", { p0: percent(metric === 'cost' ? item.costShare : item.share) || '—', p1: item.models.join(' / ') || t("common.unknown_model"), p2: item.reasoningEfforts.map(effort).join(' / ') || '—' }),
      `${activityRange(item.startedAt, item.endedAt, reference, timezone, true)} · ${statusLabel(item.status)}`];
    if (item.matchedUsage.measurementCount !== item.usage.measurementCount) lines.push(t("tui.screens.format.filtered_value", { p0: usageLabel(item.matchedUsage, false, true) }));
    return { headline: { label: item.ordinal == null ? t("common.other_records") : t("common.turn_value", { p0: item.ordinal }), amount: metricPair(item.usage, metric) }, lines, ...((metric === 'cost' ? item.costShare : item.share) != null ? { bar: (metric === 'cost' ? item.costShare : item.share)! } : {}) };
  }
  const clock = timestampLabel ?? dateLabel(item.timestamp, reference, timezone, true, item.timePrecision);
  if (item.kind === 'measurement') return { headline: { label: `${clock} · ${modelLabel(item.model, item.reasoningEffort)}`, amount: [metricPair(item.usage, metric, true), percent(metric === 'cost' ? item.costShare : item.share)].filter(Boolean).join(' · ') }, lines: [] };
  const extras = [statusLabel(item.status), item.exitCode != null ? t("common.exit_value", { p0: item.exitCode }) : '', item.durationMs != null ? `${item.durationMs} ms` : ''].filter(Boolean).join(' · ');
  return { operation: { time: clock, name: item.operationType === 'skillRead' ? t('tui.screens.format.read_skill', { name: item.name }) : item.operationType === 'mcp' ? t('tui.screens.format.call_mcp', { name: item.name }) : item.name, result: extras }, lines: [item.server, item.tool, item.path].filter(Boolean).length ? [[item.server, item.tool, item.path].filter(Boolean).join(' · ')] : [] };
}
export const categoryLabels: Record<string, string> = labels({ input: "common.uncached_input", cacheRead: "common.cache_read", cacheCreate: "common.cache_write", output: "common.output", reasoning: "common.reasoning_portion", cache_read: "common.cache_read", cache_create: "common.cache_write" });
export function summaryMetrics(summary: UsageSummary): Array<{ label: string; value: string; amount?: string }> {
  const categories = ['input', 'cacheRead', 'cacheCreate', 'output'] as const;
  return [...categories.map(category => {
    const component = summary.price.components.find(part => part.category === category || part.category === ({ cacheRead: 'cache_read', cacheCreate: 'cache_create' } as Record<string, string>)[category]);
    return { label: categoryLabels[category], value: `${tokens(summary.tokens[category])} ${t('tui.report.token_unit')}`, amount: component?.status === 'partial' ? money(component.knownCost, 4) + '*' : component?.cost == null ? t("common.cost_unknown") : money(component.cost, 4) };
  }), ...(summary.tokens.reasoning == null ? [] : [{ label: t("common.reasoning_portion"), value: `${tokens(summary.tokens.reasoning)} ${t('tui.report.token_unit')}` }])];
}
export function summaryDetails(summary: UsageSummary): string[] {
  return summaryMetrics(summary).map(metric => `${metric.label}  ${metric.value}${metric.amount == null ? '' : ' · ' + metric.amount}`);
}
