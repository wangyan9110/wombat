import type { OptimizeRequest, UsageClient } from '@wombat/client';
import type { Route } from '../state.js';

/** Read the exact target outcome; a filtered list page cannot prove its result. */
export async function applyReview(
  client: UsageClient,
  request: OptimizeRequest,
  signal: AbortSignal,
) {
  if (!client.optimize) throw new Error('UNSUPPORTED_OPERATION');
  const result = await client.optimize(request, { signal });
  signal.throwIfAborted();
  const target = request.suggestionId
    ? (
        await client.optimize(
          {
            ...request,
            action: 'detail',
            readView: result.readView ?? undefined,
            decisionRevision: result.decisionRevision,
            group: 'history',
            category: undefined,
            decisionReason: undefined,
            offset: 0,
            limit: 1,
          },
          { signal },
        )
      ).suggestions[0]
    : undefined;
  signal.throwIfAborted();
  if (request.suggestionId && (!target || target.id !== request.suggestionId))
    throw new Error('NOT_FOUND');
  const group = target
    ? target.decision || target.status === 'verified'
      ? 'history'
      : 'pending'
    : result.pending > 0
      ? 'pending'
      : 'history';
  const patch: Partial<Route> = {
    optimizeView: result.readView ?? undefined,
    decisionRevision: result.decisionRevision,
    suggestion: undefined,
    suggestionRecord: undefined,
    optimizeOffset: 0,
    configView: undefined,
    optimizeGroup: group,
  };
  return { patch, result, target };
}
