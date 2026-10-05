import type { Request as TimingRequest } from './generated/timing-request.js';
import type { Response as TimingResult } from './generated/timing-response.js';
export type { Request as TimingRequest } from './generated/timing-request.js';
export type { Response as TimingResult } from './generated/timing-response.js';
export type { LocalResponse as TimingLocalResult } from './generated/timing-local-response.js';
export type { ShareResponse as TimingShareResult } from './generated/timing-share-response.js';
export type TimingTransport = (request: TimingRequest, options: QueryOptions) => Promise<unknown>;
import type { Request as LiveRequest } from './generated/live-request.js';
import type { Response as LiveResult } from './generated/live-response.js';
import type {Request as AccountRequest} from './generated/account-request.js';
import type {Response as AccountResult} from './generated/account-response.js';
export type {Request as AccountRequest} from './generated/account-request.js';
export type {Response as AccountResult} from './generated/account-response.js';
export type AccountTransport=(request:AccountRequest,options:QueryOptions)=>Promise<unknown>;
import type {Request as HandoffRequest} from './generated/handoff-request.js';
import type {Response as HandoffResult} from './generated/handoff-response.js';
export type {Request as HandoffRequest} from './generated/handoff-request.js';
export type {Response as HandoffResult} from './generated/handoff-response.js';
export type HandoffTransport=(request:HandoffRequest,options:QueryOptions)=>Promise<unknown>;
export interface HostTransports { account?:AccountTransport;handoff?:HandoffTransport }
export type { Request as LiveRequest } from './generated/live-request.js';
export type { Response as LiveResult } from './generated/live-response.js';
import { CoreError } from './errors.js';
import type {Request as DirectoriesRequest} from './generated/directories-request.js';
import type {Response as DirectoriesResult} from './generated/directories-response.js';
export type {Request as DirectoriesRequest} from './generated/directories-request.js';
export type {Response as DirectoriesResult} from './generated/directories-response.js';
export type DirectoriesTransport=(request:DirectoriesRequest,options:QueryOptions)=>Promise<unknown>;
import type { Request as PreferencesRequest } from './generated/preferences-request.js';
import type { Response as PreferencesResult } from './generated/preferences-response.js';
export type { Request as PreferencesRequest } from './generated/preferences-request.js';
export type { Response as PreferencesResult } from './generated/preferences-response.js';
export type PreferencesTransport = (request: PreferencesRequest, options: QueryOptions) => Promise<unknown>;
import type { Request as OptimizeRequest } from './generated/optimize-request.js';
import type { Response as OptimizeResult } from './generated/optimize-response.js';
export type { Request as OptimizeRequest } from './generated/optimize-request.js';
export type { Response as OptimizeResult, Suggestion as OptimizeSuggestion } from './generated/optimize-response.js';
export type OptimizeTransport = (request: OptimizeRequest, options: QueryOptions) => Promise<unknown>;
import type { Request as ConfigRequest } from './generated/config-request.js';
import type { Response as ConfigResult } from './generated/config-response.js';
export type { Request as ConfigRequest } from './generated/config-request.js';
export type { Response as ConfigResult, Item as ConfigItem } from './generated/config-response.js';
export type ConfigTransport = (request: ConfigRequest, options: QueryOptions) => Promise<unknown>;
import type { Request } from './generated/usage-request.js';
import type { Response } from './generated/usage-app.js';
import type { Request as PricingRequest } from './generated/pricing-request.js';
import type { Response as PricingResult } from './generated/pricing-response.js';
export type { Request as PricingRequest } from './generated/pricing-request.js';
export type { Response as PricingResult } from './generated/pricing-response.js';

export type { Request as UsageRequest } from './generated/usage-request.js';
export type { Response as UsageResult, Scope as UsageScope, Item as UsageItem, UsageSummary } from './generated/usage-app.js';

export interface QueryOptions {
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
}

/** Only generated product operations can cross the host boundary. */
export type UsageTransport = (request: Request, options: QueryOptions) => Promise<unknown>;
export type PricingTransport = (request: PricingRequest, options: QueryOptions) => Promise<unknown>;

export type LiveTransport = (request: LiveRequest, options: QueryOptions) => Promise<unknown>;

export interface UsageClient {
  timing?(request: TimingRequest, options?: QueryOptions): Promise<TimingResult>;
  handoff?(request:HandoffRequest,options?:QueryOptions):Promise<HandoffResult>;
  account?(request:AccountRequest,options?:QueryOptions):Promise<AccountResult>;
  directories?(request:DirectoriesRequest,options?:QueryOptions):Promise<DirectoriesResult>;
  preferences?(request:PreferencesRequest, options?:QueryOptions):Promise<PreferencesResult>;
  optimize?(request: OptimizeRequest, options?: QueryOptions): Promise<OptimizeResult>;
  config?(request: ConfigRequest, options?: QueryOptions): Promise<ConfigResult>;
  live?(request: LiveRequest, options?: QueryOptions): Promise<LiveResult>;
  query(request: Request, options?: QueryOptions): Promise<Response>;
  prices(request: PricingRequest, options?: QueryOptions): Promise<PricingResult>;
}

