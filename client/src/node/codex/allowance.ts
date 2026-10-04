import { allowanceStatus, type AllowanceAssessment } from '../../allowance.js';
import type { AccountResult, HandoffResult, QueryOptions } from '../../client.js';
import { CoreError } from '../../errors.js';
import { invokeOperation, type CoreProcessOptions } from '../core.js';
import { captureAccount, normalizeAccount, type CodexConnection } from './observation.js';
import type { CodexOptions } from './process.js';
import { connectCodex } from './rpc.js';
export { allowanceStatus };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const unknownAllowance = (reason = 'observation_unavailable'): AllowanceAssessment => ({ status: 'unknown', model: null, provider: null, checkedAt: null, validUntil: null, bucketId: null, windowId: null, reason });
export async function assessAllowance(account: AccountResult, model: unknown, provider: unknown, query: QueryOptions, options: CoreProcessOptions): Promise<AllowanceAssessment> {
  return await invokeOperation('native_allowance_gate', { account, model: typeof model === 'string' ? model : null, provider: typeof provider === 'string' ? provider : null, now: new Date().toISOString() }, query, options) as AllowanceAssessment;
}
export async function observeAllowance(rpc: CodexConnection, model: unknown, provider: unknown, version: string, query: QueryOptions, options: CoreProcessOptions): Promise<AllowanceAssessment> {
  try {
    const account = await normalizeAccount(await captureAccount(rpc, false, query), 'read', version, query, options);
    return await assessAllowance(account, model, provider, query, options);
  } catch (error) { if (query.signal?.aborted) throw new CoreError('CANCELLED', 'Cancelled'); return unknownAllowance(); }
}
/** Optional preview observations are bounded and never prevent local file review. */
export async function previewAllowance(result: HandoffResult, query: QueryOptions, options: CoreProcessOptions & CodexOptions): Promise<HandoffResult> {
  result.allowanceChecks = result.projects.map(project => ({ projectId: project.id, assessment: unknownAllowance('lookup_not_completed') }));
  if (!result.projects.length) return result;
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), 5000); timer.unref();
  const bounded = { ...query, signal: query.signal ? AbortSignal.any([query.signal, deadline.signal]) : deadline.signal };
  let rpc: CodexConnection | undefined;
  try {
    rpc = await connectCodex(false, bounded, options);
    const account = await normalizeAccount(await captureAccount(rpc, false, bounded), 'read', null, bounded, options);
    for (let start = 0; start < Math.min(result.projects.length, 128); start += 4) {
      await Promise.all(result.projects.slice(start, start + 4).map(async (project, offset) => {
        try {
          const raw = await rpc!.request('config/read', { cwd: project.cwd, includeLayers: false });
          const config = object(raw) && object(raw.config) ? raw.config : undefined;
          result.allowanceChecks[start + offset].assessment = await assessAllowance(account, config?.model, config?.model_provider, bounded, options);
        } catch { /* Preserve explicit unknown for unavailable effective configuration. */ }
      }));
      if (bounded.signal.aborted) break;
    }
  } catch { /* Local preview is useful even when Codex cannot be reached. */ }
  finally { clearTimeout(timer); rpc?.close(); }
  if (query.signal?.aborted) throw new CoreError('CANCELLED', 'Cancelled');
  return result;
}
