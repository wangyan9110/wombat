import type { UsageClient, UsageRequest, UsageResult, QueryOptions } from '@wombat/client';
import { connectionExpired } from './session.js';
import { readUsage, readUsagePage, scopeOf, type Route } from './state.js';

export interface WorkspaceData { overview: UsageResult; list: UsageResult; peak?: UsageResult; route: Route }
interface State { data?: WorkspaceData; loading: boolean; progress: string; error: string; renewed: boolean; updatesAvailable: boolean; errorCode?: string }
export function workspaceKey(route: Route) {
  return JSON.stringify({ ...route, turnView: undefined, turn: undefined, turnSort: undefined, turnOffset: undefined, periodSort: undefined });
}

/** Coordinates one visible workspace. Completed results are bounded and scoped to one version. */
export class Workspace {
  private state: State = { loading: false, progress: '', error: '', errorCode: undefined, renewed: false, updatesAvailable: false };
  private listeners = new Set<() => void>();
  private route?: Route;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private visible = true;
  private paused = false;
  private reading = false;
  setReading = (reading: boolean) => { this.reading = reading; };
  private cache = new Map<string, UsageResult>();
  private version?: string;
  constructor(private client: UsageClient, private interval = 3000) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  private clearTimer() { clearTimeout(this.timer); this.timer = undefined; }
  private schedule() {
    this.clearTimer();
    if (this.client.live && !this.route?.snapshot && this.visible && !this.paused && this.route && !['prices', 'optimize', 'config'].includes(this.route.page))
      this.timer = setTimeout(() => { void this.check(); }, this.interval);
  }
  stop() { this.paused = true; this.clearTimer(); this.controller?.abort(); }
  setVisible(visible: boolean) {
    const resumed = visible && !this.visible;
    this.visible = visible;
    if (!visible) this.clearTimer();
    else if (resumed && !this.paused && !this.controller) void this.check();
  }
  navigate(route: Route) {
    this.route = route;
    if (connectionExpired(this.state.errorCode)) return Promise.resolve();
    this.paused = false;
    return this.load(false, false);
  }
  refresh = () => { if (connectionExpired(this.state.errorCode)) return; this.paused = false; void this.load(true, true); };
  cancel = () => { this.stop(); this.publish({ loading: false, progress: '', error: 'CANCELLED' }); };
  check = async () => { if (!this.paused && !this.controller && this.visible) await this.load(true, false); };

  private async load(probe: boolean, fresh: boolean) {
    this.clearTimer();
    this.controller?.abort();
    const route = this.route;
    if (!route || ['prices', 'optimize', 'config'].includes(route.page)) {
      this.controller = undefined;
      this.publish({ loading: false, error: '', progress: '' });
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    const options: QueryOptions = { signal: controller.signal, onProgress: progress => {
      if (!controller.signal.aborted) this.publish({ progress });
    } };
    const scope = scopeOf(route);
    const sameScope = this.state.data && this.state.data.route.snapshot === route.snapshot && JSON.stringify(scopeOf(this.state.data.route)) === JSON.stringify(scope);
    const background = probe && !fresh && !!this.state.data;
    if (!background) this.publish({ loading: true, progress: '', error: '', renewed: false });
    const read = async (request: UsageRequest) => {
      const key = JSON.stringify(request);
      const cached = this.cache.get(key);
      if (cached) return cached;
      const value = await readUsagePage(this.client, request, options);
      if (!controller.signal.aborted && value.snapshotRef.snapshotId === this.version) {
        if (this.cache.size >= 16) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, value);
      }
      return value;
    };
    const run = async (observe: boolean) => {
      const metadata = !observe && sameScope ? this.state.data!.overview : await readUsage(this.client, {
        action: 'usage', scope, presentation: 'distribution', limit: 1, snapshotId: route.snapshot,
      }, options, fresh ? 'fresh' : 'auto');
      if (controller.signal.aborted) return;
      const snapshotId = metadata.snapshotRef.snapshotId;
      if (background && !this.state.error && snapshotId !== this.state.data?.overview.snapshotRef.snapshotId && (this.reading || route.page === 'threads')) {
        this.publish({ updatesAvailable: true }); return;
      }
      if (snapshotId !== this.version) { this.cache.clear(); this.version = snapshotId; }
      if (background && snapshotId === this.state.data?.overview.snapshotRef.snapshotId && !this.state.error) return;
      this.publish({ loading: true, error: '' });
      const overviewRequest: UsageRequest = { action: 'usage', scope, group: route.group, presentation: 'distribution',
        sort: 'time', limit: 120, offset: route.periodOffset, snapshotId };
      const listRequest: UsageRequest = route.page === 'threads'
        ? { action: 'threads', scope, search: route.search, sort: route.sort, offset: route.offset, limit: 10, locateThreadId: route.thread, snapshotId }
        : { action: 'usage', scope, presentation: route.dimension, sort: route.sort === 'cost' ? 'cost' : 'tokens', offset: route.offset, limit: 20, snapshotId };
      const [overview, list] = await Promise.all([
        route.page === 'usage' ? read(overviewRequest) : Promise.resolve(metadata),
        route.page === 'sources' ? Promise.resolve(metadata) : read(listRequest),
      ]);
      const max = overview.distribution?.maxTokens;
      const peak = route.page === 'usage' && max != null && !overview.items.some(item => item.kind === 'usage' && item.usage.tokens.total === max)
        ? await read({ ...overviewRequest, offset: 0, limit: 1, sort: 'tokens' }) : undefined;
      if (!controller.signal.aborted) this.publish({ data: { overview, list, peak, route }, error: '', errorCode: undefined, updatesAvailable: false });
    };
    try {
      try { await run(probe || !sameScope); }
      catch (error) {
        if (route.snapshot || controller.signal.aborted || (error as { code?: string }).code !== 'VIEW_EXPIRED') throw error;
        this.cache.clear(); this.publish({ renewed: true }); await run(true);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const errorCode = (error as { code?: string }).code;
        if (connectionExpired(errorCode)) this.paused = true;
        this.publish({ error: error instanceof Error ? error.message : String(error), errorCode });
      }
    } finally {
      if (this.controller === controller) {
        this.controller = undefined;
        this.publish({ loading: false, progress: '' });
        this.schedule();
      }
    }
  }
}
