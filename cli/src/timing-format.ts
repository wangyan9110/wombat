import type { TimingResult, TimingLocalResult } from '@wombat/client';
import { t } from '@wombat/client/locale';
import { terminalText } from './display-text.js';

type Metric = TimingLocalResult['time']['nativeWallClockMs'];
function value(metric: Metric): string {
  return metric.value == null ? t('cli.timing.unknown') : String(metric.value);
}
function measured(metric: Metric, unit = ''): string {
  return `${value(metric)}${unit} · ${t(`cli.timing.measure.${metric.status}`)} · ${terminalText(metric.basis)}`;
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
      wallClock: 'cli.timing.cap.wallClock', nativeTtft: 'cli.timing.nativeTtft', firstContentRecordDelay: 'cli.timing.firstContentDelay',
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
    for (const row of result.rows) {
      lines.push(`${terminalText(row.reference)}\t${terminalText(row.recordKind)}\t${row.timestampMs ?? t('cli.timing.unknown')}\t${terminalText(row.phase ?? '')}`);
      if (row.gapCodes.length) lines.push(`  ${row.gapCodes.map(terminalText).join(', ')}`);
    }
    if (result.nextCursor) lines.push(`${t('cli.timing.nextCursor')}: ${terminalText(result.nextCursor.token)}`);
    return lines.join('\n');
  }
  lines.push(t(`cli.timing.state.${result.time.state}`));
  if ('readView' in result) lines.push(`${t('cli.timing.snapshot')}: ${terminalText(result.readView.snapshotId)}`);
  lines.push(`${t('cli.timing.nativeDuration')}: ${measured(result.time.nativeWallClockMs, ' ms')}`,
    `${t('cli.timing.derivedDuration')}: ${measured(result.time.derivedWallClockMs, ' ms')}`,
    `${t('cli.timing.nativeTtft')}: ${measured(result.time.nativeTtftMs, ' ms')}`,
    `${t('cli.timing.firstContentDelay')}: ${measured(result.time.firstContentRecordDelayMs, ' ms')}`);
  for (const category of ['command', 'compaction', 'reasoning'] as const)
    lines.push(t('cli.timing.intervals', { category: t(`cli.timing.${category}`), union: value(result.time[category].unionMs), sum: value(result.time[category].sumMs) }));
  lines.push(t('cli.timing.concurrentNote'),
    `${t('cli.timing.inputDistribution')}: ${value(result.context.input.median)} / ${value(result.context.input.p90)}`,
    `${t('cli.timing.ratioDistribution')}: ${value(result.context.ratio.median)} / ${value(result.context.ratio.p90)}`,
    `${t('cli.timing.samples')}: ${value(result.context.input.samples)}`,
    `${t('cli.timing.compactionRecords')}: ${value(result.context.compactionRecords)} / ${value(result.context.compactionTimeMs)}`,
    `${t('cli.timing.operations')}: ${value(result.work.operationCandidates)} / ${value(result.work.closedOperations)} / ${value(result.work.failedOperations)}`,
    `${t('cli.timing.source')}: ${terminalText(result.coverage.sourceStatus)}`,
    `${t('cli.timing.quality')}: ${t(result.quality.partial ? 'cli.timing.partial' : 'cli.timing.complete')}`);
  if (result.quality.reasonCodes.length) lines.push(result.quality.reasonCodes.map(terminalText).join(', '));
  if (result.quality.running || result.quality.censored) lines.push(t('cli.timing.provisional'));
  return lines.join('\n');
}

export function timingExitCode(result: TimingResult): number {
  // Successful navigation/support responses carry no turn-read quality judgment.
  return result.action === 'summary' && (result.quality.partial || result.quality.running || result.quality.censored) ? 2 : 0;
}
