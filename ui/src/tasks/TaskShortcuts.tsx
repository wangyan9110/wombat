import type { UsageClient, UsageItem } from '@wombat/client';
import { t } from '@wombat/client/locale';
import { QueryError } from '../Feedback.js';
import { linkedReturn, type Route } from '../state.js';
import { useUsageQuery } from '../useUsageQuery.js';
import type { TaskSuggestionSummary } from './useTaskSuggestions.js';

type Turn = Extract<UsageItem, { kind: 'turn' }>;

function turnLabel(key: 'task.latestTurn' | 'task.highestTurn', turn: Turn) {
  if (turn.ordinal != null) return t(key, { number: turn.ordinal });
  return key === 'task.latestTurn' ? t('task.latestTurnUnknown') : t('task.highestTurnUnknown');
}

export function TaskShortcuts({
  client,
  snapshotId,
  thread,
  route,
  navigate,
  suggestion,
}: {
  client: UsageClient;
  snapshotId: string;
  thread: string;
  route: Route;
  navigate: (patch: Partial<Route>) => void;
  suggestion?: TaskSuggestionSummary;
}) {
  const base = {
    action: 'turns' as const,
    snapshotId,
    threadId: thread,
    scope: { allTime: true, timezone: route.timezone },
    matchedOnly: false,
    limit: 1,
  };
  const latest = useUsageQuery(client, { ...base, sort: 'recent' });
  const highest = useUsageQuery(client, { ...base, sort: 'tokens' });
  const latestTurn = latest.result?.items.find((item): item is Turn => item.kind === 'turn');
  const highestTurn = highest.result?.items.find(
    (item): item is Turn => item.kind === 'turn' && item.usage.measurementCount > 0,
  );
  const openTurn = (turn: Turn) =>
    navigate({ thread, turn: turn.id, turnView: 'all', turnSort: 'time', turnOffset: 0 });
  const openSuggestions = () =>
    suggestion &&
    navigate({
      page: suggestion.target,
      returnTo: linkedReturn(route),
      snapshot: snapshotId,
      configThread: thread,
      configView: undefined,
      configId: undefined,
      configOffset: 0,
      instructionSuggestions: suggestion.target === 'instructions' || undefined,
      extensionSuggestions: suggestion.target === 'extensions' || undefined,
    });
  return (
    <div className="task-shortcuts">
      {latestTurn && (
        <button onClick={() => openTurn(latestTurn)}>
          {turnLabel('task.latestTurn', latestTurn)}
        </button>
      )}
      <button
        onClick={() => {
          document.querySelector('.task-turns')?.scrollIntoView({ block: 'start' });
          navigate({ thread, turn: undefined, turnView: 'all', turnSort: 'time', turnOffset: 0 });
        }}
      >
        {t('task.viewAllTurns')}
      </button>
      {highestTurn && (
        <button onClick={() => openTurn(highestTurn)}>
          {turnLabel('task.highestTurn', highestTurn)}
        </button>
      )}
      {suggestion && (
        <button onClick={openSuggestions}>
          {t('task.relatedSuggestions', { count: suggestion.count })}
        </button>
      )}
      {latest.error && (
        <QueryError error={latest.error} code={latest.errorCode} retry={latest.retry} />
      )}
      {highest.error && (
        <QueryError error={highest.error} code={highest.errorCode} retry={highest.retry} />
      )}
    </div>
  );
}
