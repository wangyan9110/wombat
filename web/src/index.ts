import { createServer, type ServerResponse, type IncomingMessage } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, createUsageClient, type UsageClient, type UsageRequest } from '@wombat/client';

const BODY_LIMIT = 64 * 1024;
const OUTPUT_LIMIT = 16 * 1024 * 1024;

export interface WebHostOptions {
  client: UsageClient;
  assets: string;
  roots?: string[];
  projectRoots?: string[];
  port?: number;
  locale?: 'zh' | 'en';
}
export interface WebHost { url: string; origin: string; close(): Promise<void> }

async function loadAssets(directory: string): Promise<Map<string, { body: Buffer; type: string }>> {
  const assets = new Map<string, { body: Buffer; type: string }>();
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
  async function walk(relative = ''): Promise<void> {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(name);
      else if (types[path.extname(name)] && (await lstat(path.join(directory, name))).size <= OUTPUT_LIMIT)
        assets.set('/' + name.split(path.sep).join('/'), { body: await readFile(path.join(directory, name)), type: types[path.extname(name)] });
    }
  }
  await walk();
  if (!assets.has('/index.html')) throw new CoreError('WEB_ASSETS_MISSING', 'Web assets missing; run the complete build');
  return assets;
}

/** Local host, not a remotely deployable server. Scope and lifetime belong to the CLI. */
export async function startWebHost(options: WebHostOptions): Promise<WebHost> {
  const assets = await loadAssets(options.assets);
  const token = randomBytes(32).toString('hex');
  const authorization = Buffer.from(`Bearer ${token}`);
  const active = new Set<AbortController>();
  const snapshots = new Set<string>();
  const configViews = new Set<string>();
  let origin = '', host = '', closing = false;
  const scope = (request: UsageRequest): UsageRequest => {
    // Paths and fixed snapshots can select data outside this host's startup scope.
    if (request.roots != null || (request.snapshotId != null && !snapshots.has(request.snapshotId))) throw new CoreError('INVALID_ARGUMENT', 'Web scope is fixed at startup');
    return { ...request, roots: request.snapshotId && !request.snapshotId.startsWith('live:') ? undefined : options.roots };
  };
  const client = createUsageClient(
    (r, q) => options.client.query(scope(r), q),
    (r, q) => options.client.prices(r, q),
    (r, q) => {
      if (!options.client.live) throw new CoreError('LIVE_UNAVAILABLE', 'Live queries unavailable');
      return options.client.live({ ...r, query: scope(r.query) }, q);
    },
    (r, q) => {
      if (!options.client.config) throw new CoreError('CONFIG_UNAVAILABLE', 'Configuration queries unavailable');
      if (r.roots != null || r.projectRoots != null || (r.readView != null && !configViews.has(r.readView)) || (r.snapshotId != null && !snapshots.has(r.snapshotId)))
        throw new CoreError('INVALID_ARGUMENT', 'Web scope is fixed at startup');
      return options.client.config({ ...r, roots: options.roots, projectRoots: options.projectRoots }, q);
    },
  );
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const reject = (status: number) => { res.writeHead(status); res.end(); };
    if (closing || req.headers.host !== host) return reject(403);
    if (req.url?.startsWith('/api/')) {
      const supplied = Buffer.from(req.headers.authorization ?? '');
      if (supplied.length !== authorization.length || !timingSafeEqual(supplied, authorization) || req.headers.origin !== origin) return reject(403);
      if (req.method !== 'POST') return reject(405);
      if (!['/api/query', '/api/live', '/api/prices', '/api/config'].includes(req.url)) return reject(404);
      if (req.headers['content-type'] !== 'application/json') return reject(415);
      if (Number(req.headers['content-length'] ?? 0) > BODY_LIMIT) return reject(413);
      if (active.size >= 8) return reject(429);
      const controller = new AbortController(); active.add(controller);
      const timer = setTimeout(() => { controller.abort(); res.destroy(); }, 120_000);
      const abort = () => controller.abort();
      res.once('close', abort);
      let sent = 0;
      const send = (frame: unknown) => {
        if (controller.signal.aborted) throw new CoreError('CANCELLED', 'Cancelled');
        const line = JSON.stringify(frame) + '\n'; sent += Buffer.byteLength(line);
        if (sent > OUTPUT_LIMIT) throw new CoreError('OUTPUT_LIMIT', 'Response too large');
        res.write(line);
      };
      try {
        let size = 0; const chunks: Buffer[] = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > BODY_LIMIT) { reject(413); return; }
          chunks.push(chunk);
        }
        let request: unknown;
        try { request = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { reject(400); return; }
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        const query = { signal: controller.signal, onProgress: (stage: string) => send({ type: 'progress', stage }) };
        // createUsageClient validates each unknown payload before the typed transport runs.
        const value = req.url === '/api/query' ? await client.query(request as Parameters<UsageClient['query']>[0], query)
          : req.url === '/api/prices' ? await client.prices(request as Parameters<UsageClient['prices']>[0], query)
          : req.url === '/api/config' ? await client.config!(request as Parameters<NonNullable<UsageClient['config']>>[0], query)
          : await client.live!(request as Parameters<NonNullable<UsageClient['live']>>[0], query);
        const result = 'result' in value ? value.result : 'snapshotRef' in value ? value : undefined;
        if ('readView' in value) {
          if (value.readView) configViews.add(value.readView);
          if (configViews.size > 128) configViews.delete(configViews.values().next().value!);
          if (value.usageRevision) snapshots.add(value.usageRevision);
        }
        if (result) {
          snapshots.add(result.snapshotRef.snapshotId);
        }
        if (snapshots.size > 128) snapshots.delete(snapshots.values().next().value!);
        send({ type: 'result', value });
      } catch (error) {
        if (!controller.signal.aborted) {
          const failure = error instanceof CoreError ? error : new CoreError('INTERNAL_ERROR', 'Request failed');
          // Reserve a separate bounded terminal error, even after an oversized result.
          res.end(JSON.stringify({ type: 'error', code: failure.code, message: failure.message }) + '\n');
        }
      } finally {
        clearTimeout(timer); active.delete(controller); res.off('close', abort); res.end();
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return reject(405);
    const pathname = new URL(req.url ?? '/', origin).pathname;
    const asset = assets.get(pathname === '/' ? '/index.html' : pathname);
    if (!asset) return reject(404);
    res.setHeader('Content-Type', asset.type);
    res.end(req.method === 'HEAD' ? undefined : asset.body);
  }
  const server = createServer((req, res) => { void handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); });
  server.requestTimeout = 125_000; server.headersTimeout = 10_000; server.timeout = 125_000; server.maxHeadersCount = 32;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') { reject(new Error('Invalid listener')); return; }
      host = `127.0.0.1:${address.port}`; origin = `http://${host}`; resolve();
    });
  });
  return { origin, url: `${origin}/#token=${token}&lang=${options.locale ?? 'zh'}`, close: async () => {
    if (closing) return;
    closing = true;
    for (const controller of active) controller.abort();
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
  } };
}
