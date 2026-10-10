import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  CoreError,
  type UsageClient,
  type UsageRequest,
  type UsageResult,
  type TimingLocalResult,
} from '@wombat/client';
import { readUsagePage } from './state.js';

type Turn = Extract<UsageResult['items'][number], { kind: 'turn' }>;
export function selectedTimingTurn(
  result: UsageResult,
  selected?: string,
  sort?: string | null,
): string | undefined {
  const turns = result.items.filter((item): item is Turn => item.kind === 'turn');
  if (selected === 'closed') return undefined;
  return (
    turns.find((turn) => turn.id === selected)?.id ??
    (sort === 'recent'
      ? turns[0]?.id
      : turns.find((turn) => turn.matchedUsage.measurementCount > 0)?.id) ??
    turns[0]?.id
  );
}
export interface TimingGroupState {
  usage?: UsageResult;
  summary?: TimingLocalResult;
  turnId?: string;
  loading: boolean;
  timingLoading: boolean;
  error?: string;
  errorCode?: string;
  expired?: boolean;
  unavailable?: boolean;
}
const groupIdentity = (request: UsageRequest, selected?: string) =>
  JSON.stringify([{ ...request, snapshotId: undefined }, selected]);
/** One committed turn group; replacement reads remain private until both versions agree. */
export class TurnReadGroup {
  private state: TimingGroupState = { loading: true, timingLoading: false };
  private listeners = new Set<() => void>();
  private abort?: AbortController;
  private epoch = 0;
  private identity = '';
  constructor(private client: UsageClient) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  matches = (request: UsageRequest, selected?: string) =>
    this.identity === groupIdentity(request, selected);
  private publish(state: TimingGroupState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  stop = () => {
    this.epoch++;
    this.abort?.abort();
  };
  async read(request: UsageRequest, selected?: string) {
    this.stop();
    const epoch = this.epoch,
      abort = (this.abort = new AbortController());
    const identity = groupIdentity(request, selected);
    const previous = identity === this.identity ? this.state : undefined;
    this.identity = identity;
    const retained = previous?.usage;
    this.publish({
      ...previous,
      loading: true,
      timingLoading: !!retained,
      error: undefined,
      errorCode: undefined,
      expired: previous?.expired,
    });
    const active = () => epoch === this.epoch && !abort.signal.aborted;
    try {
      const usage = await readUsagePage(this.client, request, { signal: abort.signal });
      if (!active()) return;
      const turnId = selectedTimingTurn(usage, selected, request.sort),
        snapshotId = usage.snapshotRef.snapshotId;
      if (!turnId || !this.client.timing) {
        this.publish({
          usage,
          turnId,
          loading: false,
          timingLoading: false,
          unavailable: !!turnId,
        });
        return;
      }
      // Initial usage is useful before diagnostics. A replacement keeps the old entire group.
      if (!retained) this.publish({ usage, turnId, loading: false, timingLoading: true });
      const turn = usage.items.find(
        (item): item is Turn => item.kind === 'turn' && item.id === turnId,
      )!;
      const summary = await this.client.timing(
        {
          action: 'summary',
          threadId: turn.threadId,
          turnId,
          snapshotId,
          privacyProfile: 'local',
          mode: 'cached',
        },
        { signal: abort.signal },
      );
      if (!active()) return;
      if (
        summary.action !== 'summary' ||
        summary.profile !== 'local' ||
        summary.readView.snapshotId !== snapshotId ||
        summary.scope.threadId !== turn.threadId ||
        summary.scope.turnId !== turnId
      )
        throw new CoreError('PROTOCOL_ERROR', 'Timing read identity does not match the turn group');
      this.publish({ usage, turnId, summary, loading: false, timingLoading: false });
    } catch (error) {
      if (active()) {
        const code = error instanceof CoreError ? error.code : 'INTERNAL_ERROR';
        this.publish({
          ...this.state,
          loading: false,
          timingLoading: false,
          error: code,
          errorCode: code,
          expired: code === 'VIEW_EXPIRED' || !!this.state.expired,
        });
      }
    }
  }
}
export function useTiming(client: UsageClient, request: UsageRequest, selected?: string) {
  const group = useMemo(() => new TurnReadGroup(client), [client]);
  const state = useSyncExternalStore(group.subscribe, group.getSnapshot, group.getSnapshot);
  const key = JSON.stringify([request, selected]);
  useEffect(() => {
    void group.read(request, selected);
    return group.stop;
  }, [group, key]);
  return {
    ...(group.matches(request, selected) ? state : { loading: true, timingLoading: false }),
    retry: () => {
      void group.read(request, selected);
    },
  };
}
