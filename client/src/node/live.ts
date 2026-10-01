import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { CoreError } from '../errors.js';
import type { ConfigRequest, LiveRequest, QueryOptions } from '../client.js';
import { binaryPath, decode, invokeOperation, type CoreProcessOptions } from './core.js';

function exchange(socket: string, request: LiveRequest | { config: ConfigRequest }, options: QueryOptions, config: CoreProcessOptions): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const client = createConnection(socket);
    const chunks: Buffer[] = []; let bytes = 0, done = false;
    const finish = (error?: Error, result?: unknown) => {
      if (done) return; done = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort); client.destroy();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new CoreError('CANCELLED', '已取消'));
    const timer = setTimeout(() => finish(new CoreError('TIMEOUT', '实时用量查询超时')), config.timeoutMs ?? 12_000);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) { abort(); return; }
    client.on('connect', () => client.write(JSON.stringify(request) + '\n'));
    client.on('error', finish);
    client.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > (config.maxResponseBytes ?? 256_000_000)) { finish(new CoreError('OUTPUT_LIMIT', '实时用量响应超过上限')); return; }
      chunks.push(chunk);
      // A complete response is newline-delimited. Named-pipe servers retain their
      // send buffer until the client closes; waiting only for EOF would deadlock.
      if (chunk.includes(10)) {
        try { finish(undefined, decode(Buffer.concat(chunks).toString('utf8'))); }
        catch (error) { finish(error as Error); }
      }
    });
    client.on('end', () => { try { finish(undefined, decode(Buffer.concat(chunks).toString('utf8'))); } catch (e) { finish(e as Error); } });
  });
}
export async function queryLive(request: LiveRequest | { config: ConfigRequest }, options: QueryOptions, config: CoreProcessOptions): Promise<unknown> {
  if (options.signal?.aborted) throw new CoreError('CANCELLED', '已取消');
  if ('query' in request && request.query.action === 'refresh') options.onProgress?.('同步本机日志并保存用量');
  const endpoint = await invokeOperation('live_endpoint', {}, options, config) as { protocolVersion?: number; socket?: string };
  if (endpoint.protocolVersion !== 1 || typeof endpoint.socket !== 'string') throw new CoreError('PROTOCOL_ERROR', '实时用量接口版本不兼容');
  let started = false;
  const deadline = Date.now() + 5_000;
  for (;;) {
    try { return await exchange(endpoint.socket, request, options, config); }
    catch (error) {
      if (!['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '') || Date.now() >= deadline) throw error;
      if (!started) {
        // This shared service owns its lifecycle. Never attach it to caller process-tree cleanup.
        const child = spawn(binaryPath(config.binaryPath), ['--serve-usage'], { detached: true, windowsHide: true, stdio: 'ignore' });
        child.on('error', () => {}); child.unref(); started = true;
      }
      try { await delay(75, undefined, { signal: options.signal }); }
      catch { throw new CoreError('CANCELLED', '已取消'); }
    }
  }
}
