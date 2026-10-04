import { withAutomaticPrices } from './auto-prices.js';
import { createUsageClient, type UsageClient, type AccountTransport, type HandoffTransport } from '../client.js';
import { invokeCore, invokeOperation, type CoreProcessOptions } from './core.js';
import { queryLive } from './live.js';
import { queryPrices } from './prices.js';
import { createDirectoryTransport } from './directories.js';
import type {CodexOptions} from './codex/process.js';

export interface NodeClientOptions extends CoreProcessOptions,CodexOptions { automaticPrices?: boolean; directoryPicker?:(signal?:AbortSignal)=>Promise<string> }

/** The CLI supplies a packaged binary path; source use can locate the root build. */
export function createNodeClient(options: NodeClientOptions = {}): UsageClient {
  let account: Promise<AccountTransport> | undefined, handoff: Promise<HandoffTransport> | undefined;
  const client = createUsageClient((request, queryOptions) => invokeCore(request, queryOptions, options),
    (request, queryOptions) => queryPrices(request, queryOptions, options),
    (request, queryOptions) => queryLive(request, queryOptions, options),
    (request, queryOptions) => queryLive({ config: request }, queryOptions, options),
    (request, queryOptions) => queryLive({ optimize: request }, queryOptions, options),
    (request, queryOptions) => invokeOperation('preferences',request,queryOptions,options),
    createDirectoryTransport(options,options.directoryPicker),{
      account:async (r,q)=>(await (account??=import('./codex/account.js').then(m=>m.createAccountTransport(options))))(r,q),
      handoff:async (r,q)=>(await (handoff??=import('./codex/handoff.js').then(m=>m.createHandoffTransport(options))))(r,q),
    });
  return options.automaticPrices === false ? client : withAutomaticPrices(client);
}
