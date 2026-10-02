import {useEffect,useRef,useState} from 'react';
import type {ConfigRequest,ConfigResult,UsageClient} from '@wombat/client';
import {t} from '@wombat/client/locale';
import {shiftDate,type Route} from './state.js';
export function configRequest(route: Route): ConfigRequest {
  return {
    action: 'list', readView: route.configView, snapshotId: route.configView ? undefined : route.snapshot,
    scope: { allTime:route.allTime||undefined,since: route.allTime?undefined:route.since, until: route.allTime?undefined:shiftDate(route.until, 1), timezone: route.timezone, project: route.project,
      agentKind: route.agent, sourceInstanceId: route.source, threadId: route.configThread },
    kind: route.configKind, observation: route.configState, sort: route.configSort ?? 'tokens', search: route.configSearch,
    offset: route.configOffset ?? 0, limit: 30,
  };
}
export function useConfig(client: UsageClient, request?: ConfigRequest) {
  const active = useRef<AbortController | undefined>(undefined);
  const [state, setState] = useState<{ key?: string; data?: ConfigResult; loading: boolean; error?: string; code?: string }>({ loading: false });
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify(request);
  useEffect(() => {
    if (!key) { setState({ loading: false }); return; }
    const controller = new AbortController();
    active.current = controller;
    setState({ key, loading: true });
    const run = async () => {
      if (!client.config) throw new Error(t('webui.unsupported'));
      return client.config(JSON.parse(key) as ConfigRequest, { signal: controller.signal });
    };
    void run().then(data => { if (!controller.signal.aborted) setState({ key, data, loading: false }); }, error => {
      if (!controller.signal.aborted) setState({ key, loading: false, error: String(error.message ?? error), code: error.code });
    });
    return () => controller.abort();
  }, [client, key, retry]);
  // A changed request must not expose the previous response even for the render
  // before its effect runs: that response could pin an obsolete read version.
  return { ...(state.key === key ? state : { loading: !!key }), retry: () => setRetry(n => n + 1), cancel: () => { active.current?.abort(); setState({ key, loading: false, error: 'CANCELLED', code: 'CANCELLED' }); } };
}
