import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { UsageClient } from '@wombat/client';
import { Workspace, workspaceKey } from './workspace.js';
import type { Route } from './state.js';
export type { WorkspaceData } from './workspace.js';

export function useWorkspace(client: UsageClient, route: Route) {
  const workspace = useMemo(() => new Workspace(client), [client]);
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const key = workspaceKey(route);
  useEffect(() => {
    const visibility = () => workspace.setVisible(document.visibilityState !== 'hidden');
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => { document.removeEventListener('visibilitychange', visibility); workspace.stop(); };
  }, [workspace]);
  useEffect(() => { void workspace.navigate(route); }, [workspace, key]);
  return { ...state, refresh: workspace.refresh, cancel: workspace.cancel, setReading: workspace.setReading };
}