export interface ClientTransports extends HostTransports {
  query: UsageTransport;
  prices?: PricingTransport;
  live?: LiveTransport;
  config?: ConfigTransport;
  optimize?: OptimizeTransport;
  preferences?: PreferencesTransport;
  directories?: DirectoriesTransport;
  timing?: TimingTransport;
}

export function createUsageClient(transports: ClientTransports): UsageClient {
  const { query: transport, prices: pricingTransport, live: liveTransport,
    config: configTransport, optimize: optimizeTransport, preferences: preferencesTransport,
    directories: directoriesTransport } = transports;
  const hosts = transports;
  return {
    ...(transports.timing ? { async timing(request: TimingRequest, options: QueryOptions = {}): Promise<TimingResult> {
      const [{validate: input}, {validate: output}] = await Promise.all([
        import('./generated/validate-timing-request.js'), import('./generated/validate-timing-response.js'),
      ]);
      if (options.signal?.aborted) throw new CoreError('CANCELLED', 'Cancelled');
      if (!input(request) || request.action === 'evidence' && (request.privacyProfile === 'share-v1'
        || request.objectRef != null && (request.collection !== 'use_records' || !/^use:[0-9a-fA-F]{64}$/.test(request.objectRef))))
        throw new CoreError('INVALID_ARGUMENT', 'Invalid timing request');
      const result = await transports.timing!(request, options);
      if (options.signal?.aborted) throw new CoreError('CANCELLED', 'Cancelled');
      if (!output(result) || !matchesTiming(request, result)) throw new CoreError('PROTOCOL_ERROR', 'Invalid timing response');
      return result;
    } } : {}),
    ...(hosts.handoff?{async handoff(request:HandoffRequest,options:QueryOptions={}):Promise<HandoffResult>{
      const [{validate:input},{validate:output}]=await Promise.all([import('./generated/validate-handoff-request.js'),import('./generated/validate-handoff-response.js')]);
      if(options.signal?.aborted)throw new CoreError('CANCELLED','Cancelled');
      if(!input(request))throw new CoreError('INVALID_ARGUMENT','Invalid handoff request');
      const result=await hosts.handoff!(request,options);
      if(!output(result)||result.outputVersion!==1||result.action!==(request.action??'preview'))throw new CoreError('PROTOCOL_ERROR','Invalid handoff response');
      return result;
    }}:{}),
    ...(hosts.account?{async account(request:AccountRequest,options:QueryOptions={}):Promise<AccountResult>{
      const [{validate:input},{validate:output}]=await Promise.all([import('./generated/validate-account-request.js'),import('./generated/validate-account-response.js')]);
      if(options.signal?.aborted)throw new CoreError('CANCELLED','Cancelled');
      if(!input(request))throw new CoreError('INVALID_ARGUMENT','Invalid account request');
      const result=await hosts.account!(request,options);
      if(!output(result)||result.outputVersion!==1||result.action!==(request.action??'read'))throw new CoreError('PROTOCOL_ERROR','Invalid account response');
      return result;
    }}:{}),
    ...(directoriesTransport?{async directories(request:DirectoriesRequest,options:QueryOptions={} ):Promise<DirectoriesResult>{
      const [{validate:validateDirectoriesRequest},{validate:validateDirectoriesResult}]=await Promise.all([import('./generated/validate-directories-request.js'),import('./generated/validate-directories-response.js')]);
      if(options.signal?.aborted)throw new CoreError('CANCELLED','Cancelled');
      if(!validateDirectoriesRequest(request))throw new CoreError('INVALID_ARGUMENT','Invalid directory request');
      const result=await directoriesTransport(request,options);
      if(!validateDirectoriesResult(result)||result.outputVersion!==1||result.action!==(request.action??'list'))throw new CoreError('PROTOCOL_ERROR','Invalid directory response');return result;
    }}:{}),
    ...(preferencesTransport ? { async preferences(request:PreferencesRequest,options:QueryOptions={} ):Promise<PreferencesResult> {
      const [{validate:validatePreferencesRequest},{validate:validatePreferencesResult}]=await Promise.all([import('./generated/validate-preferences-request.js'),import('./generated/validate-preferences-response.js')]);
      if (options.signal?.aborted) throw new CoreError('CANCELLED','已取消');
      if (!validatePreferencesRequest(request)) throw new CoreError('INVALID_ARGUMENT','语言偏好参数无效');
      const result=await preferencesTransport(request,options);
      if (!validatePreferencesResult(result)||result.outputVersion!==1||result.action!==request.action) throw new CoreError('PROTOCOL_ERROR','语言偏好响应无效');
      return result;
    }}:{}),
    ...(optimizeTransport ? { async optimize(request: OptimizeRequest, options: QueryOptions ={} ): Promise<OptimizeResult> {
      const [{validate:validateOptimizeRequest},{validate:validateOptimizeResult}]=await Promise.all([import('./generated/validate-optimize-request.js'),import('./generated/validate-optimize-response.js')]);
      if (options.signal?.aborted) throw new CoreError('CANCELLED', '已取消');
      if (!validateOptimizeRequest(request)) throw new CoreError('INVALID_ARGUMENT', '优化参数不符合数据协议');
      const result = await optimizeTransport(request, options);
      if (!validateOptimizeResult(result) || result.outputVersion !== 1 || result.action !== (request.action ?? 'list')) throw new CoreError('PROTOCOL_ERROR', '优化数据格式不正确');
      return result;
    } } : {}),
    ...(configTransport ? { async config(request: ConfigRequest, options: QueryOptions ={} ): Promise<ConfigResult> {
      const [{validate:validateConfigRequest},{validate:validateConfigResult}]=await Promise.all([import('./generated/validate-config-request.js'),import('./generated/validate-config-response.js')]);
      if (options.signal?.aborted) throw new CoreError('CANCELLED', '已取消');
      if (!validateConfigRequest(request)) throw new CoreError('INVALID_ARGUMENT', '配置查询参数不符合数据协议');
      const result = await configTransport(request, options);
      if (!validateConfigResult(result) || result.outputVersion !== 1 || result.action !== (request.action ?? 'list'))
        throw new CoreError('PROTOCOL_ERROR', '配置数据格式不正确');
      return result;
    } } : {}),
    ...(liveTransport ? { async live(request: LiveRequest, options: QueryOptions ={} ): Promise<LiveResult> {
      const [{validate:validateLiveRequest},{validate:validateLiveResult}]=await Promise.all([import('./generated/validate-live-request.js'),import('./generated/validate-live-response.js')]);
      if (options.signal?.aborted) throw new CoreError('CANCELLED', '已取消');
      if (!validateLiveRequest(request)) throw new CoreError('INVALID_ARGUMENT', '实时查询参数不符合数据协议');
      const result = await liveTransport(request, options);
      if (!validateLiveResult(result) || result.outputVersion !== 1 || result.result.action !== request.query.action)
        throw new CoreError('PROTOCOL_ERROR', '实时用量数据格式不正确');
      return result;
    } } : {}),
    async prices(request, options ={} ) {
      const [{validate:validatePricingRequest},{validate:validatePricingResult}]=await Promise.all([import('./generated/validate-pricing-request.js'),import('./generated/validate-pricing-response.js')]);
      if (options.signal?.aborted) throw new CoreError('CANCELLED', '已取消');
      if (!validatePricingRequest(request)) throw new CoreError('INVALID_ARGUMENT', '价表参数不符合数据协议');
      if (!pricingTransport) throw new CoreError('PRICING_UNAVAILABLE', '当前宿主未提供价表接口');
      const result = await pricingTransport(request, options);
      if (!validatePricingResult(result) || result.outputVersion !== 1 || result.action !== request.action)
        throw new CoreError('PROTOCOL_ERROR', '价表数据格式不正确');
      return result;
    },
    async query(request, options ={} ) {
      const [{validate:validateRequest},{validate:validateResponse}]=await Promise.all([import('./generated/validate-usage-request.js'),import('./generated/validate-usage-app.js')]);
      if (options.signal?.aborted) throw new CoreError('CANCELLED', '已取消');
      if (!validateRequest(request)) throw new CoreError('INVALID_ARGUMENT', '查询参数不符合数据协议');
      const result = await transport(request, options);
      if (!validateResponse(result) || result.outputVersion !== 3 || result.action !== request.action) {
        throw new CoreError('PROTOCOL_ERROR', '用量数据格式不正确');
      }
      return result;
    },
  };
}

