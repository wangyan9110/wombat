import { numberLabel } from '@wombat/client/locale';
import { useState } from 'react';
import type { UsageClient, UsageResult, UsageScope } from '@wombat/client';
import { t } from '@wombat/client/locale';
import { Pagination, SummaryToken, amount, directoryName } from './components.js';
import { QueryError } from './Feedback.js';
import { scopeOf, shiftDate, type Route } from './state.js';
import { useUsageQuery } from './useUsageQuery.js';
type Change = NonNullable<UsageResult['comparison']>['delta'];
function Delta({ delta }: { delta: Change }) {
  return (
    <span>
      {delta.tokens == null ? '—' : `${delta.tokens > 0 ? '+' : ''}${numberLabel(delta.tokens)}`}{' '}
      Token ·{' '}
      {delta.cost == null ? '—' : `${delta.cost.startsWith('-') ? '' : '+'}${delta.cost} USD`}
    </span>
  );
}
export function PublicationChanges({ result }: { result: UsageResult }) {
  const c = result.freshness?.publicationChange;
  if (!c) return null;
  return (
    <details className="provenance">
      <summary>{t('comparison.refresh')}</summary>
      <p>
        {t('comparison.refreshCounts', {
          added: c.measurementsAdded,
          changed: c.measurementsChanged,
          removed: c.measurementsRemoved,
          threads: c.threadsAdded,
          turns: c.turnsChanged,
        })}
      </p>
      <p>
        {t('comparison.refreshBasis', {
          prices: t(c.pricesChanged ? 'comparison.changed' : 'comparison.unchanged'),
          coverage: t(c.coverageChanged ? 'comparison.changed' : 'comparison.unchanged'),
        })}
      </p>
      <p>
        <Delta delta={c.delta} />
      </p>
      <p className="note">{t('comparison.refreshNote')}</p>
      <p>
        <code>{c.baseline.snapshotId}</code> → <code>{c.current.snapshotId}</code>
      </p>
    </details>
  );
}
export function PeriodComparison({
  client,
  result,
  route,
  drill,
  refresh,
}: {
  client: UsageClient;
  result: UsageResult;
  route: Route;
  drill: (scope: UsageScope) => void;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="panel usage-comparison">
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>{t('comparison.comparePrevious')}</summary>
        {open &&
          (route.allTime || route.undated ? (
            <p>{t('comparison.dates')}</p>
          ) : (
            <PeriodResult
              key={JSON.stringify([scopeOf(route), result.snapshotRef.snapshotId])}
              client={client}
              result={result}
              route={route}
              drill={drill}
              refresh={refresh}
            />
          ))}
      </details>
    </section>
  );
}
function PeriodResult({
  client,
  result,
  route,
  drill,
  refresh,
}: {
  client: UsageClient;
  result: UsageResult;
  route: Route;
  drill: (scope: UsageScope) => void;
  refresh: () => void;
}) {
  const scope = scopeOf(route),
    days = Math.round((Date.parse(scope.until!) - Date.parse(scope.since!)) / 86400000);
  const [since, setSince] = useState(shiftDate(scope.since!, -days));
  const [until, setUntil] = useState(scope.since!);
  const [dimension, setDimension] = useState<'project' | 'model' | 'thread'>('project');
  const [offset, setOffset] = useState(0);
  const q = useUsageQuery(client, {
    action: 'compare',
    snapshotId: result.snapshotRef.snapshotId,
    scope,
    comparison: { kind: 'periods', baselineSince: since, baselineUntil: until, dimension },
    offset,
    limit: 10,
  });
  const c = q.result?.comparison;
  return (
    <>
      <div className="section-head">
        <label>
          {t('comparison.baseline')}{' '}
          <input
            type="date"
            aria-label={t('comparison.baseline')}
            value={since}
            onChange={(e) => {
              setSince(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label>
          {t('comparison.endDate')}{' '}
          <input
            type="date"
            aria-label={t('comparison.endDate')}
            value={until}
            onChange={(e) => {
              setUntil(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <select
          aria-label={t('webui.dimension')}
          value={dimension}
          onChange={(e) => {
            setDimension(e.target.value as typeof dimension);
            setOffset(0);
          }}
        >
          <option value="project">{t('webui.directory')}</option>
          <option value="model">{t('webui.model')}</option>
          <option value="thread">{t('webui.threadId')}</option>
        </select>
      </div>
      {q.loading && <p role="status">{t('webui.loading')}</p>}
      {q.error && (
        <QueryError error={q.error} code={q.errorCode} retry={q.expired ? refresh : q.retry} />
      )}
      {c?.kind === 'periods' && (
        <>
          <dl className="review-metrics">
            <div>
              <dt>{t('comparison.baseline')}</dt>
              <dd>
                <SummaryToken summary={c.baseline.usage} /> Token · {amount(c.baseline.usage)}
              </dd>
            </div>
            <div>
              <dt>{t('comparison.current')}</dt>
              <dd>
                <SummaryToken summary={c.current.usage} /> Token · {amount(c.current.usage)}
              </dd>
            </div>
            <div>
              <dt>{t('comparison.delta')}</dt>
              <dd>
                <Delta delta={c.delta} />
              </dd>
            </div>
          </dl>
          {(c.baseline.partial || c.current.partial) && (
            <p className="read-notice">{t('comparison.partial')}</p>
          )}
          <div className="report-table-wrap">
            <table className="project-table">
              <thead>
                <tr>
                  <th>{t('comparison.drivers')}</th>
                  <th>{t('comparison.baseline')}</th>
                  <th>{t('comparison.current')}</th>
                  <th>{t('comparison.delta')}</th>
                </tr>
              </thead>
              <tbody>
                {c.drivers.map((d) => (
                  <tr key={JSON.stringify(d.key)}>
                    <td>
                      {dimension === 'project'
                        ? directoryName(d.key)
                        : (d.key ?? t('webui.unknown'))}
                    </td>
                    <td>
                      <button
                        className="link"
                        disabled={dimension === 'thread' && d.key == null}
                        onClick={() => drill(d.baseline.scope)}
                      >
                        <SummaryToken summary={d.baseline.usage} />
                      </button>
                    </td>
                    <td>
                      <button
                        className="link"
                        disabled={dimension === 'thread' && d.key == null}
                        onClick={() => drill(d.current.scope)}
                      >
                        <SummaryToken summary={d.current.usage} />
                      </button>
                    </td>
                    <td>
                      <Delta delta={d.delta} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            {t('comparison.remaining')}: <Delta delta={c.remaining} />
          </p>
          <Pagination page={q.result!.page} onPage={setOffset} />
          <p className="note">{t('comparison.note')}</p>
          {c.undatedRecords > 0 && (
            <p className="note">{t('comparison.undated', { count: c.undatedRecords })}</p>
          )}
        </>
      )}
    </>
  );
}
export function SessionComparison({
  client,
  snapshotId,
  threadId,
  route,
  refresh,
  openThread,
  choices,
}: {
  choices: { id: string; title?: string | null }[];
  client: UsageClient;
  snapshotId: string;
  threadId: string;
  route: Route;
  refresh: () => void;
  openThread: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [other, setOther] = useState(''),
    [selected, setSelected] = useState(''),
    [family, setFamily] = useState(false);
  return (
    <details className="provenance" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t('comparison.sessions')}</summary>
      {open && (
        <>
          <form
            className="search-form"
            onSubmit={(e) => {
              e.preventDefault();
              setSelected(other.trim());
            }}
          >
            <input
              list="comparison-sessions"
              aria-label={t('comparison.other')}
              placeholder={t('comparison.other')}
              value={other}
              onChange={(e) => setOther(e.target.value)}
            />
            <button disabled={!other.trim() || other.trim() === threadId}>
              {t('comparison.submit')}
            </button>
          </form>
          <datalist id="comparison-sessions">
            {choices
              .filter((s) => s.id !== threadId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title ?? s.id}
                </option>
              ))}
          </datalist>
          <label>
            <input type="checkbox" checked={family} onChange={(e) => setFamily(e.target.checked)} />
            {t('comparison.family')}
          </label>
          {selected && (
            <SessionResult
              key={JSON.stringify([selected, family, snapshotId, threadId])}
              client={client}
              snapshotId={snapshotId}
              threadId={threadId}
              other={selected}
              family={family}
              route={route}
              refresh={refresh}
              openThread={openThread}
            />
          )}
        </>
      )}
    </details>
  );
}
function SessionResult({
  client,
  snapshotId,
  threadId,
  other,
  family,
  route,
  refresh,
  openThread,
}: {
  client: UsageClient;
  snapshotId: string;
  threadId: string;
  other: string;
  family: boolean;
  route: Route;
  refresh: () => void;
  openThread: (id: string) => void;
}) {
  const q = useUsageQuery(client, {
    action: 'compare',
    snapshotId,
    scope: scopeOf(route),
    comparison: {
      kind: 'sessions',
      leftThreadId: threadId,
      rightThreadId: other,
      includeDescendants: family,
    },
  });
  const c = q.result?.comparison;
  return (
    <>
      {q.loading && <p role="status">{t('webui.loading')}</p>}
      {q.error && (
        <QueryError error={q.error} code={q.errorCode} retry={q.expired ? refresh : q.retry} />
      )}
      {c?.kind === 'sessions' && (
        <>
          <div className="report-table-wrap">
            <table className="project-table">
              <thead>
                <tr>
                  <th>{t('webui.threadId')}</th>
                  <th>{t('comparison.own')}</th>
                  {family && <th>{t('comparison.descendants')}</th>}
                  <th>{t('webui.recordedTokens')}</th>
                </tr>
              </thead>
              <tbody>
                {[c.left, c.right].map((s) => (
                  <tr key={s.threadId}>
                    <td>
                      <button className="link" onClick={() => openThread(s.threadId)}>
                        {s.title ?? s.threadId}
                      </button>
                      {family && <small>{t('comparison.members', { count: s.memberCount })}</small>}
                    </td>
                    <td>
                      <SummaryToken summary={s.own} />
                    </td>
                    {family && (
                      <td>
                        <SummaryToken summary={s.descendants} />
                      </td>
                    )}
                    <td>
                      <SummaryToken summary={s.selected} /> Token · {amount(s.selected)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <Delta delta={c.delta} />
          </p>
          {(c.left.partial || c.right.partial) && (
            <p className="read-notice">{t('comparison.partial')}</p>
          )}
          <p className="note">{t('comparison.sessionNote')}</p>
        </>
      )}
    </>
  );
}
