import type { AccountResult, UsageClient } from '@wombat/client';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface AccountState {
  data?: AccountResult;
  busy: boolean;
  error?: { message: string; code?: string };
  refresh: () => void;
}
/** A workspace shares one observation across Overview and the account dialog. */
export function useAccount(client: UsageClient, active: boolean): AccountState {
  const [data, setData] = useState<AccountResult>(), [busy, setBusy] = useState(false);
  const [error, setError] = useState<AccountState['error']>();
  const pending = useRef<AbortController | undefined>(undefined);
  const read = useCallback(async (action: 'read' | 'refresh') => {
    if (!client.account) return;
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError(undefined);
    try { const result = await client.account({ action }, { signal: controller.signal }); if (!controller.signal.aborted) setData(result); }
    catch (e) {
      if (!controller.signal.aborted) {
        const failure = e as Error & { code?: string }; setError({ message: failure.message, code: failure.code });
        setData(previous => previous ? { ...previous, ordinaryUsageAllowed: null,
          account: { ...previous.account, status: previous.account.checkedAt ? 'stale' : previous.account.status },
          allowance: { ...previous.allowance, status: previous.allowance.checkedAt ? 'stale' : previous.allowance.status },
          activity: { ...previous.activity, status: previous.activity.checkedAt ? 'stale' : previous.activity.status },
        } : undefined);
      }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }, [client]);
  useEffect(() => { setData(undefined); setError(undefined); return () => pending.current?.abort(); }, [client]);
  useEffect(() => { if (active) void read('read'); }, [active, read]);
  return { data, busy, error, refresh: () => void read('refresh') };
}
