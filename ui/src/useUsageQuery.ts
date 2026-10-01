import { useEffect, useState } from 'react';
import type { UsageClient, UsageRequest, UsageResult } from '@wombat/client';
import { readUsagePage } from './state.js';

export function usageQueryKey(request: UsageRequest) { return JSON.stringify(request); }

/** Keep the same reading position while a replacement version loads; scope and page changes hide prior results. */
export function useUsageQuery(client: UsageClient, request: UsageRequest) {
  const key = usageQueryKey(request);
  const identity = JSON.stringify({ ...request, snapshotId: undefined });
  const [state, setState] = useState<{ key: string; identity: string; errorCode?: string; result?: UsageResult; error?: string; expired?: boolean }>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setState(previous => previous?.identity === identity ? previous : undefined);
    void readUsagePage(client, request, { signal: abort.signal }).then(result => {
      if (!abort.signal.aborted) setState({ key, identity, result });
    }).catch(error => {
      if (!abort.signal.aborted) setState({ key, identity, errorCode: error.code, error: String(error.message), expired: error.code === 'VIEW_EXPIRED' });
    });
    return () => abort.abort();
  }, [client, key, retry]);
  const current = state?.identity === identity ? state : undefined;
  return { ...current, loading: !current || current.key !== key, retry: () => setRetry(value => value + 1) };
}
