import { automaticPriceText, pricingIssueText, tokenSummaryText, tokenSummaryPresentation, type SummaryTokenField } from '@wombat/client/locale';
import { t, locale, labels, monthLabel } from '@wombat/client/locale';
import stringWidth from 'string-width';
import { terminalText } from './display-text.js';
import type { UsageItem, UsageResult, UsageSummary } from '@wombat/client';
export function fit(text: string, width: number): string {
  const safe = terminalText(text);
  if (stringWidth(safe) <= width)
    return safe;
  let result = '';
  for (const { segment } of new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(safe)) {
    if (stringWidth(result + segment) > width - 1)
      break;
    result += segment;
  }
  return width > 0 ? result + '…' : '';
}
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
export function usageLabel(usage: UsageSummary, detail = false, compact = false): string {
  if (usage.measurementCount === 0) return t("common.no_usage_records");
  const price = usage.price.status === 'unknown' ? t("common.cost_unknown") : money(usage.price.cost ?? usage.price.knownCost, detail ? 4 : 2) + (usage.price.status === 'partial' ? '*' : '');
  const count = tokenSummaryText(usage, 'total', compact);
  return `${count} Token · ${price}`;
}
function dateParts(value: string, timezone: string): Record<string, string> { return Object.fromEntries(new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map(p => [p.type, p.value])); }
export function dateLabel(value: string | null | undefined, reference: string, timezone = 'UTC', withTime = false, precision?: string): string {
  if (!value)
    return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return t("date.month_day", { p0: year === dateParts(reference, timezone).year ? '' : year + t("date.year_suffix"), p1: Number(month), p2: Number(day) });
  }
  if (!Number.isFinite(Date.parse(value)))
    return terminalText(value);
  const p = dateParts(value, timezone);
  const year = p.year === dateParts(reference, timezone).year ? '' : p.year + t("date.year_suffix");
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
  const a = dateLabel(since, reference, timezone);
  const b = dateLabel(end, reference, timezone);
  if (since && end && since.slice(0, 7) === end.slice(0, 7))
    return t("date.same_month_range", { p0: a, p1: Number(end.slice(8, 10)) });
  return `${since ? a : t("common.start")}—${end ? b : t("common.now")}`;
}
function activityRange(start: string | null | undefined, end: string | null | undefined, reference: string, timezone: string, withTime = false): string {
  if (!start || !end) return dateLabel(start ?? end, reference, timezone, withTime);
  const a = dateLabel(start, reference, timezone, withTime), b = dateLabel(end, reference, timezone, withTime);
  if (a === b) return a;
  const date = dateLabel(start, reference, timezone);
  return a + '—' + (withTime && date === dateLabel(end, reference, timezone) ? b.slice(date.length + 1) : b);
}
const effortLabels: Record<string, string> = labels({ none: "common.none", minimal: "common.minimal", low: "common.low", medium: "common.medium", high: "common.high", xhigh: "common.extra_high", max: "common.maximum", ultra: "common.ultra" });
export function effort(value: string | null | undefined): string { return value ? effortLabels[value] ?? terminalText(value) : '—'; }
function modelLabel(model: string | null | undefined, reasoning: string | null | undefined): string { return `${model ?? t("common.unknown_model")} · ${effort(reasoning)}`; }
function statusLabel(status: string): string { return ({ completed: t("common.completed"), complete: t("common.completed"), success: t("common.completed"), failed: t("common.failed"), error: t("common.failed"), running: t("common.running"), interrupted: t("common.interrupted"), observed: t("common.recorded"), pending: t("common.pending"), started: t("common.start"), aborted: t("common.interrupted"), cancelled: t("common.cancelled"), unknown: '', in_progress: t("common.running") } as Record<string, string>)[status] ?? terminalText(status); }
function percent(value: number | null | undefined): string { return value == null ? '' : `${(value * 100).toFixed(1)}%`; }
function tableCount(value: number | null | undefined): string {
  const exact = tokens(value);
  if (exact.length <= 12 || value == null)
    return exact;
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}
function pad(value: string, width: number, right = false): string {
  const truncated = fit(value, width);
  const spaces = ' '.repeat(Math.max(0, width - stringWidth(truncated)));
  return right ? spaces + truncated : truncated + spaces;
}
function usageColumns(width: number): number[] {
  // Preserve the model and amount at every width; detailed counters need a wide terminal.
  const costWidth = Math.max(width >= 110 ? 12 : 13, stringWidth(t('common.cost_unknown')));
  return width >= 110 ? [12, Math.max(18, width - 82 - costWidth), 8, 11, 10, 10, 11, 12, costWidth] : [12, Math.max(17, width - 37 - costWidth), 8, 13, costWidth];
}
function usageCells(values: string[], width: number): string {
  return values.map((value, i) => pad(value, usageColumns(width)[i], i >= 3)).join(' ');
}
export function usageTableHeader(width = 116): string {
  if (width < 68) return pad(t("cli.format.date_model_effort"), width - 16) + pad(t("cli.format.tokens_cost"), 16, true);
  return usageCells(width >= 110 ? [t("common.date"), t("common.model"), t("common.effort"), t("common.input"), t("common.output"), t("common.cache_write"), t("common.cache_read"), t("common.total_tokens"), t("common.cost_usd")] : [t("common.date"), t("common.model"), t("common.effort"), 'Token', t("common.cost_usd")], width);
}
function tokenTableCell(summary: UsageSummary, field: SummaryTokenField): string {
  const value = tokenSummaryPresentation(summary, field);
  return `${tableCount(value.value)}${value.state === 'partial' ? '*' : ''}`;
}
function tokenCoverageLines(summary: UsageSummary, width: number, fields: readonly SummaryTokenField[] = ['total']): string[] {
  return fields.flatMap(field => {
    const value = tokenSummaryPresentation(summary, field);
    return value.state === 'partial' || value.state === 'unavailable'
      ? wrapDisplay(`${field === 'total' ? 'Token' : categoryLabels[field] ?? field}: ${value.qualifier || value.unavailable} · ${value.description}`, width)
      : [];
  });
}
function reportCost(summary: UsageSummary): string {
  return summary.price.status === 'unknown' ? t("common.cost_unknown") : money(summary.price.cost ?? summary.price.knownCost) + (summary.price.status === 'partial' ? '*' : '');
}
function headline(left: string, right: string, width: number, preserveLeft = false): string[] {
  const available = width - stringWidth(right) - 2;
  return available >= 12 && (!preserveLeft || stringWidth(left) <= available) ? [pad(left, available) + '  ' + right] : [left, '  ' + right];
}
export function itemLines(item: UsageItem, result: UsageResult, width: number, group?: 'day' | 'week' | 'month'): string[] {
  const reference = result.snapshotRef.createdAt;
  const timezone = result.scope.timezone ?? 'UTC';
  if (item.kind === 'usage') {
    if (!result.distribution && item.date == null && item.isSubtotal) return [...headline(item.scope.project ?? (item.scope.projectUnknown ? t('webui.unassigned') : item.model ?? t('common.unknown_model')), usageLabel(item.usage, false, true), width), ...tokenCoverageLines(item.usage, width)];
    const date = item.date ? group==='month'?monthLabel(item.date):rangeLabel(item.scope.since, item.scope.until, reference, timezone) : t("common.unknown_date");
    const name = item.isSubtotal ? `${date} ›` : `↳ ${modelLabel(item.model, item.reasoningEffort)}`;
    if (width < 68) return [name, `  ${usageLabel(item.usage, false, true)}`, ...tokenCoverageLines(item.usage, width)];
    const cells = [item.isSubtotal ? date + ' ›' : '  ↳', item.isSubtotal ? '' : item.model ?? t("common.unknown_model"), item.isSubtotal ? '' : effort(item.reasoningEffort)];
    if (width >= 110) cells.push(...(['input', 'output', 'cacheCreate', 'cacheRead'] as const).map(field => tokenTableCell(item.usage, field)));
    cells.push(tokenTableCell(item.usage, 'total'), reportCost(item.usage));
    const widths = usageColumns(width);
    const wrapped = cells.map((cell, index) => wrapDisplay(cell, widths[index]));
    return [...Array.from({ length: Math.max(...wrapped.map(lines => lines.length)) }, (_, line) => usageCells(wrapped.map(lines => lines[line] ?? ''), width)), ...tokenCoverageLines(item.usage, width, width >= 110 ? ['input', 'output', 'cacheCreate', 'cacheRead', 'total'] : ['total'])];
  }
  if (item.kind === 'thread') {
    const lines = [...headline(item.title ?? t("common.untitled_thread"), usageLabel(item.threadUsage, false, true), width),
      `  ${item.project?.split('/').filter(Boolean).at(-1) ?? t("common.unknown_project")} · ${activityRange(item.startedAt, item.lastActivityAt, reference, timezone)}`,
      `  ${item.models.join(' / ') || t("common.unknown_model")} · ${item.reasoningEfforts.map(effort).join(' / ') || '—'}`];
    if (item.matchedUsage.measurementCount !== item.threadUsage.measurementCount) lines.push(t("cli.format.selected_range_value", { p0: usageLabel(item.matchedUsage, false, true) }));
    return [...lines, ...tokenCoverageLines(item.threadUsage, width), ...(item.matchedUsage.measurementCount !== item.threadUsage.measurementCount ? tokenCoverageLines(item.matchedUsage, width) : [])];
  }
  if (item.kind === 'turn') {
    const lines = [...headline(item.ordinal == null ? t("common.other_records") : t("common.turn_value", { p0: item.ordinal }), usageLabel(item.usage, false, true), width - 2),
      t("cli.format.thread_share_value_value_value", { p0: percent(item.share) || '—', p1: item.models.join(' / ') || t("common.unknown_model"), p2: item.reasoningEfforts.map(effort).join(' / ') || '—' }),
      `  ${activityRange(item.startedAt, item.endedAt, reference, timezone, true)}  ${statusLabel(item.status)}`];
    if (width >= 68 && item.share != null) {
      const size = Math.max(1, width - 2), filled = Math.round(Math.max(0, Math.min(1, item.share)) * size);
      lines.push('  ' + '━'.repeat(filled) + '─'.repeat(size - filled));
    }
    if (item.matchedUsage.measurementCount !== item.usage.measurementCount) lines.push(t("cli.format.filtered_value", { p0: usageLabel(item.matchedUsage, false, true) }));
    return [...lines, ...tokenCoverageLines(item.usage, width), ...(item.matchedUsage.measurementCount !== item.usage.measurementCount ? tokenCoverageLines(item.matchedUsage, width) : [])];
  }
  if (item.kind === 'measurement')
    return [...headline(`${dateLabel(item.timestamp, reference, timezone, true, item.timePrecision)} · ${modelLabel(item.model, item.reasoningEffort)}`, `${usageLabel(item.usage, true, true)} · ${percent(item.share)}`, width, true), ...tokenCoverageLines(item.usage, width)];
  const extras = [statusLabel(item.status), item.exitCode != null ? t("common.exit_value", { p0: item.exitCode }) : '', item.durationMs != null ? `${item.durationMs} ms` : ''].filter(Boolean).join(' · ');
  return [...headline(`${dateLabel(item.timestamp, reference, timezone, true, item.timePrecision)}  ${item.name}`, extras, width), ...([item.server, item.tool, item.path].filter(Boolean).length ? ['  ' + [item.server, item.tool, item.path].filter(Boolean).join(' · ')] : [])];
}
const categoryLabels: Record<string, string> = labels({ input: "common.uncached_input", cacheRead: "common.cache_read", cacheCreate: "common.cache_write", output: "common.output", reasoning: "common.reasoning_portion", cache_read: "common.cache_read", cache_create: "common.cache_write" });
export function summaryDetails(summary: UsageSummary): string[] {
  const categories = ['input', 'cacheRead', 'cacheCreate', 'output'] as const;
  return [...categories.map(category => { const component = summary.price.components.find(part => part.category === category || part.category === ({ cacheRead: 'cache_read', cacheCreate: 'cache_create' } as Record<string, string>)[category]); return `${categoryLabels[category]}  ${tokenSummaryText(summary, category)} Token · ${component?.status === 'partial' ? money(component.knownCost, 4) + '*' : component?.cost == null ? t("common.cost_unknown") : money(component.cost, 4)}`; }), t("cli.format.reasoning_portion_value_tokens", { p0: tokenSummaryText(summary, 'reasoning') })];
}
function qualityLine(result: UsageResult): string | undefined { return result.quality.status === 'partial' ? t("cli.format.data_status_value", { p0: result.quality.issues[0]?.message ?? t("cli.format.see_data_notes") }) : undefined; }
export function renderUsageResult(result: UsageResult, width = 120, group?: 'day' | 'week' | 'month'): string {
  const title = { refresh: t("cli.format.updated"), usage: t("cli.format.usage"), threads: t("common.threads"), turns: t("cli.format.turns"), steps: t("cli.format.records") }[result.action];
  const lines = [`Wombat · ${title}`, t("common.updated_value", { p0: dateLabel(result.snapshotRef.createdAt, result.snapshotRef.createdAt, result.scope.timezone ?? 'UTC', true) }), rangeLabel(result.scope.since, result.scope.until, result.snapshotRef.createdAt, result.scope.timezone ?? 'UTC'), usageLabel(result.summary), ...tokenCoverageLines(result.summary, width), ''];
  if (result.action === 'usage' && result.distribution && width >= 110)
    lines.push(usageTableHeader(width));
  for (const item of result.items)
    lines.push(...itemLines(item, result, width, group));
  if (!result.items.length)
    lines.push(result.action === 'refresh' ? t("cli.format.records_saved") : result.page.total > 0 ? t("cli.format.no_records_on_this_page_value", { p0: result.page.total }) : t("common.no_records"));
  if (result.items.length > 0 && result.page.total > result.items.length)
    lines.push(`${result.page.offset + 1}—${result.page.offset + result.items.length} / ${result.page.total}`);
  if (result.summary.price.issues.length) lines.push(...result.summary.price.issues.map(pricingIssueText));
  const priceUpdate = automaticPriceText(result);
  if (priceUpdate) lines.push('', priceUpdate);
  const quality = qualityLine(result);
  if (quality)
    lines.push('', quality);
  if (result.summary.price.status === 'partial')
    lines.push(t("cli.format.amount_is_the_priced_subtotal"));
  return lines.map(line => fit(line, width)).join('\n');
}
function wrapDisplay(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const { segment } of new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(terminalText(text))) {
    if (line && stringWidth(line + segment) > width) { lines.push(line); line = ''; }
    line += segment;
  }
  return [...lines, line];
}
