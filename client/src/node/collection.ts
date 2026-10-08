import {CoreError} from '../errors.js';
import type {QueryOptions} from '../client.js';
import {invokeOperation,type CoreProcessOptions} from './core.js';
/** The kernel sanitizes raw hook input before any persistence. No log parser lives here. */
export async function receiveCodexHook(body:unknown,query:QueryOptions={},options:CoreProcessOptions={}):Promise<void> {
  if(!body || typeof body!=='object' || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body))>64*1024) throw new CoreError('INVALID_ARGUMENT','Invalid Hook input');
  await invokeOperation('collection_ingest',body as Record<string,unknown>,query,{...options,timeoutMs:3000,maxResponseBytes:4096});
}
