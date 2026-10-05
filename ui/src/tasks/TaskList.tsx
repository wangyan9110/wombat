import type { UsageItem, UsageResult } from '@wombat/client';
import { t } from '@wombat/client/locale';
import { SummaryToken, Token, amount, directoryName, timestamp } from '../components.js';
import type { Route } from '../state.js';
import type { TaskSuggestionSummary } from './useTaskSuggestions.js';

export type TaskItem = Extract<UsageItem, { kind: 'thread' }>;

export function TaskListSummary({ result }: { result: UsageResult }) {
  const usage = result.summary;
  return <div className="task-list-summary" aria-label={t('task.currentSummary')}>
    <span><strong>{result.page.total.toLocaleString()}</strong><small>{t('webui.threads')}</small></span>
    <span><strong><SummaryToken summary={usage} /></strong><small>Token</small></span>
    <span><strong>{usage.price.status === 'unknown' ? '—' : amount(usage, 2)}</strong><small>{t('webui.estimate')}</small></span>
  </div>;
}

export function TaskRow({ task, selected, route, suggestion, open }: { task: TaskItem; selected: boolean; route: Route; suggestion?: TaskSuggestionSummary; open: () => void }) {
  const usage = task.matchedUsage;
  return <button className={`thread-row task-row ${selected ? 'active' : ''}`} aria-current={selected ? 'true' : undefined} onClick={open}>
    <strong><span>{task.title?.trim() || t('common.untitled_thread')}</span><span className="task-enter" aria-hidden="true">›</span></strong>
    <span className="row-meta"><span title={task.project ?? ''}>{directoryName(task.project)}</span><span>{task.matchedLastActivityAt ? timestamp(task.matchedLastActivityAt, route.timezone).slice(0, 10) : t('webui.undated')}</span></span>
    <span className="task-row-stats">
      <span>{task.matchedTurnCount == null ? t('task.turnsUnavailable') : t('task.turnCount', { count: task.matchedTurnCount })}</span>
      <span><SummaryToken summary={usage} /> Token</span>
      <span>{usage.price.status === 'unknown' ? t('webui.amountUnknown') : amount(usage, 2)}</span>
      {suggestion && <span className="tag neutral">{t('task.relatedSuggestions', { count: suggestion.count })}</span>}
    </span>
  </button>;
}
