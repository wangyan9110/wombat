import type { OptimizeRequest, OptimizeResult, UsageClient } from '@wombat/client';
import { t } from '@wombat/client/locale';
import { useEffect, useRef, useState } from 'react';
import type { Route } from '../state.js';
import { applyReview } from './review-actions.js';
import { statusLabel } from './presentation.js';

export function useReviewActions(client: UsageClient, route: Route, request: OptimizeRequest, data: OptimizeResult | undefined, navigate: (patch: Partial<Route>) => void) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<{ message: string; code?: string }>();
  const [notice, setNotice] = useState<{ scope: string; status?: string; decision?: 'keep' | 'not_applicable'; action: OptimizeRequest['action']; pending: number }>();
  const active = useRef<AbortController | undefined>(undefined);
  const key = JSON.stringify(route), current = useRef(key); current.current = key;
  const scope = JSON.stringify([route.project, route.source, route.unassigned]);
  useEffect(() => {
    setBusy(false); setError(undefined);
    return () => { active.current?.abort(); active.current = undefined; };
  }, [client, key]);
  const run = async (action: OptimizeRequest['action'], suggestionId?: string, decisionReason?: OptimizeRequest['decisionReason']) => {
    if (!data || !client.optimize || active.current) return;
    const c = new AbortController(); active.current = c;
    setBusy(true); setError(undefined); setNotice(undefined);
    const valid = () => !c.signal.aborted && current.current === key && active.current === c;
    try {
      const outcome = await applyReview(client, { ...request, action, suggestionId, decisionReason, readView: data.readView ?? undefined, decisionRevision: data.decisionRevision, offset: 0 }, c.signal);
      if (valid()) {
        setNotice({ scope, status: outcome.target?.status, decision: outcome.target?.decision?.kind, action, pending: outcome.result.pending });
        navigate(outcome.patch);
      }
    } catch (e) {
      if (valid()) { const err = e as Error & { code?: string }; setError({ message: err.message, code: err.code }); }
    } finally {
      if (active.current === c) { active.current = undefined; setBusy(false); }
    }
  };
  const message = notice?.scope !== scope ? undefined : notice.decision && notice.action !== 'recheck'
    ? t(notice.decision === 'keep' ? 'optimize.kept' : 'optimize.inapplicable')
    : notice.status ? statusLabel(notice.status) : t('optimize.recheckSummary', { pending: notice.pending });
  return { busy, error, notice: message, run };
}
