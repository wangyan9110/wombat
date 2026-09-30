import { t, labels } from '@wombat/client/locale';
import type { UsageRequest } from '@wombat/client';
import type { FormSpec, FormAnswer, FormField } from '../components/form-model.js';
import type { FilterOptions } from './filter-options.js';

interface FilterUI { form: (spec: FormSpec) => Promise<FormAnswer>; }
export interface FilterResult { request: UsageRequest; navigate?: 'usage-tab' | 'threads-tab'; }
type Period = 'today' | 'recent' | 'week' | 'month' | 'custom';
const periodNames: Record<Period, string> = labels({ today: "tui.state.filters.today", recent: "tui.state.filters.last_7_days", week: "tui.state.filters.this_week", month: "tui.state.filters.this_month", custom: "tui.state.filters.custom" });
const effortNames: Record<string, string> = labels({ none: "common.none", minimal: "common.minimal", low: "common.low", medium: "common.medium", high: "common.high", xhigh: "common.extra_high", max: "common.maximum", ultra: "common.ultra" });
const unknownModel = '\u0000unknown-model';
function validDay(day: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day; }
function shift(day: string, days: number): string { return new Date(Date.parse(day) + days * 86400000).toISOString().slice(0, 10); }
function localDay(reference: string, timezone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(reference)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function periodDates(period: Exclude<Period, 'custom'>, today: string): { since: string; until: string } {
  const mondayOffset = (new Date(today).getUTCDay() + 6) % 7;
  return { since: period === 'today' ? today : period === 'recent' ? shift(today, -6) : period === 'week' ? shift(today, -mondayOffset) : today.slice(0, 8) + '01', until: shift(today, 1) };
}
/** UI dates include the final day; the shared request keeps its exclusive endpoint. */
export async function editTerminalFilters(request: UsageRequest, reference: string, ui: FilterUI, candidates?: FilterOptions, loadError?: string): Promise<FilterResult> {
  const scope = request.scope ?? {}, isUsage = request.action === 'usage';
  const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  let period: string = scope.undated ? 'undated' : !scope.since && !scope.until ? 'auto' : 'custom';
  if (isUsage && !scope.undated) for (const value of ['today', 'recent', 'week', 'month'] as const) {
    const range = periodDates(value, localDay(reference, scope.timezone || defaultTimezone));
    if (range.since === scope.since && range.until === scope.until) { period = value; break; }
  }
  let values: Record<string, string> = { period, since: scope.since ?? '', until: scope.until && validDay(scope.until) ? shift(scope.until, -1) : scope.until ?? '',
    model: candidates && scope.modelUnknown ? unknownModel : scope.model ?? '', project: scope.project ?? '', reasoningEffort: scope.reasoningEffort ?? '', timezone: scope.timezone ?? defaultTimezone, search: request.search ?? '' };
  let advancedOpen = Boolean(scope.model || scope.project || scope.reasoningEffort), error: string | undefined = loadError, focusId: string | undefined;
  const touched = new Set<string>();
  for (;;) {
    const choiceField = (id: 'project' | 'model', label: string): FormField => {
      const placeholder = id === 'model' && scope.modelUnknown && !touched.has('model') ? t("common.unknown_model") : t("common.all");
      if (!candidates) return { id, label, placeholder };
      const choices = new Set(id === 'project' ? candidates.projects : candidates.models);
      if (values[id] && values[id] !== unknownModel) choices.add(values[id]);
      return { id, label, options: [{ value: '', label: t("common.all") }, ...(id === 'model' && scope.modelUnknown ? [{ value: unknownModel, label: t("common.unknown_model") }] : []), ...[...choices].sort().map(value => ({ value, label: value }))] };
    };
    const advancedFields: FormField[] = [
    choiceField('project', t("common.project")),
    choiceField('model', t("common.model")),
    { id: 'reasoningEffort', label: t("common.effort"), options: [{ value: '', label: scope.effortUnknown && !touched.has('reasoningEffort') ? t("tui.state.filters.unknown_effort") : t("common.all") }, ...Object.entries(effortNames).map(([value, label]) => ({ value, label })), ...(scope.reasoningEffort && !Object.hasOwn(effortNames, scope.reasoningEffort) ? [{ value: scope.reasoningEffort, label: scope.reasoningEffort }] : [])] },
    { id: 'timezone', label: t("tui.state.filters.time_zone") },
    ];
    const fields: FormField[] = isUsage ? [{ id: 'period', label: t("tui.state.filters.time"), options: [
      { value: 'auto', label: scope.threadId ? t("tui.state.filters.full_thread_range") : t("tui.state.filters.follow_report") },
      ...(['today', 'recent', 'week', 'month', 'custom'] as const).map(value => ({ value, label: periodNames[value] })),
      ...(scope.undated ? [{ value: 'undated', label: t("common.unknown_date") }] : []),
    ] }] : [{ id: 'search', label: t("tui.state.filters.search_title_project"), placeholder: t("common.all") }, choiceField('project', t("common.project"))];
    if (isUsage && values.period === 'custom') fields.push({ id: 'since', label: t("tui.state.filters.from"), placeholder: 'YYYY-MM-DD' }, { id: 'until', label: t("tui.state.filters.to"), placeholder: 'YYYY-MM-DD' });
    const answer = await ui.form({ title: t("tui.state.filters.wombat_filters"), activeTab: isUsage ? 'usage' : 'threads', values, fields,
      ...(isUsage ? { advancedFields, advancedOpen } : {}), error: error ?? loadError, focusId });
    if (answer.action === 'cancel') return { request };
    if (answer.action === 'usage-tab' || answer.action === 'threads-tab') return { request, navigate: answer.action };
    const previousPeriod = values.period;
    values = { ...values, ...answer.values }; answer.changed.forEach(id => touched.add(id)); focusId = answer.focusId; error = undefined;
    const timezone = values.timezone.trim() || defaultTimezone;
    if (answer.action === 'toggle') { advancedOpen = !advancedOpen; continue; }
    if (answer.action === 'change') {
      if (values.period !== previousPeriod && ['today', 'recent', 'week', 'month'].includes(values.period)) {
        try {
          const dates = periodDates(values.period as 'today', localDay(reference, timezone));
          values.since = dates.since; values.until = shift(dates.until, -1);
        } catch { error = t("common.enter_a_valid_time_zone"); advancedOpen = true; focusId = 'timezone'; }
      }
      continue;
    }
    const draft: UsageRequest = { ...request, scope: { ...scope }, offset: 0 };
    const next = draft.scope!;
    if (isUsage) {
      try { localDay(reference, timezone); } catch { error = t("common.enter_a_valid_time_zone"); advancedOpen = true; focusId = 'timezone'; continue; }
      if (touched.has('timezone')) { if (values.timezone.trim()) next.timezone = timezone; else delete next.timezone; }
      if (values.period === 'auto' && touched.has('period')) {
        delete next.since; delete next.until; delete next.undated;
      } else if (values.period === 'custom' && ['period', 'since', 'until'].some(id => touched.has(id))) {
        const since = values.since.trim(), until = values.until.trim();
        if (!since && !until) { error = t("tui.state.filters.enter_a_start_or_end_date"); focusId = 'since'; continue; }
        if ([since, until].some(day => day && !validDay(day))) { error = t("tui.state.filters.use_yyyy_mm_dd_date_format"); focusId = since && !validDay(since) ? 'since' : 'until'; continue; }
        if (since && until && since > until) { error = t("tui.state.filters.the_end_date_cannot_precede_the"); focusId = 'until'; continue; }
        if (since) next.since = since; else delete next.since;
        if (until) next.until = shift(until, 1); else delete next.until;
        delete next.undated;
      } else if (['today', 'recent', 'week', 'month'].includes(values.period) && (touched.has('period') || touched.has('timezone'))) { Object.assign(next, periodDates(values.period as 'today', localDay(reference, timezone))); delete next.undated; }
      for (const key of ['model', 'reasoningEffort'] as const) if (touched.has(key)) {
        if (key === 'model' && candidates && values.model === unknownModel) { next.modelUnknown = true; delete next.model; continue; }
        const value = values[key].trim(); if (value) next[key] = value; else delete next[key];
        delete next[key === 'model' ? 'modelUnknown' : 'effortUnknown'];
      }
    } else if (touched.has('search')) { if (values.search.trim()) draft.search = values.search.trim(); else delete draft.search; }
    if (touched.has('project')) { if (values.project.trim()) next.project = values.project.trim(); else delete next.project; }
    return { request: draft };
  }
}