function matchesTiming(request: TimingRequest, result: TimingResult): boolean {
  const profile = request.privacyProfile ?? 'local';
  if (result.outputVersion !== 1 || result.action !== request.action || result.profile !== profile
    || result.methodVersion !== 'safe_event_turn_v1') return false;
  if ('uses' in result && ('totals' in result.uses ? result.uses.totals : result.uses).methodVersion !== 2
    || 'totals' in result && result.totals.methodVersion !== 2) return false;
  if (request.action === 'capabilities') return !('scope' in result) && !('readView' in result);
  if (request.action === 'summary' && profile === 'share-v1') {
    // Sharing deliberately omits local locating identities; core selection owns
    // target binding. The separate schema validates the identifier-free branch.
    return 'relativeAnchors' in result && !('readView' in result)
      && result.privacy.profile === profile;
  }
  if (!('scope' in result) || !('threadId' in result.scope)
    || result.scope.threadId !== request.threadId || result.scope.turnId !== request.turnId
    || result.scope.wholeTurn !== true || result.scope.agentKind !== (request.scope?.agentKind ?? 'codex')
    || (request.scope?.sourceInstanceId != null && result.scope.sourceInstanceId !== request.scope.sourceInstanceId)) return false;
  if (request.action === 'evidence') return 'rows' in result && result.snapshotId === request.snapshotId
    && result.collection === (request.collection ?? 'turn_events')
    && (result.collection !== 'use_records' || (result.objectRef ?? null) === (request.objectRef ?? null)
      && (request.objectRef == null || result.rows.every(row => row.objectRef === request.objectRef)));
  return 'readView' in result && result.privacy.profile === profile
    && (request.snapshotId == null || result.readView.snapshotId === request.snapshotId);
}
