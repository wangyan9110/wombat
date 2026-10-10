import { CoreError, type UsageClient, type LiveResult, type PricingResult } from '@wombat/client';

/** One host-owned flight; the core alone decides catalog eligibility and retry limits. */
export function backgroundPrices(client: UsageClient, enabled: boolean, lifetime: AbortSignal) {
  let flight: Promise<PricingResult> | undefined;
  let state: LiveResult['result']['priceUpdate'];
  const update = (): Promise<PricingResult> => {
    if (flight) return flight;
    const signal = AbortSignal.any([lifetime, AbortSignal.timeout(15_000)]);
    const cancelled = new Promise<never>((_, reject) => {
      if (signal.aborted) reject(new CoreError('CANCELLED', 'Cancelled'));
      else
        signal.addEventListener('abort', () => reject(new CoreError('CANCELLED', 'Cancelled')), {
          once: true,
        });
    });
    flight = Promise.race([client.prices({ action: 'auto_update' }, { signal }), cancelled])
      .then((result) => {
        if (!signal.aborted) state = result.automatic;
        return result;
      })
      .catch((error) => {
        if (!lifetime.aborted)
          state = {
            status: 'failed',
            attemptId: '',
            attemptedAt: new Date().toISOString(),
            retryAt: new Date(Date.now() + 60_000).toISOString(),
            errorCode: error instanceof CoreError ? error.code : 'PRICE_UPDATE_FAILED',
          };
        throw error;
      })
      .finally(() => {
        flight = undefined;
      });
    return flight;
  };
  return {
    update,
    observe(
      request: Parameters<NonNullable<UsageClient['live']>>[0],
      value: LiveResult,
    ): LiveResult {
      if (
        !enabled ||
        lifetime.aborted ||
        request.mode === 'cached' ||
        request.query.snapshotId ||
        !value.result.summary.price.issues.includes('catalogPriceMissing')
      )
        return value;
      if (!state || Date.parse(state.retryAt) <= Date.now()) void update().catch(() => {});
      // Never change the immutable revision or reprice its returned ledger in place.
      return state ? { ...value, result: { ...value.result, priceUpdate: state } } : value;
    },
    async close() {
      await flight?.catch(() => {});
    },
  };
}
