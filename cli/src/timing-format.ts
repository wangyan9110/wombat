import type { TimingResult, TimingLocalResult } from '@wombat/client';
import { t, type MessageKey } from '@wombat/client/locale';
import { terminalText } from './display-text.js';

type Metric = TimingLocalResult['time']['nativeWallClockMs'];
type WorkMetricLabel = Extract<MessageKey, `cli.timing.work.${string}`>;
function missingValue(metric: Metric): string {
  switch (metric.basis) {
    case 'not_recorded': return t('cli.timing.basis.notRecorded');
    case 'running_turn': return t('cli.timing.basis.running');
    case 'unsupported_method': return t('cli.timing.basis.unsupported');
    case 'missing_repository_baseline': return t('cli.timing.basis.repositoryBaseline');
    case 'unknown_message_origin': return t('cli.timing.basis.messageOrigin');
    case 'adapter_not_mapped': return t('cli.timing.basis.notMapped');
    case 'missing_identity': return t('cli.timing.basis.identity');
    case 'missing_time': return t('cli.timing.basis.time');
    case 'missing_batch_cycle': return t('cli.timing.basis.batch');
    case 'boundary_conflict': return t('cli.timing.basis.conflict');
    case 'source_partial': return t('cli.timing.basis.sourcePartial');
    case 'resource_limit': return t('cli.timing.basis.resourceLimit');
    case 'numeric_range': return t('cli.timing.basis.numericRange');
    case 'no_candidates': return t('cli.timing.basis.noCandidates');
    default: return t('cli.timing.basis.evidenceInsufficient');
  }
}
function value(metric: Metric): string {
  return metric.value == null ? missingValue(metric) : String(metric.value);
}
function durationValue(metric: Metric): string {
  return metric.value == null ? missingValue(metric) : `${metric.value} ms`;
}
function measured(metric: Metric, unit = ''): string {
  if (metric.value == null) return value(metric);
  return `${value(metric)}${unit} · ${t(`cli.timing.measure.${metric.status}`)} · ${terminalText(metric.basis)}`;
}
function hideUnavailableWorkMetric(metric: Metric): boolean {
  return metric.value == null && (metric.basis === 'unsupported_method' || metric.basis === 'missing_repository_baseline');
}
function workMetricLine(label: WorkMetricLabel, metric: Metric, unit = ''): string | undefined {
  return hideUnavailableWorkMetric(metric) ? undefined : `${t(label)}: ${measured(metric, unit)}`;
}
function sourceStatusLabel(status: string): string {
  switch (status) {
    case 'complete': return t('cli.timing.sourceStatus.complete');
    case 'partial': return t('cli.timing.sourceStatus.partial');
    case 'failed': return t('cli.timing.sourceStatus.failed');
    case 'not_found': return t('cli.timing.sourceStatus.notFound');
    case 'cancelled': return t('cli.timing.sourceStatus.cancelled');
    case 'unknown': return t('cli.timing.sourceStatus.unconfirmed');
    default: return terminalText(status);
  }
}
function turnStateLabel(state: TimingLocalResult['time']['state']): string | undefined {
  switch (state) {
    case 'running': return t('cli.timing.state.running');
    case 'completed': return t('cli.timing.state.completed');
    case 'failed': return t('cli.timing.state.failed');
    case 'cancelled': return t('cli.timing.state.cancelled');
    case 'unknown': return undefined;
  }
}
function target(result: TimingResult): string {
  if (!('scope' in result)) return '';
  return 'threadId' in result.scope
    ? `${terminalText(result.scope.threadId)} / ${terminalText(result.scope.turnId)}`
    : `${terminalText(result.scope.taskAlias)} / ${terminalText(result.scope.turnAlias)}`;
}
/** Render only core-owned facts; do not infer measures, causes, or response completeness. */
export function renderTimingResult(result: TimingResult): string {
  const lines = [`Wombat · ${t(result.action === 'summary' ? 'cli.timing.title' : result.action === 'evidence' ? 'cli.timing.evidence' : 'cli.timing.capabilities')}`,
    `${t('cli.timing.method')}: ${terminalText(result.methodVersion)}`];
  if (result.action === 'capabilities') {
    const labels = {
      objectUses: 'cli.timing.cap.objectUses', wallClock: 'cli.timing.cap.wallClock', nativeTtft: 'cli.timing.nativeTtft', firstContentRecordDelay: 'cli.timing.firstContentDelay',
      lifecycleIntervals: 'cli.timing.cap.lifecycleIntervals', contextPressure: 'cli.timing.cap.contextPressure',
      strictResponseGap: 'cli.timing.cap.strictResponseGap', exploratoryGap: 'cli.timing.cap.exploratoryGap',
      commandLabels: 'cli.timing.cap.commandLabels', fileChanges: 'cli.timing.cap.fileChanges', messageRecords: 'cli.timing.cap.messageRecords',
    } as const;
    for (const field of Object.keys(labels) as (keyof typeof labels)[]) {
      const capability = result.capabilities[field];
      lines.push(`${t(labels[field])}: ${t(`cli.timing.support.${capability.support}`)} · ${terminalText(capability.reason)}`);
    }
    return lines.join('\n');
  }
  lines.push(`${t('cli.timing.target')}: ${target(result)}`);
  if (result.action === 'evidence') {
    lines.push(`${t('cli.timing.snapshot')}: ${terminalText(result.snapshotId)}`, `${t('cli.timing.total')}: ${measured(result.total)}`);
    if (result.collection === 'turn_events') for (const row of result.rows) {
      lines.push(`${terminalText(row.reference)}\t${terminalText(row.recordKind)}\t${row.timestampMs ?? ''}\t${terminalText(row.phase ?? '')}`);
      if (row.gapCodes.length) lines.push(`  ${row.gapCodes.map(terminalText).join(', ')}`);
    }
    else if (result.collection === 'use_objects') for (const row of result.rows) {
      lines.push([row.objectRef, row.kind, row.state, row.path ?? row.server ?? '', row.project ?? '', `${t('execution.useCount')}: ${measured(row.useCount)}`, `${t('execution.associatedUseCount')}: ${measured(row.associatedUseCount)}`].map(terminalText).join('\t'));
    }
    else for (const row of result.rows) {
      const outcome = row.outcome === 'unknown' ? '' : t(`execution.useOutcome.${row.outcome}`);
      lines.push([row.reference, row.objectRef ?? '', row.kind ? t(`execution.useOperation.${row.kind}`) : t('execution.useRecord'), row.state, outcome, String(row.timestampMs ?? ''), row.timestampMs == null ? '' : row.timeBasis, row.tool ?? ''].map(terminalText).join('\t'));
      if (row.gapCodes.includes('operation_result_conflict')) lines.push(`  ${t('execution.useOutcomeConflict')}`);
      if (row.gapCodes.length) lines.push(`  ${row.gapCodes.map(terminalText).join(', ')}`);
    }
    if (result.nextCursor) lines.push(`${t('cli.timing.nextCursor')}: ${terminalText(result.nextCursor.token)}`);
    return lines.join('\n');
  }
  const stateLabel = turnStateLabel(result.time.state);
  if (stateLabel) lines.push(stateLabel);
  if ('readView' in result) lines.push(`${t('cli.timing.snapshot')}: ${terminalText(result.readView.snapshotId)}`);
  lines.push(`${t('cli.timing.nativeDuration')}: ${measured(result.time.nativeWallClockMs, ' ms')}`,
    `${t('cli.timing.derivedDuration')}: ${measured(result.time.derivedWallClockMs, ' ms')}`,
    `${t('cli.timing.nativeTtft')}: ${measured(result.time.nativeTtftMs, ' ms')}`,
    `${t('cli.timing.firstContentDelay')}: ${measured(result.time.firstContentRecordDelayMs, ' ms')}`);
  for (const category of ['command', 'compaction', 'reasoning'] as const)
    lines.push(t('cli.timing.intervals', { category: t(`cli.timing.${category}`), union: durationValue(result.time[category].unionMs), sum: durationValue(result.time[category].sumMs) }));
  const allWorkMetrics: Array<[string, Metric]> = [
    ['addedLines', result.work.addedLines],
    ['removedLines', result.work.removedLines],
    ['labelledCommandMs', result.work.labelledCommandMs],
  ];
  const omittedWorkMetrics = allWorkMetrics.filter(([, metric]) => hideUnavailableWorkMetric(metric));
  lines.push(t('cli.timing.concurrentNote'),
    `${t('cli.timing.inputDistribution')}: ${value(result.context.input.median)} / ${value(result.context.input.p90)}`,
    `${t('cli.timing.ratioDistribution')}: ${value(result.context.ratio.median)} / ${value(result.context.ratio.p90)}`,
    `${t('cli.timing.samples')}: ${value(result.context.input.samples)}`,
    `${t('cli.timing.compactionRecords')}: ${value(result.context.compactionRecords)} / ${value(result.context.compactionTimeMs)}`,
    `${t('cli.timing.operations')}: ${value(result.work.operationCandidates)} / ${value(result.work.closedOperations)} / ${value(result.work.failedOperations)}`,
    ...[
      workMetricLine('cli.timing.work.fileChangeRecords', result.work.fileChangeRecords),
      workMetricLine('cli.timing.work.reportedFiles', result.work.changedFiles),
      workMetricLine('cli.timing.work.addedLines', result.work.addedLines),
      workMetricLine('cli.timing.work.removedLines', result.work.removedLines),
      workMetricLine('cli.timing.work.userBoundaryRecords', result.work.userBoundaryRecords),
      workMetricLine('cli.timing.work.injectedContextRecords', result.work.injectedContextRecords),
      workMetricLine('cli.timing.work.reasoningMessageRecords', result.work.reasoningMessageRecords),
      workMetricLine('cli.timing.work.commandDuration', result.work.labelledCommandMs, ' ms'),
    ].filter((line): line is string => line !== undefined),
    t('cli.timing.work.note'),
    ...(omittedWorkMetrics.length ? [`${t('cli.timing.work.technicalBasis')}: ${omittedWorkMetrics.map(([field, metric]) => `${field}=${metric.basis}`).join(', ')}`] : []),
    `${t('cli.timing.useObjects')}: ${measured('totals' in result.uses ? result.uses.totals.objectCount : result.uses.objectCount)}`,
    `${t('cli.timing.useRecords')}: ${measured('totals' in result.uses ? result.uses.totals.recordCount : result.uses.recordCount)}`,
    `${t('cli.timing.source')}: ${sourceStatusLabel(result.coverage.sourceStatus)}`,
    `${t('cli.timing.quality')}: ${t(result.quality.partial ? 'cli.timing.partial' : 'cli.timing.complete')}`);
  if (result.quality.reasonCodes.length) lines.push(result.quality.reasonCodes.map(terminalText).join(', '));
  if (result.quality.running || result.quality.censored) lines.push(t('cli.timing.provisional'));
  return lines.join('\n');
}

export function timingExitCode(result: TimingResult): number {
  // Successful navigation/support responses carry no turn-read quality judgment.
  return result.action === 'summary' && (result.quality.partial || result.quality.running || result.quality.censored) ? 2 : 0;
}
