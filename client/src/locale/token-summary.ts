/** Present Rust-owned quantities and coverage without rebuilding token totals. */
import type { UsageSummary } from '../generated/usage-app.js';
import { t, locale } from './index.js';

export type SummaryTokenField = keyof UsageSummary['tokenAnalysis']['fields'];
export function tokenSummaryPresentation(summary: UsageSummary, field: SummaryTokenField = 'total') {
  const coverage = summary.tokenAnalysis.fields[field];
  const analysis = field === 'total' ? summary.tokenAnalysis.totalAnalysis : undefined;
  const completeValue = field === 'rawInput' ? summary.inputTotal : summary.tokens[field];
  const empty = summary.measurementCount === 0;
  const coveredRecords = analysis ? analysis.coveredRecords : coverage.coveredRecords;
  const partial = !empty && (analysis ? analysis.unavailableRecords > 0 && analysis.subtotal != null
    : completeValue == null && coverage.coveredRecords > 0 && coverage.observedSubtotal != null);
  const value = empty ? null : analysis ? analysis.subtotal : completeValue ?? (partial ? coverage.observedSubtotal : null);
  const state = empty ? 'empty' : value == null ? 'unavailable' : partial ? 'partial' : 'complete';
  const calculated = !empty && !!analysis && analysis.calculatedRecords > 0;
  const qualifiers = [];
  if (partial) qualifiers.push(t('usage.tokenAnalysis.subtotal'));
  if (calculated) qualifiers.push(t(analysis.recordedRecords > 0 ? 'usage.tokenAnalysis.includesCalculated' : 'usage.tokenAnalysis.calculated'));
  const notes = [t('usage.tokenAnalysis.scope'), t('usage.tokenAnalysis.covered', { count: coverage.coveredRecords })];
  for (const [key, count] of [
    ['usage.tokenAnalysis.missing', coverage.missingRecords],
    ['usage.tokenAnalysis.conflicting', coverage.conflictingRecords],
    ['usage.tokenAnalysis.invalid', coverage.invalidRecords],
    ['usage.tokenAnalysis.indeterminate', coverage.indeterminateRecords],
  ] as const) if (count > 0) notes.push(t(key, { count }));
  if (analysis) {
    notes.push(t('usage.tokenAnalysis.analyzedCovered', {count: coveredRecords}));
    if (calculated) notes.push(t('usage.tokenAnalysis.formula', {count: analysis.calculatedRecords}));
    if (analysis.overflowRecords > 0) notes.push(t('usage.tokenAnalysis.overflow', {count: analysis.overflowRecords}));
  }
  return { value, state, calculated, coveredRecords, qualifier: qualifiers.join(' · '),
    unavailable: empty ? t('webui.noMetering') : t('usage.tokenValueUnavailable'), description: notes.join(' · '), coverage };
}
/** CLI and accessibility use the same qualifier and coverage as visible UI values. */
export function tokenSummaryText(summary: UsageSummary, field: SummaryTokenField = 'total', compact = false): string {
  const presentation = tokenSummaryPresentation(summary, field);
  if (presentation.value == null) return presentation.unavailable;
  const number = new Intl.NumberFormat(locale.getSnapshot().locale === 'zh' ? 'zh-CN' : 'en-US', compact && presentation.value >= 10000 ? { notation: 'compact', maximumFractionDigits: 2 } : {}).format(presentation.value);
  return presentation.qualifier ? `${number} · ${presentation.qualifier}` : number;
}

/** Plot/sort basis supplied by Rust; historical captured records retain native-only analysis. */
export function analyzedTokenSubtotal(summary: UsageSummary): number | null {
  const analysis = summary.tokenAnalysis.totalAnalysis;
  return analysis ? analysis.subtotal ?? null : summary.tokenAnalysis.fields.total.observedSubtotal ?? null;
}
