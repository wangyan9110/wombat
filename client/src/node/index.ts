import { createUsageClient, type UsageClient } from '../client.js';
import { invokeCore, type CoreProcessOptions } from './core.js';
import { queryLive } from './live.js';
import { queryPrices } from './prices.js';

export type { CoreProcessOptions as NodeClientOptions } from './core.js';

/** The CLI supplies a packaged binary path; source use can locate the root build. */
export function createNodeClient(options: CoreProcessOptions = {}): UsageClient {
  return createUsageClient((request, queryOptions) => invokeCore(request, queryOptions, options),
    (request, queryOptions) => queryPrices(request, queryOptions, options),
    (request, queryOptions) => queryLive(request, queryOptions, options));
}
