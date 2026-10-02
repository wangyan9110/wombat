import { withAutomaticPrices } from './auto-prices.js';
import { createUsageClient, type UsageClient } from '../client.js';
import { invokeCore, invokeOperation, type CoreProcessOptions } from './core.js';
import { queryLive } from './live.js';
import { queryPrices } from './prices.js';

export interface NodeClientOptions extends CoreProcessOptions { automaticPrices?: boolean }

/** The CLI supplies a packaged binary path; source use can locate the root build. */
export function createNodeClient(options: NodeClientOptions = {}): UsageClient {
  const client = createUsageClient((request, queryOptions) => invokeCore(request, queryOptions, options),
    (request, queryOptions) => queryPrices(request, queryOptions, options),
    (request, queryOptions) => queryLive(request, queryOptions, options),
    (request, queryOptions) => queryLive({ config: request }, queryOptions, options),
    (request, queryOptions) => queryLive({ optimize: request }, queryOptions, options),
    (request, queryOptions) => invokeOperation('preferences',request,queryOptions,options));
  return options.automaticPrices === false ? client : withAutomaticPrices(client);
}
