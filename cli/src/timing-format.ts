import type { TimingResult, TimingLocalResult } from '@wombat/client';
import { t, timingBasisText, timingMissingValueText, timingSourceStatusText, timingCategories, timingCategoryText, timingIntersectionText, operationCoverageReasonText, repeatedBehaviorReasonText, type MessageKey } from '@wombat/client/locale';
import { terminalText } from './display-text.js';

type Metric = TimingLocalResult['time']['nativeWallClockMs'];
type WorkMetricLabel = Extract<MessageKey, `cli.timing.work.${string}`>;
function value(metric: Metric): string {
  return metric.value == null ? timingMissingValueText(metric.basis) : String(metric.value);
}
function durationValue(metric: Metric): string {
  return metric.value == null ? timingMissingValueText(metric.basis) : `${metric.value} ms`;
}
function measured(metric: Metric, unit = ''): string {
  if (metric.value == null) return timingMissingValueText(metric.basis);
  return `${value(metric)}${unit} · ${t(`cli.timing.measure.${metric.status}`)} · ${t('timing.basisLabel')}: ${timingBasisText(metric.basis)} (${terminalText(metric.basis)})`;
}
function hideUnavailableWorkMetric(metric: Metric): boolean {
  return metric.value == null && (metric.basis === 'unsupported_method' || metric.basis === 'missing_repository_baseline');
}
function workMetricLine(label: WorkMetricLabel, metric: Metric, unit = ''): string | undefined {
  return hideUnavailableWorkMetric(metric) ? undefined : `${t(label)}: ${measured(metric, unit)}`;
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
      lifecycleIntervals: 'cli.timing.cap.lifecycleIntervals', operationIntervals: 'cli.timing.cap.operationIntervals', contextPressure: 'cli.timing.cap.contextPressure',
      strictResponseGap: 'cli.timing.cap.strictResponseGap', exploratoryGap: 'cli.timing.cap.exploratoryGap',
      commandLabels: 'cli.timing.cap.commandLabels', fileChanges: 'cli.timing.cap.fileChanges', messageRecords: 'cli.timing.cap.messageRecords',
    } as const;
    for (const field of Object.keys(labels) as (keyof typeof labels)[]) {
      const capability = result.capabilities[field];
      lines.push(`${t(labels[field])}: ${t(`cli.timing.support.${capability.support}`)} · ${timingBasisText(capability.reason)} (${terminalText(capability.reason)})`);
    }
    return lines.join('\n');
  }
  lines.push(`${t('cli.timing.target')}: ${target(result)}`);
  if (result.action === 'evidence') {
    lines.push(`${t('cli.timing.snapshot')}: ${terminalText(result.snapshotId)}`, `${t('cli.timing.total')}: ${measured(result.total)}`);
    if (result.collection === 'turn_events') for (const row of result.rows) {
      lines.push(`${terminalText(row.reference)}\t${terminalText(row.recordKind)}\t${row.timestampMs ?? ''}\t${terminalText(row.phase ?? '')}`);
      if (row.durationMs != null) lines.push(`  ${t('execution.nativeDuration')}: ${row.durationMs} ms`);
      if (row.firstTokenMs != null) lines.push(`  ${t('cli.timing.nativeTtft')}: ${row.firstTokenMs} ms`);
      if (row.gapCodes.length) lines.push(`  ${row.gapCodes.map(terminalText).join(', ')}`);
    }
    else if (result.collection === 'use_objects') for (const row of result.rows) {
      lines.push([row.objectRef, t(`execution.useKind.${row.kind}`), t(`execution.useState.${row.state}`), row.path ?? row.server ?? '', row.project ?? '', `${t('execution.associatedUseCount')}: ${measured(row.associatedUseCount)}`, ...(row.useCount.value == null ? [t('execution.useWholeCountUnavailable', { reason: timingMissingValueText(row.useCount.basis) }), t('execution.usePartialCount')] : [`${t('execution.useCount')}: ${measured(row.useCount)}`])].map(terminalText).join('\t'));
    }
    else for (const row of result.rows) {
      const outcome = row.outcome === 'unknown' ? '' : t(`execution.useOutcome.${row.outcome}`);
      lines.push([row.reference, row.objectRef ?? '', row.kind ? t(`execution.useOperation.${row.kind}`) : t('execution.useRecord'), t(`execution.useState.${row.state}`), outcome, String(row.timestampMs ?? ''), row.timestampMs == null ? '' : row.timeBasis, row.tool ?? ''].map(terminalText).join('\t'));
      if (row.nativeDurationMs != null) lines.push(`  ${t('execution.useNativeDuration')}: ${row.nativeDurationMs} ms`);
      if (row.exitCode != null) lines.push(`  ${t('execution.useExitCode')}: ${row.exitCode}`);
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
  for (const category of timingCategories)
    lines.push(t('cli.timing.intervals', { category: timingCategoryText(category), union: durationValue(result.time[category].unionMs), sum: durationValue(result.time[category].sumMs) }));
  result.time.intersectionMasksMs.forEach((metric, mask) => {
    if ((mask & (mask - 1)) !== 0 && metric.value != null && metric.value > 0)
      lines.push(`${t('execution.intersections')} · ${timingIntersectionText(mask)}: ${measured(metric, ' ms')}`);
  });
  lines.push(`${t('execution.covered')}: ${measured(result.time.coveredMs, ' ms')}`,
    `${t('execution.unclassified')}: ${measured(result.time.unclassifiedMs, ' ms')}`);
  const operations=result.time.operationCoverage;
  lines.push(t('execution.operations.title'),
    `${t('execution.operations.covered')}: ${measured(operations.coveredMs,' ms')}`,
    `${t('execution.operations.residual')}: ${measured(operations.residualMs,' ms')}`,
    `${t('execution.operations.candidates')}: ${measured(operations.candidateOperations)}`,
    `${t('execution.operations.paired')}: ${measured(operations.pairedOperations)}`,
    `${t('execution.operations.identityGaps')}: ${measured(operations.identityGapRecords)}`,
    `${t('execution.operations.conflicts')}: ${measured(operations.conflictingOperations)}`,
    `${t('execution.operations.ranges')}: ${measured(operations.residualRangeCount)}`,
    t('execution.operations.note'),...operations.reasonCodes.map(operationCoverageReasonText));
  for(const range of operations.residualRanges)lines.push(`  ${range.startMs}–${range.endMs} ms`);
  const repeats=result.time.repeatedBehavior;
  lines.push(t('execution.repeats.title'));
  if(repeats.coverage.partial)lines.push(t('execution.repeats.partial'));
  for(const [label,metric] of [['execution.repeats.afterFailure',repeats.afterFailure],['execution.repeats.read',repeats.repeatedRead]] as const){
    lines.push(`${t(label)}: ${measured(metric.count)}`,
      `  ${t('execution.repeats.knownSum')}: ${measured(metric.duration.knownSumMs,' ms')}`,
      `  ${t('execution.repeats.recorded')}: ${measured(metric.duration.recordedCount)}`,
      `  ${t('execution.repeats.calculated')}: ${measured(metric.duration.calculatedCount)}`,
      `  ${t('execution.repeats.missing')}: ${measured(metric.duration.missingCount)}`);
  }
  for(const [label,metric,unit] of [
    ['execution.repeats.sameRequest',repeats.sameRequestObservationCount,''],
    ['execution.repeats.readRequest',repeats.repeatedReadRequestCount,''],
    ['execution.repeats.recovery',repeats.recoverySpanSumMs,' ms'],
    ['execution.repeats.missingRecovery',repeats.missingRecoverySpanCount,''],
    ['execution.repeats.combined',repeats.combinedOperationCount,''],
    ['execution.repeats.union',repeats.combinedUnionMs,' ms'],
    ['execution.repeats.missingIntervals',repeats.combinedMissingIntervalCount,''],
    ['execution.repeats.candidates',repeats.coverage.candidateOperations,''],
    ['execution.repeats.eligible',repeats.coverage.eligibleCommands,''],
  ] as const)lines.push(`${t(label)}: ${measured(metric,unit)}`);
  lines.push(t('execution.repeats.layer'),t('execution.repeats.observationNote'),t('execution.repeats.note'),...repeats.coverage.reasonCodes.map(repeatedBehaviorReasonText));
  if(result.profile==='local') {
    const navigation=result.evidence.repeatPages;
    if(navigation.entries.length) {
      lines.push(t('execution.repeats.details'),t('execution.repeats.proofCount',{count:navigation.locatedOperationCount.value??0}));
      navigation.entries.forEach((entry,index)=>{
        lines.push(`${t('execution.repeats.call',{number:index+1})}: ${measured(entry.laterDurationMs,' ms')}`,
          `  ${t('execution.repeats.later')}: ${terminalText(entry.later.operationAlias)}`);
        if(entry.afterFailure)lines.push(`  ${t('execution.repeats.previousFailure')}: ${terminalText(entry.afterFailure.operationAlias)}`);
        entry.successfulReads.forEach((proof,prior)=>lines.push(`  ${t('execution.repeats.previousRead',{number:prior+1})}: ${terminalText(proof.operationAlias)}`));
      });
    } else if(navigation.detail.reason==='resource_limit')lines.push(t('execution.repeats.detailLimit'));
  }
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
    `${t('cli.timing.source')}: ${timingSourceStatusText(result.coverage.sourceStatus)}`,
    `${t('cli.timing.quality')}: ${t(result.quality.partial ? 'cli.timing.partial' : 'cli.timing.complete')}`);
  if (result.quality.reasonCodes.length) lines.push(`${t('timing.reasons')}: ${result.quality.reasonCodes.map(reason => `${timingMissingValueText(reason)} (${terminalText(reason)})`).join('; ')}`);
  if (result.quality.running) lines.push(t('timing.running'));
  if (result.quality.censored) lines.push(t('timing.censored'));
  return lines.join('\n');
}

export function timingExitCode(result: TimingResult): number {
  // Successful navigation/support responses carry no turn-read quality judgment.
  return result.action === 'summary' && (result.quality.partial || result.quality.running || result.quality.censored) ? 2 : 0;
}
