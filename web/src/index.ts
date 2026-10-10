import { createServer, type ServerResponse, type IncomingMessage } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { CoreError, createUsageClient, type QueryOptions, type UsageClient, type UsageRequest } from '@wombat/client';
import {prepareWebView} from './context.js';
import {webViewSearch,type WebViewRequest} from '@wombat/client';
import { backgroundPrices } from './automatic-prices.js';
import { timingAccess, publishTiming, activityAccess } from './timing.js';

const BODY_LIMIT = 64 * 1024;
const OUTPUT_LIMIT = 16 * 1024 * 1024;

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
export interface WebHost { url: string; origin: string; close(): Promise<void>; openView(request:WebViewRequest,query?:QueryOptions):Promise<{url:string;context:WebViewRequest}> }

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
  const snapshotSources=new Map<string,Set<string>>();
  const authorizedSources=new Set<string>();
  let authorizedSourcesComplete=false;
  const incompleteSnapshotSources=new Set<string>();
  const lifetime = new AbortController();
  const startupRoots = options.roots ? [...options.roots] : undefined;
  const startupProjects = [...(options.projectRoots ?? [])];
  const observedProjects = new Set(startupProjects);
  const observeProjects = (result: import('@wombat/client').UsageResult) => {
    for (const project of result.facets?.directories ?? []) observedProjects.add(project);
    for(const source of result.quality.sources)authorizedSources.add(source.source.id);
    if(!result.quality.detailSummary?.omittedSources)authorizedSourcesComplete=true;
  };
  let projectDiscovery: Promise<void> | undefined;
  const discoverProject = async (project: string | null | undefined, query: QueryOptions) => {
    if (!project || observedProjects.has(project)) return;
    projectDiscovery ??= (async () => {
      if (options.client.live) {
        const result = await options.client.live({
          query: { action: 'usage', roots: options.roots, scope: { allTime: true }, limit: 1 },
          mode: 'fresh',
        }, query);
        observeProjects(result.result);
      } else {
        observeProjects(await options.client.query({
          action: 'usage', roots: options.roots, scope: { allTime: true }, limit: 1,
        }, query));
      }
    })().finally(() => { projectDiscovery = undefined; });
    await projectDiscovery;
    if (!observedProjects.has(project) && !(options.projectRoots ?? []).includes(project))
      throw new CoreError('PROJECT_NOT_AUTHORIZED', 'Project is outside the current read scope');
  };
  const projectRoots = (project?: string | null) => [...new Set([
    ...(options.projectRoots ?? []),
    ...(project && observedProjects.has(project) ? [project] : []),
  ])];
  let grantFingerprint='';
  const updateGrants=(result:import('@wombat/client').DirectoriesResult)=>{
    const fingerprint=JSON.stringify(result.grants.map(g=>[g.id,g.directoryIdentity,g.path,g.purpose,g.status]));
    if(fingerprint===grantFingerprint)return;
    grantFingerprint=fingerprint;
    const grants=result.grants.filter(g=>g.status==='authorized');
    options.projectRoots=[...new Set([...startupProjects,...grants.filter(g=>g.purpose==='project').map(g=>g.path)])];
    options.roots=startupRoots ? [...new Set([...startupRoots,...grants.filter(g=>g.purpose==='source').map(g=>g.path)])] : undefined;
    configViews.clear();snapshots.clear();snapshotSources.clear();authorizedSources.clear();incompleteSnapshotSources.clear();authorizedSourcesComplete=false;
    observedProjects.clear();for(const project of options.projectRoots??[])observedProjects.add(project);
  };
  if(options.client.directories){try{updateGrants(await options.client.directories({action:'list'}));}catch{/* Keep the startup scope; the directory panel reports the failed registry. */}}
  const prices = backgroundPrices(options.client, options.automaticPrices !== false, lifetime.signal);
  let origin = '', host = '', closing = false;
  const scope = (request: UsageRequest): UsageRequest => {
    // Paths and fixed snapshots can select data outside this host's startup scope.
    if (request.roots != null || (request.snapshotId != null && !snapshots.has(request.snapshotId))) throw new CoreError('INVALID_ARGUMENT', 'Web scope is fixed at startup');
    return { ...request, roots: request.snapshotId && !request.snapshotId.startsWith('live:') ? undefined : options.roots };
  };
  const revalidateFixed = async (query:import('@wombat/client').QueryOptions) => {
    if (options.client.directories) updateGrants(await options.client.directories({ action: 'list' }, query));
  };
  const timing = timingAccess(options.client,snapshots,()=>options.roots,revalidateFixed);
  const activity = activityAccess(options.client,snapshots,()=>options.roots,revalidateFixed);
  const client = createUsageClient({
    timing,
    monitor:async(r,q)=>{
      if(!options.client.monitor)throw new CoreError('MONITOR_UNAVAILABLE','Monitor unavailable');
      await revalidateFixed(q);
      if(!authorizedSourcesComplete){
        const view=options.client.live ? (await options.client.live({query:{action:'usage',roots:options.roots,scope:{allTime:true},limit:1},mode:'fresh'},q)).result : await options.client.query({action:'usage',roots:options.roots,scope:{allTime:true},limit:1},q);
        observeProjects(view);
      }
      const allowedScope=(scope:import('@wombat/client').UsageRequest['scope'])=>(!scope?.project||observedProjects.has(scope.project)||options.projectRoots?.includes(scope.project))&&(!scope?.sourceInstanceId||authorizedSources.has(scope.sourceInstanceId));
      const allowedNotification=(n:import('@wombat/client').MonitorResult['notifications'][number])=>allowedScope(n.scope)&&n.sourceInstanceIds.every(id=>authorizedSources.has(id));
      if(r.action==='upsert'){
        const settings=await options.client.monitor({action:'list'},q);
        const existing=settings.plans.find(p=>p.id===r.plan.id);
        if(existing&&!allowedScope(existing.scope))throw new CoreError('NOT_FOUND','Monitor plan is outside this host');
        await discoverProject(r.plan.scope?.project,q);
        if(!allowedScope(r.plan.scope))throw new CoreError('SOURCE_NOT_AUTHORIZED','Source is outside this host');
      }
      if(r.action==='remove'||r.action==='acknowledge'){
        const settings=await options.client.monitor({action:'list'},q);
        const allowed=r.action==='remove'?settings.plans.some(p=>p.id===r.id&&allowedScope(p.scope)):settings.notifications.some(n=>n.id===r.notificationId&&allowedNotification(n));
        if(!allowed)throw new CoreError('NOT_FOUND','Monitor item is outside this host');
      }
      if(r.action==='check'){
        if(!snapshots.has(r.snapshotId))throw new CoreError('VIEW_EXPIRED','Unknown host usage view');
        if(incompleteSnapshotSources.has(r.snapshotId)||!snapshotSources.has(r.snapshotId)){
          const request:UsageRequest={action:'usage',snapshotId:r.snapshotId,scope:{allTime:true},limit:1};
          const view=options.client.live&&(r.snapshotId.startsWith('live:')) ? (await options.client.live({query:request,mode:'cached'},q)).result : await options.client.query(request,q);
          if(view.snapshotRef.snapshotId!==r.snapshotId)throw new CoreError('PROTOCOL_ERROR','Usage view mismatch');
          snapshotSources.set(r.snapshotId,new Set(view.quality.sources.map(source=>source.source.id)));incompleteSnapshotSources.delete(r.snapshotId);
        }
        const settings=await options.client.monitor({action:'list'},q);
        for(const id of r.ids){
          const plan=settings.plans.find(p=>p.id===id);
          if(!plan)throw new CoreError('NOT_FOUND','Monitor plan not found');
          await discoverProject(plan.scope?.project,q);
          const source=plan.scope?.sourceInstanceId;
          if(source&&!snapshotSources.get(r.snapshotId)?.has(source))throw new CoreError('SOURCE_NOT_AUTHORIZED','Source is outside this read view');
        }
        await revalidateFixed(q);
        if(!snapshots.has(r.snapshotId))throw new CoreError('VIEW_EXPIRED','Read scope changed');
      }
      const result=await options.client.monitor(r,q);
      await revalidateFixed(q);
      return {...result,plans:result.plans.filter(p=>allowedScope(p.scope)),notifications:result.notifications.filter(allowedNotification)};
    },
    setup:async(r,q)=>{
      if(!options.client.setup)throw new CoreError('SETUP_UNAVAILABLE','Setup unavailable');
      if(r.roots!=null)throw new CoreError('INVALID_ARGUMENT','Web scope is fixed at startup');
      await revalidateFixed(q);await discoverProject(r.project,q);
      return options.client.setup({...r,roots:options.roots},q);
    },
    collection: async (r,q) => {
      if(!options.client.collection) throw new CoreError('COLLECTION_UNAVAILABLE','Collection unavailable');
      if(r.roots!=null) throw new CoreError('INVALID_ARGUMENT','Web scope is fixed at startup');
      await revalidateFixed(q); await discoverProject(r.project,q);
      return options.client.collection({...r,roots:options.roots},q);
    },
    query: async (r, q) => {
      const result = await options.client.query(scope(r), q);
      observeProjects(result);
      return result;
    },
    prices: (r, q) => r.action==='auto_update' ? prices.update() : options.client.prices(r, q),
    live: async (r, q) => {
      if (!options.client.live) throw new CoreError('LIVE_UNAVAILABLE', 'Live queries unavailable');
      const result = prices.observe(r, await options.client.live({ ...r, query: scope(r.query) }, q));
      observeProjects(result.result);
      return result;
    },
    config: async (r, q) => {
      if (!options.client.config) throw new CoreError('CONFIG_UNAVAILABLE', 'Configuration queries unavailable');
      if (r.roots != null || r.projectRoots != null || (r.readView != null && !configViews.has(r.readView)) || (r.snapshotId != null && !snapshots.has(r.snapshotId)))
        throw new CoreError('INVALID_ARGUMENT', 'Web scope is fixed at startup');
      await discoverProject(r.scope?.project, q);
      const projects=projectRoots(r.scope?.project);
      const result=await options.client.config({ ...r, roots: options.roots, projectRoots: projects }, q);
      return {...result,authorizedSourceRoots:options.roots??result.authorizedSourceRoots,authorizedProjects:projects,hostRestartCommand:options.restartCommand??null};
    },
    optimize: async (r, q) => {
      if(r.action==='activity')return activity(r,q);
      if (!options.client.optimize) throw new CoreError('OPTIMIZE_UNAVAILABLE', 'Optimization queries unavailable');
      if (r.roots != null || r.projectRoots != null || (r.readView != null && !configViews.has(r.readView))) throw new CoreError('INVALID_ARGUMENT', 'Web scope is fixed at startup');
      await discoverProject(r.project, q);
      return options.client.optimize({ ...r, roots: options.roots, projectRoots: projectRoots(r.project) }, q);
    },
    preferences: (r,q)=> {
      if (!options.client.preferences) throw new CoreError('PREFERENCES_UNAVAILABLE','Preferences unavailable');
      return options.client.preferences(r,q);
    },
    directories: async(r,q)=>{
      if(!options.client.directories)throw new CoreError('DIRECTORY_PICKER_UNAVAILABLE','Directory authorization unavailable');
      if(r.path!=null||r.action==='authorize')throw new CoreError('INVALID_ARGUMENT','Use the host directory selector');
      const result=await options.client.directories(r,q);
      if(r.action==='list'||r.action==='confirm'||r.action==='revoke')updateGrants(result);
      return result;
    },
    ...{
      account:(r,q)=>{
        if(!options.client.account)throw new CoreError('ACCOUNT_UNAVAILABLE','Account unavailable');
        return options.client.account(r,q);
      },
      handoff:async(r,q)=>{
        if(!options.client.handoff)throw new CoreError('HANDOFF_UNAVAILABLE','Handoff unavailable');
        if(r.roots!=null||r.projectRoots!=null||(r.readView!=null&&!configViews.has(r.readView)))throw new CoreError('INVALID_ARGUMENT','Web scope is fixed at startup');
        await discoverProject(r.project,q);
        return options.client.handoff({...r,roots:options.roots,projectRoots:projectRoots(r.project)},q);
      },
    }
  });
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
      if (!['/api/query', '/api/live', '/api/prices', '/api/config', '/api/optimize', '/api/preferences','/api/directories','/api/account','/api/handoff','/api/timing','/api/collection','/api/setup','/api/monitor'].includes(req.url)) return reject(404);
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
        // Revocation from another CLI/window is authoritative at the next request.
        if(req.url!=='/api/directories'&&req.url!=='/api/account'&&req.url!=='/api/timing'&&options.client.directories)updateGrants(await options.client.directories({action:'list'},query));
        // createUsageClient validates each unknown payload before the typed transport runs.
        const value = req.url === '/api/monitor' ? await client.monitor!(request as Parameters<NonNullable<UsageClient['monitor']>>[0],query)
          : req.url === '/api/setup' ? await client.setup!(request as Parameters<NonNullable<UsageClient['setup']>>[0],query)
          : req.url === '/api/collection' ? await client.collection!(request as Parameters<NonNullable<UsageClient['collection']>>[0],query)
          : req.url === '/api/timing' ? await client.timing!(request as Parameters<NonNullable<UsageClient['timing']>>[0], query)
          : req.url === '/api/query' ? await client.query(request as Parameters<UsageClient['query']>[0], query)
          : req.url === '/api/account' ? await client.account!(request as Parameters<NonNullable<UsageClient['account']>>[0],query)
          : req.url === '/api/handoff' ? await client.handoff!(request as Parameters<NonNullable<UsageClient['handoff']>>[0],query)
          : req.url === '/api/prices' ? await client.prices(request as Parameters<UsageClient['prices']>[0], query)
          : req.url === '/api/config' ? await client.config!(request as Parameters<NonNullable<UsageClient['config']>>[0], query)
          : req.url === '/api/optimize' ? await client.optimize!(request as Parameters<NonNullable<UsageClient['optimize']>>[0], query)
          : req.url === '/api/directories' ? await client.directories!(request as Parameters<NonNullable<UsageClient['directories']>>[0],query)
          : req.url === '/api/preferences' ? await client.preferences!(request as Parameters<NonNullable<UsageClient['preferences']>>[0], query)
          : await client.live!(request as Parameters<NonNullable<UsageClient['live']>>[0], query);
        const result = 'result' in value ? value.result : 'snapshotRef' in value ? value : undefined;
        if ('readView' in value) {
          if (typeof value.readView === 'string') configViews.add(value.readView);
          if (configViews.size > 128) configViews.delete(configViews.values().next().value!);
          if ('usageRevision' in value && value.usageRevision) snapshots.add(value.usageRevision);
        }
        if (result) {
          snapshots.add(result.snapshotRef.snapshotId);
          snapshotSources.set(result.snapshotRef.snapshotId,new Set(result.quality.sources.map(s=>s.source.id)));
          if(result.quality.detailSummary?.omittedSources)incompleteSnapshotSources.add(result.snapshotRef.snapshotId);else incompleteSnapshotSources.delete(result.snapshotRef.snapshotId);
          if(snapshotSources.size>128)snapshotSources.delete(snapshotSources.keys().next().value!);
        }
        if (req.url === '/api/timing') {
          // Narrow the independently validated timing result; never publish share aliases.
          publishTiming(value as import('@wombat/client').TimingResult, snapshots);
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
  return { origin, openView:async(request,query={})=>{
    if(closing)throw new CoreError('CANCELLED','Web host is closed');
    const q={...query,signal:AbortSignal.any([lifetime.signal,query.signal??new AbortController().signal,AbortSignal.timeout(30000)])};
    const context=await prepareWebView(options.client,request,{roots:options.roots??[],projectRoots,authorizeProject:discoverProject},q);
    const snapshot=context.usage?.snapshotId;if(snapshot){snapshots.add(snapshot);if(snapshots.size>128)snapshots.delete(snapshots.values().next().value!);}
    const version=context.configuration?.readView??context.optimization?.readView;if(version){configViews.add(version);if(configViews.size>128)configViews.delete(configViews.values().next().value!);}
    return {url:`${origin}/${webViewSearch(context)}#token=${token}${options.locale?`&lang=${options.locale}`:''}`,context};
  }, url: `${origin}/#token=${token}${options.locale ? `&lang=${options.locale}` : ''}`, close: async () => {
    if (closing) return;
    closing = true;
    lifetime.abort();
    for (const controller of active) controller.abort();
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
    await prices.close();
  } };
}
