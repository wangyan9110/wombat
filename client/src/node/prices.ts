import { CoreError } from '../errors.js';
import type { PricingRequest, QueryOptions } from '../client.js';
import { invokePricesCore, type CoreProcessOptions } from './core.js';

// Network transport only: table selection, money, provenance and cache live in Rust.
const SOURCE = 'https://developers.openai.com/api/docs/pricing.md';
const MAX_BYTES = 2 * 1024 * 1024;
export async function queryPrices(request: PricingRequest, options: QueryOptions, processOptions: CoreProcessOptions): Promise<unknown> {
  if (request.action === 'status') return invokePricesCore(request, options, processOptions);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  options.signal?.addEventListener('abort', interrupt, { once: true });
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  if (options.signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
  try {
    if (controller.signal.aborted) throw new CoreError('CANCELLED', '已取消');
    options.onProgress?.('正在读取 OpenAI 官方价格…');
    const result = await fetch(SOURCE, {
      redirect: 'error', signal: controller.signal,
      headers: { Accept: 'text/markdown, text/plain', 'User-Agent': 'Wombat/0.3 price-sync' },
    });
    if (!result.ok || !result.body) {
      await result.body?.cancel();
      throw new CoreError('PRICE_FETCH_FAILED', `官方价表请求失败（HTTP ${result.status}），保留现有价表`);
    }
    if (Number(result.headers.get('content-length')) > MAX_BYTES) {
      await result.body.cancel();
      throw new CoreError('OUTPUT_LIMIT', '官方价表超过 2 MiB，保留现有价表');
    }
    const reader = result.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BYTES) throw new CoreError('OUTPUT_LIMIT', '官方价表超过 2 MiB，保留现有价表');
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    const document = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    clearTimeout(timer);
    if (controller.signal.aborted) throw new CoreError('CANCELLED', '已取消');
    options.onProgress?.('正在校验并保存价格…');
    return await invokePricesCore({ action: 'update', document }, { ...options, signal: controller.signal }, processOptions);
  } catch (error) {
    if (timedOut) throw new CoreError('TIMEOUT', '官方价表请求超时，保留现有价表');
    if (controller.signal.aborted) throw new CoreError('CANCELLED', '已取消');
    if (error instanceof CoreError) throw error;
    throw new CoreError('PRICE_FETCH_FAILED', '无法读取官方价表，请检查网络后重试；保留现有价表');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', interrupt);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}
