import type { UsageResult } from '@wombat/client';
import { t, storageFailureText } from '@wombat/client/locale';
import { Empty } from './components.js';
import { connectionExpired } from './session.js';

export function QueryError({
  error,
  code,
  retry,
  hasResult = true,
  previousResultAt,
  provisional = false,
  operation = 'read',
}: {
  error: string;
  code?: string;
  retry: () => void;
  hasResult?: boolean;
  previousResultAt?: string;
  provisional?: boolean;
  operation?: 'read' | 'send';
}) {
  const expired = connectionExpired(code);
  const changed = code === 'VIEW_EXPIRED' || code === 'NOT_FOUND';
  const message =
    code === 'NOT_FOUND'
      ? t('webui.notFoundHint')
      : changed
        ? t('webui.viewExpiredHint')
        : (storageFailureText(code) ?? error);
  const sending = operation === 'send',
    unknown = sending && code === 'HANDOFF_UNKNOWN';
  return (
    <div className="warning-box" role="alert">
      <h3>
        {expired
          ? t('webui.sessionExpired')
          : sending
            ? t(unknown ? 'handoff.deliveryUnknown' : 'handoff.sendFailed')
            : error === 'CANCELLED'
              ? t(
                  provisional
                    ? 'webui.cancelledPreview'
                    : hasResult
                      ? 'webui.cancelled'
                      : 'webui.cancelledFirst',
                )
              : t('webui.failed')}
      </h3>
      {expired ? (
        <p>{t('webui.sessionRecovery')}</p>
      ) : (
        <>
          {error !== 'CANCELLED' && (
            <p>
              {unknown
                ? t('handoff.unknown')
                : sending && code === 'CODEX_UNAVAILABLE'
                  ? t('handoff.unavailableRecovery')
                  : message}
            </p>
          )}
          {previousResultAt && <p>{t('webui.previousResult', { time: previousResultAt })}</p>}
          <button onClick={retry}>
            {t(changed ? 'config.refresh' : sending ? 'handoff.reviewAgain' : 'webui.retry')}
          </button>
        </>
      )}
    </div>
  );
}
export function emptyReason(result: UsageResult) {
  if (result.freshness?.initialScan && result.freshness.status !== 'failed') return 'initialScan';
  if (result.quality.sources.length && result.quality.sources.every((s) => s.status === 'notFound'))
    return 'sourceNotFound';
  if (result.quality.sources.length && result.quality.sources.every((s) => s.status === 'failed'))
    return 'sourceUnreadable';
  if (
    result.quality.sources.length &&
    result.quality.sources.every((s) => s.status === 'unsupported')
  )
    return 'sourceUnsupported';
  if (
    result.quality.status === 'partial' ||
    result.quality.sources.some((s) => s.status !== 'complete')
  )
    return 'sourceIncomplete';
  const scope = result.scope ?? {};
  const filtered = [
    scope.project,
    scope.projectUnknown,
    scope.agentKind,
    scope.sourceInstanceId,
    scope.threadId,
    scope.model,
    scope.modelUnknown,
    scope.reasoningEffort,
    scope.effortUnknown,
    scope.undated,
  ].some(Boolean);
  if (
    scope.allTime &&
    !filtered &&
    result.facets?.discoveredThreadCount &&
    result.summary?.measurementCount === 0
  )
    return 'noUsage';
  return result.facets?.agents.length || result.facets?.discoveredThreadCount
    ? 'noMatch'
    : 'noLogs';
}
export function EmptyUsage({
  result,
  sources,
  clear,
  dates,
  filtered,
  tasks,
  paused = false,
}: {
  result: UsageResult;
  sources: () => void;
  clear: () => void;
  dates: () => void;
  filtered: boolean;
  tasks?: () => void;
  paused?: boolean;
}) {
  const reason = emptyReason(result);
  return (
    <Empty
      title={reason === 'noMatch' ? t('webui.noRecordsMatched') : t(`webui.${reason}`)}
      copy={
        reason === 'initialScan' && paused
          ? t('webui.initialScanPausedHint')
          : reason === 'noMatch'
            ? t('webui.emptyHint')
            : t(`webui.${reason}Hint`)
      }
    >
      <div className="actions">
        {filtered && <button onClick={clear}>{t('webui.clearFilters')}</button>}
        {result.availableRange?.since && result.availableRange?.until && (
          <button onClick={dates}>{t('webui.availableDates')}</button>
        )}
        {tasks && !!result.facets?.discoveredThreadCount && (
          <button onClick={tasks}>{t('webui.discoveredTasks')}</button>
        )}
        <button onClick={sources}>{t('webui.sources')}</button>
      </div>
    </Empty>
  );
}
