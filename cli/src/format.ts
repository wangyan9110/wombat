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
  if (usage.measurementCount === 0) return '暂无用量记录';
  const price = usage.price.status === 'unknown' ? '费用未知' : money(usage.price.cost ?? usage.price.knownCost, detail ? 4 : 2) + (usage.price.status === 'partial' ? '*' : '');
  const total = usage.tokens.total;
  const count = compact && total != null && total >= 10000 ? Number((total / (total >= 100000000 ? 100000000 : 10000)).toFixed(2)) + (total >= 100000000 ? '亿' : '万') : tokens(total);
  return `${count} Token · ${price}`;
}
function dateParts(value: string, timezone: string): Record<string, string> { return Object.fromEntries(new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map(p => [p.type, p.value])); }
export function dateLabel(value: string | null | undefined, reference: string, timezone = 'UTC', withTime = false, precision?: string): string {
  if (!value)
    return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return `${year === dateParts(reference, timezone).year ? '' : year + '年'}${Number(month)}月${Number(day)}日`;
  }
  if (!Number.isFinite(Date.parse(value)))
    return terminalText(value);
  const p = dateParts(value, timezone);
  const year = p.year === dateParts(reference, timezone).year ? '' : p.year + '年';
  const showTime = withTime && precision !== 'date' && precision !== 'unknown';
  const showSeconds = precision ? ['second', 'millisecond', 'microsecond', 'nanosecond'].includes(precision) : /T\d{2}:\d{2}:\d{2}/.test(value);
  const fractionalDigits = ({ millisecond: 3, microsecond: 6, nanosecond: 9 } as Record<string, number>)[precision ?? ''] ?? 0;
  const fraction = value.match(/T\d{2}:\d{2}:\d{2}\.(\d+)/)?.[1];
  return `${year}${p.month}月${p.day}日${showTime ? ` ${p.hour}:${p.minute}${showSeconds ? ':' + p.second : ''}${fractionalDigits && fraction ? '.' + fraction.slice(0, fractionalDigits) : ''}` : ''}`;
}
export function calendarDateShift(value: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
    return value;
  return new Date(Date.parse(value) + days * 86400000).toISOString().slice(0, 10);
}
export function rangeLabel(since: string | null | undefined, until: string | null | undefined, reference: string, timezone = 'UTC'): string {
  if (!since && !until)
    return '全部日期';
  const end = until && /^\d{4}-\d{2}-\d{2}$/.test(until) ? new Date(Date.parse(until) - 86400000).toISOString().slice(0, 10) : until;
  if (since === end)
    return dateLabel(since, reference, timezone);
  const a = dateLabel(since, reference, timezone);
  const b = dateLabel(end, reference, timezone);
  if (since && end && since.slice(0, 7) === end.slice(0, 7))
    return `${a}—${Number(end.slice(8, 10))}日`;
  return `${since ? a : '开始'}—${end ? b : '现在'}`;
}
function activityRange(start: string | null | undefined, end: string | null | undefined, reference: string, timezone: string, withTime = false): string {
  if (!start || !end) return dateLabel(start ?? end, reference, timezone, withTime);
  const a = dateLabel(start, reference, timezone, withTime), b = dateLabel(end, reference, timezone, withTime);
  if (a === b) return a;
  const date = dateLabel(start, reference, timezone);
  return a + '—' + (withTime && date === dateLabel(end, reference, timezone) ? b.slice(date.length + 1) : b);
}
const effortLabels: Record<string, string> = { none: '无', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高', ultra: '超高' };
export function effort(value: string | null | undefined): string { return value ? effortLabels[value] ?? terminalText(value) : '—'; }
function modelLabel(model: string | null | undefined, reasoning: string | null | undefined): string { return `${model ?? '模型未知'} · ${effort(reasoning)}`; }
function statusLabel(status: string): string { return ({ completed: '完成', complete: '完成', success: '完成', failed: '失败', error: '失败', running: '进行中', interrupted: '已中断', observed: '已记录', pending: '等待中', started: '开始', aborted: '已中断', cancelled: '已取消', unknown: '', in_progress: '进行中' } as Record<string, string>)[status] ?? terminalText(status); }
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
  return width >= 110 ? [12, Math.max(18, width - 94), 8, 11, 10, 10, 11, 12, 12] : [12, Math.max(17, width - 50), 8, 13, 13];
}
function usageCells(values: string[], width: number): string {
  return values.map((value, i) => pad(value, usageColumns(width)[i], i >= 3)).join(' ');
}
export function usageTableHeader(width = 116): string {
  if (width < 68) return pad('日期 / 模型 · 强度', width - 16) + pad('Token · 费用', 16, true);
  return usageCells(width >= 110 ? ['日期', '模型', '推理强度', '输入', '输出', '缓存创建', '缓存读取', '总 Token', '金额（美元）'] : ['日期', '模型', '推理强度', 'Token', '金额（美元）'], width);
}
function reportCost(summary: UsageSummary): string {
  return summary.price.status === 'unknown' ? '费用未知' : money(summary.price.cost ?? summary.price.knownCost) + (summary.price.status === 'partial' ? '*' : '');
}
function headline(left: string, right: string, width: number, preserveLeft = false): string[] {
  const available = width - stringWidth(right) - 2;
  return available >= 12 && (!preserveLeft || stringWidth(left) <= available) ? [pad(left, available) + '  ' + right] : [left, '  ' + right];
}
export function itemLines(item: UsageItem, result: UsageResult, width: number): string[] {
  const reference = result.snapshotRef.createdAt;
  const timezone = result.scope.timezone ?? 'UTC';
  if (item.kind === 'usage') {
    const date = item.date ? rangeLabel(item.scope.since, item.scope.until, reference, timezone) : '日期未知';
    const name = item.isSubtotal ? `${date} ›` : `↳ ${modelLabel(item.model, item.reasoningEffort)}`;
    if (width < 68) return [name, `  ${usageLabel(item.usage, false, true)}`];
    const cells = [item.isSubtotal ? date + ' ›' : '  ↳', item.isSubtotal ? '' : item.model ?? '模型未知', item.isSubtotal ? '' : effort(item.reasoningEffort)];
    if (width >= 110) cells.push(...[item.usage.tokens.input, item.usage.tokens.output, item.usage.tokens.cacheCreate, item.usage.tokens.cacheRead].map(tableCount));
    cells.push(tableCount(item.usage.tokens.total), reportCost(item.usage));
    const widths = usageColumns(width);
    const wrapped = cells.map((cell, index) => wrapDisplay(cell, widths[index]));
    return Array.from({ length: Math.max(...wrapped.map(lines => lines.length)) }, (_, line) => usageCells(wrapped.map(lines => lines[line] ?? ''), width));
  }
  if (item.kind === 'thread') {
    const lines = [...headline(item.title ?? '未命名对话', usageLabel(item.threadUsage, false, true), width),
      `  ${item.project?.split('/').filter(Boolean).at(-1) ?? '项目未知'} · ${activityRange(item.startedAt, item.lastActivityAt, reference, timezone)}`,
      `  ${item.models.join(' / ') || '模型未知'} · ${item.reasoningEfforts.map(effort).join(' / ') || '—'}`];
    if (item.matchedUsage.measurementCount !== item.threadUsage.measurementCount) lines.push(`  所选范围 ${usageLabel(item.matchedUsage, false, true)}`);
    return lines;
  }
  if (item.kind === 'turn') {
    const lines = [...headline(item.ordinal == null ? '其他记录' : `第 ${item.ordinal} 轮`, usageLabel(item.usage, false, true), width - 2),
      `  占对话 ${percent(item.share) || '—'} · ${item.models.join(' / ') || '模型未知'} · ${item.reasoningEfforts.map(effort).join(' / ') || '—'}`,
      `  ${activityRange(item.startedAt, item.endedAt, reference, timezone, true)}  ${statusLabel(item.status)}`];
    if (width >= 68 && item.share != null) {
      const size = Math.max(1, width - 2), filled = Math.round(Math.max(0, Math.min(1, item.share)) * size);
      lines.push('  ' + '━'.repeat(filled) + '─'.repeat(size - filled));
    }
    if (item.matchedUsage.measurementCount !== item.usage.measurementCount) lines.push(`  筛选内 ${usageLabel(item.matchedUsage, false, true)}`);
    return lines;
  }
  if (item.kind === 'measurement')
    return headline(`${dateLabel(item.timestamp, reference, timezone, true, item.timePrecision)} · ${modelLabel(item.model, item.reasoningEffort)}`, `${usageLabel(item.usage, true, true)} · ${percent(item.share)}`, width, true);
  const extras = [statusLabel(item.status), item.exitCode != null ? `退出 ${item.exitCode}` : '', item.durationMs != null ? `${item.durationMs} ms` : ''].filter(Boolean).join(' · ');
  return [...headline(`${dateLabel(item.timestamp, reference, timezone, true, item.timePrecision)}  ${item.name}`, extras, width), ...([item.server, item.tool, item.path].filter(Boolean).length ? ['  ' + [item.server, item.tool, item.path].filter(Boolean).join(' · ')] : [])];
}
const categoryLabels: Record<string, string> = { input: '非缓存输入', cacheRead: '缓存读取', cacheCreate: '缓存创建', output: '输出', reasoning: '其中推理', cache_read: '缓存读取', cache_create: '缓存创建' };
export function summaryDetails(summary: UsageSummary): string[] {
  const categories = ['input', 'cacheRead', 'cacheCreate', 'output'] as const;
  return [...categories.map(category => { const component = summary.price.components.find(part => part.category === category || part.category === ({ cacheRead: 'cache_read', cacheCreate: 'cache_create' } as Record<string, string>)[category]); return `${categoryLabels[category]}  ${tokens(summary.tokens[category])} Token · ${component?.status === 'partial' ? money(component.knownCost, 4) + '*' : component?.cost == null ? '费用未知' : money(component.cost, 4)}`; }), `其中推理  ${tokens(summary.tokens.reasoning)} Token`];
}
function qualityLine(result: UsageResult): string | undefined { return result.quality.status === 'partial' ? `数据状态：${result.quality.issues[0]?.message ?? '请查看数据说明'}` : undefined; }
export function renderUsageResult(result: UsageResult, width = 120): string {
  const title = { refresh: '已更新', usage: '用量', threads: '对话', turns: '轮次', steps: '记录' }[result.action];
  const lines = [`Wombat · ${title}`, `更新于 ${dateLabel(result.snapshotRef.createdAt, result.snapshotRef.createdAt, result.scope.timezone ?? 'UTC', true)}`, rangeLabel(result.scope.since, result.scope.until, result.snapshotRef.createdAt, result.scope.timezone ?? 'UTC'), usageLabel(result.summary), ''];
  if (result.action === 'usage' && width >= 110)
    lines.push(usageTableHeader(width));
  for (const item of result.items)
    lines.push(...itemLines(item, result, width));
  if (!result.items.length)
    lines.push(result.action === 'refresh' ? '记录已保存' : result.page.total > 0 ? `当前页无记录（共 ${result.page.total} 条）` : '暂无记录');
  if (result.items.length > 0 && result.page.total > result.items.length)
    lines.push(`${result.page.offset + 1}—${result.page.offset + result.items.length} / ${result.page.total}`);
  const quality = qualityLine(result);
  if (quality)
    lines.push('', quality);
  if (result.summary.price.status === 'partial')
    lines.push('* 金额为已计价小计');
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
