import { CoreError, type QueryOptions, type OptimizeRequest, type OptimizeResult, type TimingRequest, type TimingResult, type UsageClient } from '@wombat/client';

/** Host-issued identities grant access to a fixed view, never arbitrary paths or new scans. */
export function timingAccess(
  client: UsageClient,
  published: Set<string>,
  roots: () => string[] | undefined,
  revalidate: (options: QueryOptions) => Promise<void>,
) {
  const cancelled = (options: QueryOptions) => {
    if (options.signal?.aborted) throw new CoreError('CANCELLED', 'Cancelled');
  };
  return async (request: TimingRequest, options: QueryOptions = {}): Promise<TimingResult> => {
    cancelled(options);
    if (!client.timing) throw new CoreError('TIMING_UNAVAILABLE', 'Timing queries unavailable');
    // The public validator rejects projectRoots, snapshot paths, and all unknown fields.
    if (request.action === 'capabilities') return client.timing(request, options);
    if (request.roots !== undefined || !request.snapshotId || !published.has(request.snapshotId))
      throw new CoreError('INVALID_ARGUMENT', 'Timing requires a read identity published by this host');
    if (request.action === 'evidence' && request.privacyProfile === 'share-v1')
      throw new CoreError('INVALID_ARGUMENT', 'Sharing does not expose local timing evidence');
    const snapshotId = request.snapshotId;
    await revalidate(options);
    cancelled(options);
    if (!published.has(snapshotId)) throw new CoreError('VIEW_EXPIRED', 'Read identity is no longer authorized; reopen the list');
    const selectedRoots = roots();
    const result = await client.timing({ ...request, snapshotId, roots: selectedRoots ? [...selectedRoots] : undefined }, options);
    cancelled(options);
    // A grant change or eviction during the read cannot republish an old identity.
    if (!published.has(snapshotId)) throw new CoreError('VIEW_EXPIRED', 'Read identity is no longer authorized; reopen the list');
    return result;
  };
}

/** Sharing has no local read identity. Call only after validation and cancellation checks. */
export function publishTiming(result: TimingResult, published: Set<string>): void {
  if (result.action === 'summary' && result.profile === 'local') {
    published.add(result.readView.snapshotId);
    while (published.size > 128) published.delete(published.values().next().value!);
  }
}

/** Activity inspection uses the same host-issued fixed-view grant as timing evidence. */
export function activityAccess(client:UsageClient,published:Set<string>,roots:()=>string[]|undefined,revalidate:(options:QueryOptions)=>Promise<void>) {
  return async(request:OptimizeRequest,options:QueryOptions={}):Promise<OptimizeResult>=>{
    const cancelled=()=>{if(options.signal?.aborted)throw new CoreError('CANCELLED','Cancelled');};
    cancelled();
    if(!client.optimize)throw new CoreError('OPTIMIZE_UNAVAILABLE','Optimization queries unavailable');
    const snapshot=request.activity?.snapshotId;
    if(request.action!=='activity'||!snapshot||!published.has(snapshot)||request.roots!=null||request.projectRoots!=null||request.readView!=null)
      throw new CoreError('INVALID_ARGUMENT','Activity requires a read identity published by this host');
    await revalidate(options);cancelled();
    if(!published.has(snapshot))throw new CoreError('VIEW_EXPIRED','Read identity is no longer authorized; reopen the list');
    const selectedRoots=roots();
    const result=await client.optimize({...request,roots:selectedRoots?[...selectedRoots]:undefined},options);
    cancelled();
    if(!published.has(snapshot))throw new CoreError('VIEW_EXPIRED','Read identity is no longer authorized; reopen the list');
    return result;
  };
}
