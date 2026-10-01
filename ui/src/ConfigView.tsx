import { useEffect, useRef, useState } from 'react';
import type { ConfigItem, ConfigRequest, ConfigResult, UsageClient } from '@wombat/client';
import { t } from '@wombat/client/locale';
import { Empty, Heading, Pagination, Pair, Token, directoryName, timestamp } from './components.js';
import { QueryError } from './Feedback.js';
import { shiftDate, type Route } from './state.js';
import './config.css';

export function configRequest(route: Route): ConfigRequest {
  return {
    action: 'list', readView: route.configView, snapshotId: route.configView ? undefined : route.snapshot,
    scope: { since: route.since, until: shiftDate(route.until, 1), timezone: route.timezone, project: route.project,
      agentKind: route.agent, sourceInstanceId: route.source, threadId: route.configThread },
    kind: route.configKind, observation: route.configState, sort: route.configSort ?? 'tokens', search: route.configSearch,
    offset: route.configOffset ?? 0, limit: 30,
  };
}
function useConfig(client: UsageClient, request?: ConfigRequest) {
  const active = useRef<AbortController | undefined>(undefined);
  const [state, setState] = useState<{ key?: string; data?: ConfigResult; loading: boolean; error?: string; code?: string }>({ loading: false });
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify(request);
  useEffect(() => {
    if (!key) { setState({ loading: false }); return; }
    const controller = new AbortController();
    active.current = controller;
    setState({ key, loading: true });
    const run = async () => {
      if (!client.config) throw new Error(t('webui.unsupported'));
      return client.config(JSON.parse(key) as ConfigRequest, { signal: controller.signal });
    };
    void run().then(data => { if (!controller.signal.aborted) setState({ key, data, loading: false }); }, error => {
      if (!controller.signal.aborted) setState({ key, loading: false, error: String(error.message ?? error), code: error.code });
    });
    return () => controller.abort();
  }, [client, key, retry]);
  // A changed request must not expose the previous response even for the render
  // before its effect runs: that response could pin an obsolete read version.
  return { ...(state.key === key ? state : { loading: !!key }), retry: () => setRetry(n => n + 1), cancel: () => { active.current?.abort(); setState({ key, loading: false, error: 'CANCELLED', code: 'CANCELLED' }); } };
}
const stateLabel = (item: ConfigItem) => item.stale ? t('config.stale') : !item.current ? t('config.historical') : t(`config.${item.observation}`);
export function ConfigView({ client, route, navigate, pin, projects, refresh }: {
  client: UsageClient; route: Route; navigate: (patch: Partial<Route>) => void;
  pin: (view: string) => void; projects: (paths: string[]) => void; refresh: () => void;
}) {
  const query = useConfig(client, route.unassigned ? undefined : configRequest(route));
  const [search, setSearch] = useState(route.configSearch ?? '');
  const pinRef = useRef(pin), projectRef = useRef(projects);
  pinRef.current = pin; projectRef.current = projects;
  useEffect(() => { setSearch(route.configSearch ?? ''); }, [route.configSearch]);
  useEffect(() => {
    if (!query.data) return;
    projectRef.current(query.data.authorizedProjects);
    if (!route.configView && query.data.readView) pinRef.current(query.data.readView);
  }, [query.data, route.configView]);
  const result = query.data;
  const update = (patch: Partial<Route>) => navigate({ ...patch, configOffset: 0, configId: undefined, evidenceOffset: 0 });
  const optimize = route.page === 'optimize';
  if (route.unassigned) return <Empty title={t('config.empty')} copy={t('config.emptyHint')}><button onClick={() => navigate({ unassigned: false, project: undefined })}>{t('webui.all')}</button></Empty>;
  return <>
    <Heading title={t(optimize ? 'config.optimizeTitle' : 'webui.config')} sub={t(optimize ? 'config.optimizeNote' : 'config.scopeNote')}>
      <button onClick={query.loading ? query.cancel : refresh}>{t(query.loading ? 'webui.cancel' : 'config.refresh')}</button>
    </Heading>
    {route.configThread && <p className="read-notice">{t('config.threadFilter')} <button onClick={() => update({ configThread: undefined })}>{t('config.clearThread')}</button></p>}
    {query.loading && <p role="status">{t('webui.loading')}</p>}
    {query.error && <QueryError error={query.error} code={query.code} retry={query.code === 'VIEW_EXPIRED' ? refresh : query.retry}/>}
    {result && <>
      <div className="config-summary">
        <section className="panel"><span>{t('config.current')}</span><strong>{result.summary.currentItems}</strong></section>
        <section className="panel"><span>{t('config.historical')}</span><strong>{result.summary.historicalItems}</strong></section>
        <section className="panel"><span>{t('config.tokens')}</span><strong><Token value={result.summary.usage?.tokens.total}/></strong></section>
      </div>
      <p className="note">{t('config.associatedNote')}</p>
      <div className="config-toolbar">
        <nav className="config-types" aria-label={t('webui.config')}>{(['all','rule','skill','mcp'] as const).map(kind => <button key={kind} aria-pressed={(route.configKind ?? 'all') === kind} onClick={() => update({ configKind: kind === 'all' ? undefined : kind })}>{t(`config.${kind}`)}</button>)}</nav>
        <form className="search-form" onSubmit={event => { event.preventDefault(); update({ configSearch: search || undefined }); }}><input aria-label={t('config.search')} placeholder={t('config.search')} value={search} onChange={event => setSearch(event.target.value)}/><button aria-label={t('webui.searchAction')}>⌕</button></form>
        <select aria-label={t('config.allStates')} value={route.configState ?? ''} onChange={event => update({ configState: event.target.value as Route['configState'] || undefined })}><option value="">{t('config.allStates')}</option>{(['used','loaded_only','unknown'] as const).map(s => <option key={s} value={s}>{t(`config.${s}`)}</option>)}</select>
        <select aria-label={t('config.sort')} value={route.configSort ?? 'tokens'} onChange={event => update({ configSort: event.target.value as Route['configSort'] })}>{(['tokens','activity','size','name'] as const).map(s => <option key={s} value={s}>{t(`config.${s}`)}</option>)}</select>
      </div>
      <div className={`config-layout ${route.configId ? 'has-detail' : ''}`}>
        <section className="panel config-list" aria-label={t('webui.config')}>
          <div className="list-meta">{t('config.count', { count: result.page.total })}</div>
          {result.items.map(item => <button className={`config-row ${route.configId === item.id ? 'active' : ''}`} key={item.id} aria-current={route.configId === item.id ? 'true' : undefined} onClick={() => navigate({ configId: item.id, evidenceOffset: 0 })}>
            <span className="config-kind">{t(`config.${item.kind}`)}</span><span className="config-identity"><strong>{item.name}</strong><small title={item.path}>{item.path}</small><span className="tag">{stateLabel(item)}</span></span>
            <span className="config-metric"><Token value={item.usage?.tokens.total}/><small>{t('config.tokens')}</small></span><span className="config-metric">{item.bytes == null ? '—' : item.bytes.toLocaleString()}<small>{t('config.size')}{item.bytes == null ? '' : ' · B'}</small></span>
          </button>)}
          {!result.items.length && <Empty title={t('config.empty')} copy={t('config.emptyHint')}/>}
          <Pagination page={result.page} onPage={offset => navigate({ configOffset: offset, configId: undefined, evidenceOffset: 0 })}/>
        </section>
        {route.configId && result.readView && <ConfigDetail key={route.configId} client={client} route={route} readView={result.readView} navigate={navigate} refresh={refresh}/>}
      </div>
      <details className="provenance config-coverage"><summary>{t('config.issues')}</summary><p>{t('config.coverageNote')}</p>
        {!['current','fixed'].includes(result.coverage.historyStatus) && <p>{t(result.coverage.historyStatus === 'unavailable' ? 'config.historyUnavailable' : 'config.historyStale')}</p>}
        {result.coverage.issues.map((issue, i) => <p key={i}>{issueText(issue.code)}{issue.path && <> · <code>{issue.path}</code></>}</p>)}
        <h3>{t('config.authorized')}</h3>{result.authorizedProjects.map(path => <p key={path}><code>{path}</code></p>)}<p>{t('config.authorizeHint')}</p>
        <p>{t('config.readVersion', { version: result.readView ?? '—' })}</p><p>{timestamp(result.checkedAt, route.timezone)}</p>
      </details>
    </>}
  </>;
}
function issueText(code: string) {
  switch (code) {
    case 'configUnreadable': case 'configInvalid': case 'resourceLimited': case 'outsideAuthorizedRoot': case 'effectiveConfigUnknown': case 'historyCoverageUnknown': case 'projectNotAuthorized': case 'inventoryCacheUnavailable': return t(`config.issue.${code}`);
    default: return code;
  }
}
function ConfigDetail({ client, route, readView, navigate, refresh }: { client: UsageClient; route: Route; readView: string; navigate: (patch: Partial<Route>) => void; refresh: () => void }) {
  const [relatedOffset, setRelatedOffset] = useState(0);
  const base: ConfigRequest = { ...configRequest(route), readView, snapshotId: undefined, kind: undefined, observation: undefined, search: undefined, itemId: route.configId };
  const query = useConfig(client, { ...base, action: 'evidence', offset: route.evidenceOffset ?? 0, limit: 20 });
  const related = useConfig(client, { ...base, action: 'related_scopes', offset: relatedOffset, limit: 20 });
  const result = query.data, item = result?.items[0];
  return <section className="panel detail config-detail" aria-label={t('config.evidence')} aria-busy={query.loading}>
    <button className="link" onClick={() => navigate({ configId: undefined, evidenceOffset: 0 })}>{t('webui.close')}</button>
    {query.loading && <p role="status">{t('webui.loading')}</p>}{query.error && <QueryError error={query.error} code={query.code} retry={query.code === 'VIEW_EXPIRED' ? refresh : query.retry}/>}
    {item && result && <><h2>{item.name}</h2><p className="tag">{stateLabel(item)}</p><p className="config-path"><code>{item.path}</code></p>
      <p>{t(item.estimateStatus === 'schemaUnavailable' ? 'config.schemaUnavailable' : 'config.tokenizerUnavailable')}</p>
      <dl className="facts"><dt>{t('config.size')}</dt><dd>{item.bytes == null ? '—' : `${item.bytes.toLocaleString()} B`}</dd><dt>{t('config.tokens')}</dt><dd>{item.usage ? <Pair summary={item.usage}/> : '—'}</dd><dt>{t('config.activity')}</dt><dd>{item.counts.fileReads + item.counts.toolCalls}</dd></dl>
      <p className="note">{t('config.outcomes', { success: item.counts.succeeded, failed: item.counts.failed, unknown: item.counts.outcomeUnknown })}</p><p className="note">{t('config.associatedNote')}</p><p className="note">{t('config.versionNote')}</p>
      <h3>{t('config.evidence')}</h3>{!result.evidence.length && <p>{t('config.noEvidence')}</p>}
      {result.evidence.map(e => <article className="config-evidence" key={e.id}><strong>{e.title ?? e.threadId}</strong><p>{t(e.eventType === 'file_read' ? 'config.file_read' : 'config.tool_call')} · {timestamp(e.timestamp, route.timezone)}</p>{e.usage && <Pair summary={e.usage}/>}<button className="link" disabled={!result.usageRevision} onClick={() => navigate({ page: 'threads', snapshot: result.usageRevision ?? undefined, thread: e.threadId, turn: e.turnId ?? undefined, turnView: 'all', offset: 0, turnOffset: 0, search: undefined, model: undefined, modelUnknown: false, effort: undefined, effortUnknown: false, undated: false })}>{t('config.viewThread')}</button></article>)}
      <Pagination page={result.page} onPage={offset => navigate({ evidenceOffset: offset })}/>
      <h3>{t('config.relatedScopes')}</h3>{related.error && <QueryError error={related.error} code={related.code} retry={related.retry}/>}
      {related.data?.relatedScopes.map(s => <p key={s.project ?? ''}><button className="link" title={s.project ?? ''} onClick={() => navigate({ project: s.project ?? undefined, unassigned: s.project == null, configView: readView, configId: item.id, evidenceOffset: 0, configOffset: 0 })}>{directoryName(s.project)}</button> · {s.evidenceCount}</p>)}
      {related.data && <Pagination page={related.data.page} onPage={setRelatedOffset}/>}
    </>}
  </section>;
}
