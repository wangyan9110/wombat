import type { ConfigItem, ConfigRequest, OptimizeSuggestion, UsageClient } from '@wombat/client';
import { useEffect, useRef, useState } from 'react';
import { shiftDate, type Route } from '../state.js';

export interface TaskSuggestionSummary {
  count: number;
  target: 'instructions' | 'extensions';
}

interface ReadResult {
  readView: string;
  byThread: Map<string, TaskSuggestionSummary>;
}

function scope(route: Route, threadId?: string): ConfigRequest['scope'] {
  return {
    allTime: route.allTime || undefined,
    since: route.allTime ? undefined : route.since,
    until: route.allTime ? undefined : shiftDate(route.until, 1),
    timezone: route.timezone,
    project: route.project,
    agentKind: route.agent,
    sourceInstanceId: route.source,
    threadId,
  };
}

async function allSuggestions(
  client: UsageClient,
  readView: string,
  route: Route,
  signal: AbortSignal,
) {
  const suggestions: OptimizeSuggestion[] = [];
  let offset: number | null = 0;
  while (offset != null) {
    const page = await client.optimize!(
      {
        action: 'list',
        readView,
        project: route.project,
        sourceInstanceId: route.source,
        group: 'pending',
        offset,
        limit: 200,
      },
      { signal },
    );
    suggestions.push(...page.suggestions);
    if (suggestions.length >= 20_000)
      throw new Error('Task suggestion association exceeded the supported result limit.');
    if (page.page.nextOffset != null && page.page.nextOffset <= offset)
      throw new Error('Task suggestion pagination did not advance.');
    offset = page.page.nextOffset ?? null;
  }
  return suggestions;
}

async function relatedItems(
  client: UsageClient,
  readView: string,
  route: Route,
  threadId: string,
  signal: AbortSignal,
) {
  const items: ConfigItem[] = [];
  let offset: number | null = 0;
  while (offset != null) {
    const page = await client.config!(
      {
        action: 'list',
        readView,
        scope: scope(route, threadId),
        kinds: ['rule', 'skill', 'mcp', 'hook'],
        offset,
        limit: 200,
      },
      { signal },
    );
    items.push(...page.items);
    if (items.length >= 20_000)
      throw new Error('Task configuration association exceeded the supported result limit.');
    if (page.page.nextOffset != null && page.page.nextOffset <= offset)
      throw new Error('Task configuration pagination did not advance.');
    offset = page.page.nextOffset ?? null;
  }
  return items;
}

/** Reuse the existing configuration-evidence relation and current suggestion detector. */
export async function readTaskSuggestionCounts(
  client: UsageClient,
  snapshotId: string,
  route: Route,
  threadIds: string[],
  signal: AbortSignal,
  readView?: string,
): Promise<ReadResult> {
  if (!client.config || !client.optimize || route.unassigned || threadIds.length === 0)
    return { readView: readView ?? '', byThread: new Map() };
  const first = await client.config(
    {
      action: 'list',
      ...(readView ? { readView } : { snapshotId }),
      scope: scope(route),
      kinds: ['rule', 'skill', 'mcp', 'hook'],
      offset: 0,
      limit: 1,
    },
    { signal },
  );
  if (!first.readView) return { readView: '', byThread: new Map() };
  const suggestions = await allSuggestions(client, first.readView, route, signal);
  const byItem = new Map<string, OptimizeSuggestion[]>();
  for (const suggestion of suggestions) {
    const values = byItem.get(suggestion.item.id) ?? [];
    values.push(suggestion);
    byItem.set(suggestion.item.id, values);
  }
  const byThread = new Map<string, TaskSuggestionSummary>();
  if (byItem.size === 0) return { readView: first.readView, byThread };
  for (const threadId of threadIds) {
    const items = await relatedItems(client, first.readView, route, threadId, signal);
    const matched = new Map<string, OptimizeSuggestion>();
    let hasRule = false;
    for (const item of items)
      for (const suggestion of byItem.get(item.id) ?? []) {
        matched.set(suggestion.id, suggestion);
        hasRule ||= suggestion.item.kind === 'rule';
      }
    if (matched.size > 0)
      byThread.set(threadId, {
        count: matched.size,
        target: hasRule ? 'instructions' : 'extensions',
      });
  }
  return { readView: first.readView, byThread };
}

export function useTaskSuggestions(
  client: UsageClient,
  snapshotId: string,
  route: Route,
  threadIds: string[],
) {
  const view = useRef<{ snapshotId: string; readView: string } | undefined>(undefined);
  const [state, setState] = useState<{ key?: string; values: Map<string, TaskSuggestionSummary> }>({
    values: new Map(),
  });
  const key = JSON.stringify([
    snapshotId,
    threadIds,
    route.allTime,
    route.since,
    route.until,
    route.timezone,
    route.project,
    route.unassigned,
    route.agent,
    route.source,
  ]);
  useEffect(() => {
    const controller = new AbortController();
    const pinned = view.current?.snapshotId === snapshotId ? view.current.readView : undefined;
    const read = async () => {
      try {
        return await readTaskSuggestionCounts(
          client,
          snapshotId,
          route,
          threadIds,
          controller.signal,
          pinned,
        );
      } catch (error) {
        if (pinned && (error as { code?: string }).code === 'VIEW_EXPIRED')
          return readTaskSuggestionCounts(client, snapshotId, route, threadIds, controller.signal);
        throw error;
      }
    };
    void read().then(
      (result) => {
        if (controller.signal.aborted) return;
        if (result.readView) view.current = { snapshotId, readView: result.readView };
        setState({ key, values: result.byThread });
      },
      () => {
        if (!controller.signal.aborted) setState({ key, values: new Map() });
      },
    );
    return () => controller.abort();
  }, [client, key, snapshotId]);
  return state.key === key ? state.values : new Map<string, TaskSuggestionSummary>();
}
