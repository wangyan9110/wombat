import { CoreError } from '@wombat/client';
import type { UsageScope, UsageRequest } from '@wombat/client';
export type Page = 'usage' | 'threads' | 'optimize' | 'prices' | 'sources';
export interface Route {
  page: Page; since: string; until: string; timezone: string; project?: string; unassigned?: boolean;
  model?: string; modelUnknown?: boolean; effort?: string; effortUnknown?: boolean; undated?: boolean; agent?: string; source?: string;
  search?: string; group: 'day' | 'week' | 'month'; sort: 'tokens' | 'cost' | 'recent';
  dimension: 'projects' | 'models'; offset: number; thread?: string; turn?: string;
  turnSort: 'time' | 'tokens' | 'cost'; periodSort: 'time' | 'tokens' | 'cost';
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
  const value = (key: string) => p.get(key) || undefined;
  const choice = <T extends string>(key: string, values: readonly T[], fallback: T) => values.includes(p.get(key) as T) ? p.get(key) as T : fallback;
  const date = (key: string, fallback: string) => { const s = value(key); return s && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : fallback; };
  return { page: choice('page', ['usage','threads','optimize','prices','sources'], 'usage'), since: date('since', shiftDate(end,-29)), until: date('until', end), timezone: zone,
    project: value('project'), unassigned: value('unassigned') === '1', model: value('model'), modelUnknown: value('modelUnknown') === '1', effort: value('effort'), effortUnknown: value('effortUnknown')==='1', undated:value('undated')==='1', agent: value('agent'), source: value('source'), search: value('search'),
    group: choice('group', ['day','week','month'], 'day'), dimension: choice('dimension', ['projects','models'], value('project') || value('unassigned') ? 'models' : 'projects'),
    sort: choice('sort',['tokens','cost','recent'], p.get('page')==='threads'?'recent':'tokens'), periodSort: choice('periodSort',['time','tokens','cost'],'time'), turnSort: choice('turnSort',['time','tokens','cost'],'time'),
    offset: Math.max(0, Math.min(9007199254740991, Math.floor(Number(p.get('offset'))) || 0)), thread: value('thread'), turn: value('turn') };
}
export function routeSearch(route: Route): string {
  const p = new URLSearchParams();
  Object.entries(route).forEach(([key,value]) => { if (value !== undefined && value !== false && value !== '') p.set(key, value === true ? '1' : String(value)); });
  return '?' + p.toString();
}
export function scopeOf(r: Route): UsageScope {
  return { since: r.undated?undefined:r.since, until: r.undated?undefined:shiftDate(r.until,1), undated:r.undated||undefined, timezone: r.timezone, project: r.project, projectUnknown: r.unassigned || undefined,
    model: r.model, modelUnknown: r.modelUnknown || undefined, reasoningEffort: r.effort, effortUnknown:r.effortUnknown||undefined, agentKind: r.agent, sourceInstanceId: r.source };
}
export function fromScope(scope: UsageScope): Partial<Route> {
  return { ...(scope.since?{since:scope.since}:{}), ...(scope.until?{until:shiftDate(scope.until,-1)}:{}), ...(scope.timezone?{timezone:scope.timezone}:{}), undated:scope.undated??false,
    project: scope.project ?? undefined, unassigned: scope.projectUnknown ?? false, model: scope.model ?? undefined, modelUnknown: scope.modelUnknown ?? false,
    effort: scope.reasoningEffort ?? undefined, effortUnknown:scope.effortUnknown??false, agent: scope.agentKind ?? undefined, source: scope.sourceInstanceId ?? undefined };
}
export async function readUsage(client: import('@wombat/client').UsageClient, request: UsageRequest, options: import('@wombat/client').QueryOptions = {}, mode: 'fresh'|'auto'|'cached' = 'auto') {
  const result = request.snapshotId && !request.snapshotId.startsWith('live:') || !client.live
    ? await client.query(request, options) : (await client.live({ query: request, mode: request.snapshotId ? 'cached' : mode }, options)).result;
  if (result.freshness && !['current','fixed'].includes(result.freshness.status)) throw new CoreError('STALE_RESULT', result.freshness.error ?? result.freshness.status);
  return result;
}
