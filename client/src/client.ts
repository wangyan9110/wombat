import type { Request as LiveRequest } from './generated/live-request.js';
import type { Response as LiveResult } from './generated/live-response.js';
import { validate as validateLiveRequest } from './generated/validate-live-request.js';
import { validate as validateLiveResult } from './generated/validate-live-response.js';
export type { Request as LiveRequest } from './generated/live-request.js';
export type { Response as LiveResult } from './generated/live-response.js';
import { CoreError } from './errors.js';
import type { Request } from './generated/usage-request.js';
import type { Response } from './generated/usage-app.js';
import { validate as validateRequest } from './generated/validate-usage-request.js';
import { validate as validateResponse } from './generated/validate-usage-app.js';
import type { Request as PricingRequest } from './generated/pricing-request.js';
import type { Response as PricingResult } from './generated/pricing-response.js';
import { validate as validatePricingRequest } from './generated/validate-pricing-request.js';
import { validate as validatePricingResult } from './generated/validate-pricing-response.js';
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
  live?(request: LiveRequest, options?: QueryOptions): Promise<LiveResult>;
  query(request: Request, options?: QueryOptions): Promise<Response>;
  prices(request: PricingRequest, options?: QueryOptions): Promise<PricingResult>;
}

export function createUsageClient(transport: UsageTransport, pricingTransport?: PricingTransport, liveTransport?: LiveTransport): UsageClient {
  return {
    ...(liveTransport ? { async live(request: LiveRequest, options: QueryOptions = {}): Promise<LiveResult> {
      if (options.signal?.aborted) throw new CoreError('CANCELLED', '已取消');
      if (!validateLiveRequest(request)) throw new CoreError('INVALID_ARGUMENT', '实时查询参数不符合数据协议');
      const result = await liveTransport(request, options);
      if (!validateLiveResult(result) || result.outputVersion !== 1 || result.result.action !== request.query.action)
        throw new CoreError('PROTOCOL_ERROR', '实时用量数据格式不正确');
      return result;
    } } : {}),
    async prices(request, options = {}) {
      if (options.signal?.aborted) throw new CoreError('CANCELLED', '已取消');
      if (!validatePricingRequest(request)) throw new CoreError('INVALID_ARGUMENT', '价表参数不符合数据协议');
      if (!pricingTransport) throw new CoreError('PRICING_UNAVAILABLE', '当前宿主未提供价表接口');
      const result = await pricingTransport(request, options);
      if (!validatePricingResult(result) || result.outputVersion !== 1 || result.action !== request.action)
        throw new CoreError('PROTOCOL_ERROR', '价表数据格式不正确');
      return result;
    },
    async query(request, options = {}) {
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
