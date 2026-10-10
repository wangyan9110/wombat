import type { TimingLocalResult } from '@wombat/client';
import { t, timingMissingValueText, operationCoverageReasonText } from '@wombat/client/locale';
type Coverage = TimingLocalResult['time']['operationCoverage'];
type Metric = Coverage['residualMs'];
export function OperationCoverage({
  coverage,
  onEvidence,
  blocked,
}: {
  coverage: Coverage;
  onEvidence: (refs: string[]) => void;
  blocked: boolean;
}) {
  const duration = (value: Metric) =>
    value.value == null ? timingMissingValueText(value.basis) : `${value.value} ms`;
  const count = (value: Metric) =>
    value.value == null ? timingMissingValueText(value.basis) : String(value.value);
  return (
    <section className="execution-operation-coverage" aria-label={t('execution.operations.title')}>
      <h4>{t('execution.operations.title')}</h4>
      <dl className="facts">
        <dt>{t('execution.operations.covered')}</dt>
        <dd>{duration(coverage.coveredMs)}</dd>
        <dt>{t('execution.operations.residual')}</dt>
        <dd>
          {duration(coverage.residualMs)}{' '}
          {coverage.residualMs.evidenceRefs.length > 0 && (
            <button
              className="link"
              disabled={blocked}
              onClick={() => onEvidence(coverage.residualMs.evidenceRefs)}
            >
              {t('execution.evidence')}
            </button>
          )}
        </dd>
      </dl>
      <p className="compact-note">{t('execution.operations.note')}</p>
      {coverage.reasonCodes.map((reason) => (
        <p className="note" key={reason}>
          {operationCoverageReasonText(reason)}
        </p>
      ))}
      <details>
        <summary>{t('execution.operations.coverage')}</summary>
        <dl className="facts">
          <dt>{t('execution.operations.candidates')}</dt>
          <dd>{count(coverage.candidateOperations)}</dd>
          <dt>{t('execution.operations.paired')}</dt>
          <dd>{count(coverage.pairedOperations)}</dd>
          <dt>{t('execution.operations.identityGaps')}</dt>
          <dd>{count(coverage.identityGapRecords)}</dd>
          <dt>{t('execution.operations.conflicts')}</dt>
          <dd>{count(coverage.conflictingOperations)}</dd>
        </dl>
      </details>
      {coverage.residualRangeCount.value != null && (
        <details>
          <summary>
            {t('execution.operations.ranges')} · {count(coverage.residualRangeCount)}
          </summary>
          {coverage.residualRanges.map((range, index) => (
            <p key={index}>
              {range.startMs}–{range.endMs} ms
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
