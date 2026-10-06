import type { TimingLocalResult } from '@wombat/client';
import { t,operationOutcomeText } from '@wombat/client/locale';

type Work = TimingLocalResult['work'];
type Count = Work['fileChangeRecords'];
type Basis = Count['basis'];
type WorkLabel =
  | 'execution.work.operationCandidates'
  | 'execution.work.closedOperations'
  | 'execution.work.failedOperations'
  | 'execution.work.fileChangeRecords'
  | 'execution.work.reportedFiles'
  | 'execution.work.userBoundaryRecords'
  | 'execution.work.injectedContextRecords'
  | 'execution.work.reasoningMessageRecords';

function countText(value: Count, unit = ''): string {
  if (value.value == null) return basisText(value.basis);
  return `${value.value.toLocaleString()}${unit} · ${t(`execution.work.measure.${value.status}`)} · ${basisText(value.basis)}`;
}

function omitUnavailable(value: Count): boolean {
  return value.value == null && (value.basis === 'unsupported_method' || value.basis === 'missing_repository_baseline');
}

function basisText(basis: Basis): string {
  switch (basis) {
    case 'safe_event_count': return t('execution.work.basis.eventCount');
    case 'canonical_operation_identity': return t('execution.work.basis.operationIdentity');
    case 'reported_file_paths': return t('execution.work.basis.reportedPaths');
    case 'unknown_message_origin': return t('execution.work.basis.messageOrigin');
    case 'missing_repository_baseline': return t('execution.work.basis.repositoryBaseline');
    case 'unsupported_method': return t('execution.work.basis.unsupported');
    case 'not_recorded': return t('execution.work.basis.notRecorded');
    case 'adapter_not_mapped': return t('execution.work.basis.notMapped');
    case 'missing_identity': return t('execution.work.basis.missingIdentity');
    case 'boundary_conflict': return t('execution.work.basis.conflict');
    case 'source_partial': return t('execution.work.basis.sourcePartial');
    case 'resource_limit': return t('execution.work.basis.resourceLimit');
    case 'missing_target': return t('execution.work.basis.missingTarget');
    default: return t('execution.work.basis.other');
  }
}

function sourceText(status: string): string {
  switch (status) {
    case 'complete': return t('source.read');
    case 'partial':
    case 'cancelled': return t('source.incomplete');
    case 'failed': return t('source.unreadable');
    case 'not_found': return t('source.notFound');
    case 'unknown': return t('execution.work.sourceStatusUnconfirmed');
    default: return t('execution.work.sourceStatusUnconfirmed');
  }
}

export function WorkFacts({
  work,
  sourceStatus,
  partial,
}: {
  work: Work;
  sourceStatus: string;
  partial: boolean;
}) {
  const outcomes=operationOutcomeText(work.outcomes);
  const allRows: Array<[WorkLabel, Count]> = [
    ['execution.work.operationCandidates', work.operationCandidates],
    ['execution.work.closedOperations', work.closedOperations],
    ['execution.work.failedOperations', work.failedOperations],
    ['execution.work.fileChangeRecords', work.fileChangeRecords],
    ['execution.work.reportedFiles', work.changedFiles],
    ['execution.work.userBoundaryRecords', work.userBoundaryRecords],
    ['execution.work.injectedContextRecords', work.injectedContextRecords],
    ['execution.work.reasoningMessageRecords', work.reasoningMessageRecords],
  ];
  const rows = allRows.filter(([, value]) => !omitUnavailable(value));
  const basisCodes = [
    ...allRows.map(([, value]) => value.basis),
    work.addedLines.basis,
    work.removedLines.basis,
    work.labelledCommandMs.basis,
  ];

  return (
    <section className="work-facts" aria-label={t('execution.work.title')}>
      <h4>{t('execution.work.title')}</h4>
      <p>{t('execution.work.sourceStatus')}: {sourceText(sourceStatus)}</p>
      {partial && <p role="status">{t('execution.work.partial')}</p>}
      <h5>{t('execution.outcomes.title')}</h5>
      <p>{outcomes.headline}</p>
      {outcomes.details.map(text=><p key={text}>{text}</p>)}
      <p className="compact-note">{outcomes.note}</p>
      <dl className="facts">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{t(label)}</dt>
            <dd>{countText(value)}</dd>
          </div>
        ))}
        {!omitUnavailable(work.addedLines) && <div>
          <dt>{t('execution.work.addedLines')}</dt>
          <dd>{countText(work.addedLines)}</dd>
        </div>}
        {!omitUnavailable(work.removedLines) && <div>
          <dt>{t('execution.work.removedLines')}</dt>
          <dd>{countText(work.removedLines)}</dd>
        </div>}
        {!omitUnavailable(work.labelledCommandMs) && <div>
          <dt>{t('execution.work.commandDuration')}</dt>
          <dd>{countText(work.labelledCommandMs, ' ms')}</dd>
        </div>}
      </dl>
      <p>{t('execution.work.note')}</p>
      <details>
        <summary>{t('execution.work.technical')}</summary>
        <code>{[...new Set(basisCodes)].join(', ')}</code>
        <p>{sourceStatus}</p>
      </details>
    </section>
  );
}
