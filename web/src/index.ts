import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import {
  CoreError,
  type QueryOptions,
  type UsageClient,
  webViewSearch,
  type WebViewRequest,
} from '@wombat/client';
import { prepareWebView } from './context.js';
import { backgroundPrices } from './automatic-prices.js';
import { loadAssets } from './assets.js';
import { createWebReadScope } from './read-scope.js';
import { createScopedClient } from './scoped-client.js';
import { createHttpHandler } from './http-handler.js';

export interface WebHostOptions {
  client: UsageClient;
  assets: string;
  roots?: string[];
  projectRoots?: string[];
  port?: number;
  locale?: 'zh' | 'en';
  automaticPrices?: boolean;
  restartCommand?: string;
}
export interface WebHost {
  url: string;
  origin: string;
  close(): Promise<void>;
  openView(
    request: WebViewRequest,
    query?: QueryOptions,
  ): Promise<{ url: string; context: WebViewRequest }>;
}

/** Local host, not a remotely deployable server. Scope and lifetime belong to the CLI. */
export async function startWebHost(options: WebHostOptions): Promise<WebHost> {
  const assets = await loadAssets(options.assets);
  const token = randomBytes(32).toString('hex');
  const authorization = Buffer.from(`Bearer ${token}`);
  const lifetime = new AbortController();
  const readScope = createWebReadScope(options.client, options.roots, options.projectRoots);
  await readScope.initialize();
  const prices = backgroundPrices(
    options.client,
    options.automaticPrices !== false,
    lifetime.signal,
  );
  let origin = '',
    host = '',
    closing = false;
  const client = createScopedClient(options, readScope, prices);
  const requests = createHttpHandler({
    assets,
    authorization,
    client,
    rawClient: options.client,
    readScope,
    isClosing: () => closing,
    host: () => host,
    origin: () => origin,
  });
  const server = createServer((req, res) => {
    void requests.handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  server.requestTimeout = 125_000;
  server.headersTimeout = 10_000;
  server.timeout = 125_000;
  server.maxHeadersCount = 32;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Invalid listener'));
        return;
      }
      host = `127.0.0.1:${address.port}`;
      origin = `http://${host}`;
      resolve();
    });
  });
  return {
    origin,
    openView: async (request, query = {}) => {
      if (closing) throw new CoreError('CANCELLED', 'Web host is closed');
      const q = {
        ...query,
        signal: AbortSignal.any([
          lifetime.signal,
          query.signal ?? new AbortController().signal,
          AbortSignal.timeout(30000),
        ]),
      };
      const context = await prepareWebView(
        options.client,
        request,
        {
          roots: readScope.roots ?? [],
          projectRoots: readScope.projectRoots,
          authorizeProject: readScope.discoverProject,
        },
        q,
      );
      const snapshot = context.usage?.snapshotId;
      if (snapshot) {
        readScope.snapshots.add(snapshot);
        if (readScope.snapshots.size > 128)
          readScope.snapshots.delete(readScope.snapshots.values().next().value!);
      }
      const version = context.configuration?.readView ?? context.optimization?.readView;
      if (version) {
        readScope.configViews.add(version);
        if (readScope.configViews.size > 128)
          readScope.configViews.delete(readScope.configViews.values().next().value!);
      }
      return {
        url: `${origin}/${webViewSearch(context)}#token=${token}${options.locale ? `&lang=${options.locale}` : ''}`,
        context,
      };
    },
    url: `${origin}/#token=${token}${options.locale ? `&lang=${options.locale}` : ''}`,
    close: async () => {
      if (closing) return;
      closing = true;
      lifetime.abort();
      requests.cancelAll();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
      await prices.close();
    },
  };
}
