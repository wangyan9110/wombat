import type { UsageScope, UsageRequest } from '@wombat/client';
export type Page = 'config' | 'usage' | 'threads' | 'optimize' | 'prices' | 'sources';
export interface Route {
  relativeDays?: number;
  allTime?: boolean; optimizeView?: string; decisionRevision?: string; suggestion?: string; suggestionRecord?: string;
  optimizeGroup?: 'pending'|'history'; optimizeCategory?: 'repair'|'trim'|'organize'|'space'; optimizeOffset?: number;
  agentsBytes?: number; descriptionCharacters?: number;
  optimizeReturn?: string;
  detailReturn?: string;
  snapshot?: string; configView?: string; configId?: string; configThread?: string;
  configKind?: 'rule'|'skill'|'mcp'; configState?: 'used'|'loaded_only'|'unknown'; configSort?: 'tokens'|'activity'|'size'|'name'|'content_tokens'|'characters'|'recent'; configSearch?: string; configOffset?: number; evidenceOffset?: number;
  page: Page; since: string; until: string; timezone: string; project?: string; unassigned?: boolean;
  model?: string; modelUnknown?: boolean; effort?: string; effortUnknown?: boolean; undated?: boolean; agent?: string; source?: string;
  search?: string; group: 'day' | 'week' | 'month'; sort: 'tokens' | 'cost' | 'recent';
  dimension: 'projects' | 'models'; offset: number; periodOffset: number; turnOffset: number; thread?: string; turn?: string;
  turnView: 'matching' | 'all'; turnSort: 'time' | 'tokens' | 'cost'; periodSort: 'time' | 'tokens' | 'cost';
}
export function shiftDate(date: string, days: number): string { return new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10); }
export function today(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
}
export function parseRoute(search: string, now = new Date()): Route {
  const p = new URLSearchParams(search), timezone = p.get('timezone') ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  let zone = timezone; try { today(zone); } catch { zone = 'UTC'; }
  const end = today(zone, now);
  const days=Number(p.get('relativeDays'));
  const relativeDays=!p.get('snapshot')&&!p.get('allTime')&&!p.get('undated')
    ?([7,30,90].includes(days)?days:!p.has('since')&&!p.has('until')?30:undefined):undefined;
  const value = (key: string) => p.get(key) || undefined;
  const choice = <T extends string>(key: string, values: readonly T[], fallback: T) => values.includes(p.get(key) as T) ? p.get(key) as T : fallback;
  const date = (key: string, fallback: string) => { const s = value(key); return s && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : fallback; };
  const reminder = (key:string,min:number,max:number) => {const raw=value(key),n=Number(raw);return raw&&/^\d+$/.test(raw)&&Number.isSafeInteger(n)&&n>=min&&n<=max?n:undefined;};
  return { relativeDays,page: choice('page', ['config','usage','threads','optimize','prices','sources'], 'usage'), since: relativeDays?shiftDate(end,1-relativeDays):date('since', shiftDate(end,-29)), until: relativeDays?end:date('until', end), timezone: zone,
    agentsBytes:reminder('agentsBytes',1,Number.MAX_SAFE_INTEGER),descriptionCharacters:reminder('descriptionCharacters',0,1024),optimizeReturn:value('optimizeReturn'),detailReturn:value('detailReturn'),
    allTime:value('allTime')==='1',optimizeView:value('optimizeView'),decisionRevision:value('decisionRevision'),suggestion:value('suggestion'),suggestionRecord:value('suggestionRecord'),
    optimizeGroup:choice('optimizeGroup',['pending','history'] as const,'pending'),optimizeCategory:choice('optimizeCategory',['repair','trim','organize','space',''] as const,'')||undefined,optimizeOffset:Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Math.floor(Number(p.get('optimizeOffset'))) || 0)),
    snapshot: value('snapshot'), configView: value('configView'), configId: value('configId'), configThread: value('configThread'),
    configKind: choice('configKind',['rule','skill','mcp',''] as const, '') || undefined, configState: choice('configState',['used','loaded_only','unknown',''] as const, '') || undefined,
    configSort: choice('configSort',['tokens','activity','size','name','content_tokens','characters','recent'] as const,'tokens'), configSearch: value('configSearch'),
    configOffset: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(p.get('configOffset'))) || 0)), evidenceOffset: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(p.get('evidenceOffset'))) || 0)),
    project: value('project'), unassigned: value('unassigned') === '1', model: value('model'), modelUnknown: value('modelUnknown') === '1', effort: value('effort'), effortUnknown: value('effortUnknown')==='1', undated:value('undated')==='1', agent: value('agent'), source: value('source'), search: value('search'),
    group: choice('group', ['day','week','month'], 'day'), dimension: choice('dimension', ['projects','models'], value('project') || value('unassigned') ? 'models' : 'projects'),
    turnView: choice('turnView',['matching','all'],'matching'), sort: choice('sort',['tokens','cost','recent'], p.get('page')==='threads'?'recent':'tokens'), periodSort: choice('periodSort',['time','tokens','cost'],'time'), turnSort: choice('turnSort',['time','tokens','cost'],'time'),
    offset: Math.max(0, Math.min(9007199254740991, Math.floor(Number(p.get('offset'))) || 0)), periodOffset: Math.max(0, Math.min(9007199254740991, Math.floor(Number(p.get('periodOffset'))) || 0)), turnOffset: Math.max(0, Math.min(9007199254740991, Math.floor(Number(p.get('turnOffset'))) || 0)), thread: value('thread'), turn: value('turn') };
}
export function routeSearch(route: Route): string {
  const p = new URLSearchParams();
  Object.entries(route).forEach(([key,value]) => {
    if(route.relativeDays&&!route.snapshot&&!route.allTime&&!route.undated&&['since','until'].includes(key))return;
    if(key==='relativeDays'&&(route.snapshot||route.allTime||route.undated))return;
    if (value !== undefined && value !== false && value !== '') p.set(key, value === true ? '1' : String(value));
  });
  return '?' + p.toString();
}
export function patchRoute(route: Route, patch: Partial<Route>): Route {
  const changingConfig = ['project','unassigned','since','until','allTime','timezone','agent','source'].some(k => k in patch);
  const changingReview = ['project','unassigned','source'].some(k => k in patch);
  return {...route,
    ...(('since'in patch||'until'in patch||patch.allTime||patch.undated)&&!('relativeDays'in patch)?{relativeDays:undefined}:{}),
    ...(changingConfig ? {configView:undefined,configId:undefined,configOffset:0,evidenceOffset:0,configThread:undefined,snapshot:undefined} : {}),
    ...(changingReview ? {optimizeView:undefined,decisionRevision:undefined,suggestion:undefined,suggestionRecord:undefined,optimizeOffset:0} : {}),
    ...patch};
}
export function relatedTurnRoute(route: Route, snapshot: string, thread: string, turn?: string): Partial<Route> {
  return {page:'threads',snapshot,thread,turn,turnView:'all',sort:'recent',turnSort:'time',offset:0,turnOffset:0,search:undefined,
    model:undefined,modelUnknown:false,effort:undefined,effortUnknown:false,undated:false,
    optimizeReturn:routeSearch({...route,optimizeReturn:undefined})};
}
export function reviewReturnRoute(route: Route): Route | undefined {
  if (!route.optimizeReturn?.startsWith('?') || route.optimizeReturn.length>32_768) return;
  const restored=parseRoute(route.optimizeReturn);
  if(!(restored.page==='optimize'&&restored.suggestion||restored.page==='config'&&restored.configId)) return;
  return {...restored,optimizeReturn:undefined};
}
export function detailReturnRoute(route: Route): Route | undefined {
  if (!route.detailReturn?.startsWith('?') || route.detailReturn.length > 32_768) return;
  const restored = parseRoute(route.detailReturn);
  if (!(restored.page === 'config' && restored.configId || restored.page === 'optimize' && restored.suggestion)) return;
  return { ...restored, detailReturn: undefined };
}
export function scopeOf(r: Route): UsageScope {
  return { allTime:r.allTime||undefined, since: r.undated||r.allTime?undefined:r.since, until: r.undated||r.allTime?undefined:shiftDate(r.until,1), undated:r.undated||undefined, timezone: r.timezone, project: r.project, projectUnknown: r.unassigned || undefined,
    model: r.model, modelUnknown: r.modelUnknown || undefined, reasoningEffort: r.effort, effortUnknown:r.effortUnknown||undefined, agentKind: r.agent, sourceInstanceId: r.source };
}
export function fromScope(scope: UsageScope): Partial<Route> {
  return { relativeDays:undefined,allTime:scope.allTime??false,...(scope.since?{since:scope.since}:{}), ...(scope.until?{until:shiftDate(scope.until,-1)}:{}), ...(scope.timezone?{timezone:scope.timezone}:{}), undated:scope.undated??false,
    project: scope.project ?? undefined, unassigned: scope.projectUnknown ?? false, model: scope.model ?? undefined, modelUnknown: scope.modelUnknown ?? false,
    effort: scope.reasoningEffort ?? undefined, effortUnknown:scope.effortUnknown??false, agent: scope.agentKind ?? undefined, source: scope.sourceInstanceId ?? undefined };
}
export async function readUsage(client: import('@wombat/client').UsageClient, request: UsageRequest, options: import('@wombat/client').QueryOptions = {}, mode: 'fresh'|'auto'|'cached' = 'auto') {
  if(request.snapshotId && !request.snapshotId.startsWith('live:') || !client.live) return client.query(request,options);
  const response=await client.live({query:request,mode:request.snapshotId?'cached':mode},options);
  return {...response.result,freshness:response.freshness??response.result.freshness};
}

/** Refresh relative intent only. Fixed and manually selected dates retain their exact scope. */
export function advanceRelativeRoute(route:Route,now=new Date()):Route {
  if(!route.relativeDays||route.snapshot||route.allTime||route.undated)return route;
  const until=today(route.timezone,now),since=shiftDate(until,1-route.relativeDays);
  return since===route.since&&until===route.until?route:patchRoute(route,{since,until,relativeDays:route.relativeDays});
}

export async function readUsagePage(client: import('@wombat/client').UsageClient, request: UsageRequest, options: import('@wombat/client').QueryOptions = {}) {
  const result = await readUsage(client, request, options);
  if (!result.items.length && result.page.total > 0) return readUsage(client, {
    ...request, snapshotId: result.snapshotRef.snapshotId,
    offset: Math.floor((result.page.total - 1) / result.page.limit) * result.page.limit,
  }, options);
  return result;
}
