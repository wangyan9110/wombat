import {
  CoreError,
  type PricingRequest,
  type PricingResult,
  type QueryOptions,
} from '@wombat/client';
const at = '2026-10-04T02:00:00Z';
/** Fixed synthetic rates exercise presentation; updates never download a catalog. */
export function previewPrices(scenario: string) {
  let revision = 1;
  return async (request: PricingRequest, options?: QueryOptions): Promise<PricingResult> => {
    if (options?.signal?.aborted) throw new CoreError('CANCELLED', 'Cancelled');
    const action = request.action ?? 'status';
    if (scenario === 'prices-unavailable')
      throw new CoreError('PRICES_UNAVAILABLE', 'Synthetic price catalog unavailable');
    if (scenario === 'prices-update-failed' && action !== 'status')
      throw new CoreError('PRICE_UPDATE_FAILED', 'Synthetic catalog update failed');
    if (action !== 'status') revision++;
    return {
      outputVersion: 1,
      action,
      origin: 'synthetic fixture',
      updated: action !== 'status',
      source: 'synthetic',
      catalogHash: `synthetic-catalog-${revision}`,
      catalog: {
        revision: `synthetic-prices-${revision}`,
        verifiedAt: at,
        policy: 'synthetic-api-equivalent',
        currency: 'USD',
        models:
          scenario === 'empty'
            ? []
            : [
                {
                  id: 'synthetic-model',
                  aliases: ['synthetic-alias'],
                  source: 'https://example.invalid/synthetic-prices',
                  rates: { input: '1.000', cacheRead: '0.100', cacheCreate: null, output: '4.000' },
                  longContext: {
                    inputAbove: 128000,
                    rates: {
                      input: '2.000',
                      cacheRead: '0.200',
                      cacheCreate: null,
                      output: '6.000',
                    },
                  },
                },
                {
                  id: 'synthetic-small',
                  aliases: [],
                  source: 'https://example.invalid/synthetic-prices',
                  rates: { input: '0', cacheRead: null, cacheCreate: null, output: '1.000' },
                  longContext: null,
                },
              ],
      },
    };
  };
}
