import { CoreError, type UsageClient, type UsageRequest } from '@wombat/client';

export interface FilterOptions { projects: string[]; models: string[]; }

/** Build presentation choices from complete, fixed-snapshot queries, not the visible page. */
export async function loadFilterOptions(query: UsageClient['query'], request: UsageRequest): Promise<FilterOptions> {
  const projects = new Set<string>(), models = new Set<string>();
  const scope = { agentKind: request.scope?.agentKind, sourceInstanceId: request.scope?.sourceInstanceId, threadId: request.scope?.threadId, timezone: 'UTC' };
  let snapshotId = request.snapshotId, generation: string | undefined;
  const queries: UsageRequest[] = [{ action: 'threads', scope }];
  for (const candidateQuery of queries) {
    const { action } = candidateQuery;
    let offset = 0, count = 0, total: number | undefined;
    for (;;) {
      const result = await query({ ...candidateQuery, snapshotId, offset, limit: 500 });
      if (generation && generation !== result.snapshotRef.snapshotId) throw new CoreError('PROTOCOL_ERROR', '筛选候选的快照已变化');
      generation = result.snapshotRef.snapshotId;
      snapshotId = result.snapshotRef.selector ?? generation;
      if (result.action !== action || result.page.offset !== offset || (total !== undefined && result.page.total !== total))
        throw new CoreError('PROTOCOL_ERROR', '筛选候选分页不一致');
      total = result.page.total; count += result.items.length;
      if (action === 'threads' && offset === 0 && request.action === 'usage') {
        // An unbounded usage request uses the report's default range. Query the advertised dated
        // range explicitly, then include undated measurements in a separate native query.
        if (result.availableRange.since && result.availableRange.until)
          queries.push({ action: 'usage', group: 'month', scope: { ...scope, ...result.availableRange } });
        queries.push({ action: 'usage', group: 'month', scope: { ...scope, undated: true } });
      }
      for (const item of result.items) {
        if (item.kind === 'thread' && item.project) projects.add(item.project);
        // Usage also contains measurements without a thread; thread.models alone is insufficient.
        if (item.kind === 'usage' && !item.isSubtotal && item.model) models.add(item.model);
      }
      const next = result.page.nextOffset;
      if (next == null) {
        if (count !== total) throw new CoreError('PROTOCOL_ERROR', '筛选候选未读取完整');
        break;
      }
      if (next !== offset + result.items.length || next <= offset || next >= total)
        throw new CoreError('PROTOCOL_ERROR', '筛选候选分页无效');
      offset = next;
    }
  }
  return { projects: [...projects].sort(), models: [...models].sort() };
}
