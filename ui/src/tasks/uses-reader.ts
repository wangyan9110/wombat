import {
  CoreError,
  type UsageClient,
  type TimingLocalResult,
  type TimingResult,
} from '@wombat/client';
export type UseObjectsPage = Extract<
  TimingResult,
  { action: 'evidence'; collection: 'use_objects' }
>;
export type UseRecordsPage = Extract<
  TimingResult,
  { action: 'evidence'; collection: 'use_records' }
>;
export type UsesPage = UseObjectsPage | UseRecordsPage;
export type UsesRead = {
  collection: 'use_objects' | 'use_records';
  objectRef?: string;
  cursor?: { token: string };
};
/** A selection generation owns one connection; it never discovers or refreshes a view. */
export class UsesSelection {
  private generation = 0;
  private abort?: AbortController;
  expired = false;
  constructor(
    private client: UsageClient,
    private summary: TimingLocalResult,
  ) {}
  stop = () => {
    this.generation++;
    this.abort?.abort();
  };
  async read(
    request: UsesRead,
  ): Promise<{ superseded: boolean; result?: UsesPage; error?: unknown }> {
    this.stop();
    const generation = this.generation,
      abort = (this.abort = new AbortController());
    try {
      if (this.expired) throw new CoreError('VIEW_EXPIRED', 'Refresh the whole turn group');
      if (!this.client.timing) throw new CoreError('CORE_UNAVAILABLE', 'Timing unavailable');
      const { scope, readView } = this.summary;
      const result = await this.client.timing(
        {
          action: 'evidence',
          collection: request.collection,
          objectRef: request.objectRef,
          cursor: request.cursor,
          limit: 200,
          privacyProfile: 'local',
          snapshotId: readView.snapshotId,
          threadId: scope.threadId,
          turnId: scope.turnId,
          scope: { sourceInstanceId: scope.sourceInstanceId },
        },
        { signal: abort.signal },
      );
      if (abort.signal.aborted) throw new CoreError('CANCELLED', 'Cancelled');
      if (
        result.action !== 'evidence' ||
        result.collection !== request.collection ||
        result.profile !== 'local' ||
        result.snapshotId !== readView.snapshotId ||
        result.methodVersion !== this.summary.methodVersion ||
        result.scope.threadId !== scope.threadId ||
        result.scope.turnId !== scope.turnId ||
        result.scope.sourceInstanceId !== scope.sourceInstanceId ||
        result.scope.agentKind !== scope.agentKind ||
        (result.collection === 'use_records' &&
          (result.objectRef ?? undefined) !== request.objectRef)
      )
        throw new CoreError('PROTOCOL_ERROR', 'Use evidence identity mismatch');
      return { superseded: generation !== this.generation, result: result as UsesPage };
    } catch (error) {
      const superseded = generation !== this.generation;
      if (!superseded && error instanceof CoreError && error.code === 'VIEW_EXPIRED')
        this.expired = true;
      return { superseded, error };
    }
  }
}
