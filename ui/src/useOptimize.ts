import type { OptimizeRequest, OptimizeResult, UsageClient } from '@wombat/client';
import { t } from '@wombat/client/locale';
import { useEffect, useRef, useState } from 'react';
export function useOptimize(client: UsageClient, request: OptimizeRequest) {
  const key = JSON.stringify(request), [retry, setRetry] = useState(0), active = useRef<AbortController | undefined>(undefined);
  const [state, setState] = useState<{ key?: string; data?: OptimizeResult; loading: boolean; error?: string; code?: string }>({ loading: true });
  useEffect(() => {
    const c = new AbortController(); active.current = c; setState({ key, loading: true });
    void (client.optimize ? client.optimize(JSON.parse(key), { signal: c.signal }) : Promise.reject(new Error(t('webui.unsupported')))).then(data => { if (!c.signal.aborted) setState({ key, data, loading: false }); }, e => { if (!c.signal.aborted) setState({ key, loading: false, error: String(e.message ?? e), code: e.code }); }); return () => c.abort();
  }, [client, key, retry]);
  return { ...(state.key === key ? state : { loading: true }), retry: () => setRetry(n => n + 1), cancel: () => { active.current?.abort(); setState({ key, loading: false, error: 'CANCELLED', code: 'CANCELLED' }); } };
}
