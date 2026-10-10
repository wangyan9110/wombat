import { useEffect, useRef, useState } from 'react';
import { CoreError, type TimingLocalResult, type UsageClient } from '@wombat/client';
import { t, timingMissingValueText } from '@wombat/client/locale';
import { timestamp } from '../components.js';
import { QueryError } from '../Feedback.js';
import {
  UsesSelection,
  type UseObjectsPage,
  type UseRecordsPage,
  type UsesRead,
} from './uses-reader.js';
type Object = TimingLocalResult['uses']['objects'][number];
type Count = Object['useCount'];
const value = (count: Count) =>
  count.value == null ? t('execution.missing') : String(count.value);
export function UseObjectRow({
  object,
  disabled = false,
  inspect,
}: {
  object: Object;
  disabled?: boolean;
  inspect: (object: Object) => void;
}) {
  return (
    <article>
      <h4>
        {t(`execution.useKind.${object.kind}`)} · {t(`execution.useState.${object.state}`)}
      </h4>
      {object.path && (
        <p>
          <code>{object.path}</code>
        </p>
      )}
      {object.server && (
        <p>
          {t('execution.useServer')} · <code>{object.server}</code>
        </p>
      )}
      {object.project && (
        <p>
          {t('execution.useProject')} · <code>{object.project}</code>
        </p>
      )}
      <dl className="facts">
        <dt>{t('execution.associatedUseCount')}</dt>
        <dd>{value(object.associatedUseCount)}</dd>
        {object.useCount.value != null && (
          <>
            <dt>{t('execution.useCount')}</dt>
            <dd>{value(object.useCount)}</dd>
          </>
        )}
        <dt>{t('execution.useRecordCount')}</dt>
        <dd>{value(object.recordCount)}</dd>
        <dt>{t('execution.unassignedUseRecords')}</dt>
        <dd>{value(object.unassignedTurnRecords)}</dd>
      </dl>
      {object.useCount.value == null && (
        <>
          <p>
            {t('execution.useWholeCountUnavailable', {
              reason: timingMissingValueText(object.useCount.basis),
            })}
          </p>
          <p className="note">{t('execution.usePartialCount')}</p>
        </>
      )}
      <button className="link" disabled={disabled} onClick={() => inspect(object)}>
        {t('execution.useEvidence')}
      </button>
      <details>
        <summary>{t('execution.technical')}</summary>
        <code>{object.objectRef}</code>
        <p>
          {object.useCount.status} · {object.useCount.basis}
        </p>
        <pre>{JSON.stringify(object.coverage, null, 2)}</pre>
      </details>
    </article>
  );
}
export function UseRecordRow({
  row,
  timezone,
}: {
  row: UseRecordsPage['rows'][number];
  timezone: string;
}) {
  const date = row.timestampMs == null ? undefined : new Date(row.timestampMs);
  const time =
    date && !Number.isNaN(date.getTime())
      ? timestamp(date.toISOString(), timezone, 'millisecond')
      : undefined;
  const nativeDuration = row.nativeDurationMs == null ? undefined : `${row.nativeDurationMs} ms`;
  const outcome = row.outcome === 'unknown' ? undefined : t(`execution.useOutcome.${row.outcome}`);
  const resultConflict = row.gapCodes.includes('operation_result_conflict');
  const otherGaps = row.gapCodes.some((code) => code !== 'operation_result_conflict');
  return (
    <article>
      <h4>
        {t(row.kind ? `execution.useOperation.${row.kind}` : 'execution.useRecord')} ·{' '}
        {t(`execution.useState.${row.state}`)}
      </h4>
      {(outcome || time) && <p>{[outcome, time].filter(Boolean).join(' · ')}</p>}
      {resultConflict && <p>{t('execution.useOutcomeConflict')}</p>}
      {row.tool && (
        <p>
          <code>{row.tool}</code>
        </p>
      )}
      {nativeDuration !== undefined && (
        <p>
          {t('execution.useNativeDuration')} · {nativeDuration}
        </p>
      )}
      {row.exitCode != null && (
        <p>
          {t('execution.useExitCode')} · {row.exitCode}
        </p>
      )}
      {row.replayOf && <p>{t('execution.useReplay')}</p>}
      {row.targetConflict && <p>{t('execution.useTargetConflict')}</p>}
      {otherGaps && <p>{t('execution.useGaps')}</p>}
      <details>
        <summary>{t('execution.technical')}</summary>
        <code>{row.reference}</code>
        <p>
          {row.objectRef} · {row.timeBasis} · {String(row.identityKnown)}
        </p>
        <p>{row.replayOf}</p>
        <p>{row.gapCodes.join(', ')}</p>
      </details>
    </article>
  );
}
export function TurnUses({
  client,
  summary,
  blocked = false,
  refresh,
  onExpired,
  timezone,
}: {
  client: UsageClient;
  summary: TimingLocalResult;
  blocked?: boolean;
  refresh: () => void;
  onExpired: () => void;
  timezone: string;
}) {
  const [objects, setObjects] = useState<UseObjectsPage>(),
    [records, setRecords] = useState<UseRecordsPage>(),
    [selected, setSelected] = useState<Object | null>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const selection = useRef<UsesSelection | null>(null),
    epoch = useRef(0),
    lastRead = useRef<UsesRead | undefined>(undefined),
    opener = useRef<HTMLElement | null>(null),
    detail = useRef<HTMLElement | null>(null),
    returnFocus = useRef(false);
  useEffect(() => {
    if (selected !== undefined) {
      detail.current?.focus();
      detail.current?.scrollIntoView({ block: 'nearest' });
    } else if (returnFocus.current) {
      returnFocus.current = false;
      if (opener.current?.isConnected && !opener.current.matches(':disabled'))
        opener.current.focus();
    }
  }, [selected]);
  useEffect(() => {
    const current = new UsesSelection(client, summary);
    selection.current = current;
    epoch.current++;
    setObjects(undefined);
    setRecords(undefined);
    setSelected(undefined);
    setBusy(false);
    setError(undefined);
    lastRead.current = undefined;
    return () => {
      epoch.current++;
      current.stop();
    };
  }, [client, summary]);
  useEffect(() => {
    if (blocked) {
      selection.current?.stop();
      setBusy(false);
    }
  }, [blocked]);
  const read = async (request: UsesRead) => {
    if (blocked || !selection.current) return;
    const identity = epoch.current;
    lastRead.current = request;
    setBusy(true);
    setError(undefined);
    const outcome = await selection.current.read(request);
    if (identity !== epoch.current || outcome.superseded) return;
    if (outcome.result?.collection === 'use_objects') setObjects(outcome.result);
    if (outcome.result?.collection === 'use_records') setRecords(outcome.result);
    if (outcome.error) {
      const code = outcome.error instanceof CoreError ? outcome.error.code : 'INTERNAL_ERROR';
      setError(code);
      if (code === 'VIEW_EXPIRED') onExpired();
    }
    setBusy(false);
  };
  const inspect = (object: Object | null) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    returnFocus.current = false;
    selection.current?.stop();
    setBusy(false);
    setRecords(undefined);
    setError(undefined);
    setSelected(object);
    lastRead.current = undefined;
    void read({ collection: 'use_records', objectRef: object?.objectRef });
  };
  const rows = objects?.rows ?? summary.uses.objects,
    next = objects ? objects.nextCursor : summary.uses.nextCursor;
  const totals = summary.uses.totals,
    disabled = blocked || busy || !client.timing;
  return (
    <section className="execution" aria-label={t('execution.uses')}>
      <h3>{t('execution.uses')}</h3>
      <p>{t('execution.useNote')}</p>
      <p>{t(`execution.useCoverage.${totals.sourceCoverage}`)}</p>
      <dl className="facts">
        <dt>{t('execution.useObjectCount')}</dt>
        <dd>{value(totals.objectCount)}</dd>
        <dt>{t('execution.useRecordCount')}</dt>
        <dd>{value(totals.recordCount)}</dd>
        <dt>{t('execution.unboundUseRecords')}</dt>
        <dd>{value(totals.unboundTargetRecords)}</dd>
        <dt>{t('execution.unassignedSkillRecords')}</dt>
        <dd>{value(totals.unassignedSkillRecords)}</dd>
        <dt>{t('execution.unassignedMcpRecords')}</dt>
        <dd>{value(totals.unassignedMcpRecords)}</dd>
      </dl>
      {summary.uses.detail.support === 'unavailable' && <p>{t('execution.usesUnavailable')}</p>}
      {!rows.length && summary.uses.detail.support !== 'unavailable' && (
        <p>{t('execution.noUseObjects')}</p>
      )}
      {rows.map((object) => (
        <UseObjectRow
          key={object.objectRef}
          object={object}
          disabled={disabled}
          inspect={inspect}
        />
      ))}
      {next && (
        <button
          disabled={disabled}
          onClick={() => {
            void read({ collection: 'use_objects', cursor: next });
          }}
        >
          {t('execution.nextUseObjects')}
        </button>
      )}
      {objects && (
        <button
          disabled={disabled}
          onClick={() => {
            selection.current?.stop();
            setBusy(false);
            setObjects(undefined);
            setError(undefined);
            lastRead.current = undefined;
          }}
        >
          {t('execution.firstUseObjects')}
        </button>
      )}
      <button
        disabled={disabled || summary.uses.detail.support === 'unavailable'}
        onClick={() => inspect(null)}
      >
        {t('execution.allUseRecords')}
      </button>
      {busy && (
        <p role="status">
          {t('webui.loading')}{' '}
          <button
            onClick={() => {
              selection.current?.stop();
              setBusy(false);
              setError('CANCELLED');
            }}
          >
            {t('webui.cancel')}
          </button>
        </p>
      )}
      {error && (
        <QueryError
          error={error === 'CANCELLED' ? 'CANCELLED' : t('execution.readUnavailable')}
          code={error}
          retry={
            blocked
              ? refresh
              : () => {
                  if (lastRead.current) void read(lastRead.current);
                }
          }
        />
      )}
      {selected !== undefined && (
        <aside
          ref={detail}
          tabIndex={-1}
          className="execution-evidence"
          aria-label={t('execution.useEvidence')}
        >
          <h4>{selected?.path ?? selected?.server ?? t('execution.allUseRecords')}</h4>
          <p>{t('execution.usePageNote')}</p>
          {records && (
            <>
              <p>{t('execution.evidenceCount', { count: value(records.total) })}</p>
              {records.rows.map((row) => (
                <UseRecordRow key={row.reference} row={row} timezone={timezone} />
              ))}
              {records.nextCursor && (
                <button
                  disabled={disabled}
                  onClick={() => {
                    void read({
                      collection: 'use_records',
                      objectRef: selected?.objectRef,
                      cursor: records.nextCursor!,
                    });
                  }}
                >
                  {t('execution.nextEvidence')}
                </button>
              )}
            </>
          )}
          <button
            onClick={() => {
              selection.current?.stop();
              setBusy(false);
              setSelected(undefined);
              setRecords(undefined);
              setError(undefined);
              lastRead.current = undefined;
              returnFocus.current = true;
            }}
          >
            {t('execution.closeEvidence')}
          </button>
        </aside>
      )}
      <details>
        <summary>{t('execution.technical')}</summary>
        <p>
          {totals.methodVersion} · {summary.uses.detail.reason}
        </p>
        <pre>{JSON.stringify(totals.coverage, null, 2)}</pre>
      </details>
    </section>
  );
}
