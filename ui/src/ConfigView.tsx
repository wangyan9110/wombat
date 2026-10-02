import { useEffect, useRef, useState } from 'react';
import type { ConfigItem, ConfigRequest, ConfigResult, UsageClient } from '@wombat/client';
import { t, bytesLabel } from '@wombat/client/locale';
import { Empty, Heading, Pagination, Pair, Token, Modal, directoryName, timestamp } from './components.js';
import { QueryError } from './Feedback.js';
import { detailReturnRoute, relatedTurnRoute, type Route } from './state.js';
import {configRequest,useConfig} from './useConfig.js';
export {configRequest} from './useConfig.js';
import './config.css';
import { ConfigSuggestion } from './ConfigSuggestion.js';


const stateLabel = (item: ConfigItem) => ['missing','unreadable'].includes(item.configuredState) ? t(item.configuredState==='missing'?'config.missing':'config.unreadable') : item.stale ? t('config.stale') : !item.current ? t('config.historical') : t(`config.${item.observation}`);
export function ConfigView({ client, route, navigate, pin, projects, refresh }: {
  client: UsageClient; route: Route; navigate: (patch: Partial<Route>) => void;
  pin: (view: string) => void; projects: (paths: string[]) => void; refresh: () => void;
}) {
  const query = useConfig(client, route.unassigned ? undefined : configRequest(route));
  const [search, setSearch] = useState(route.configSearch ?? '');
  const pinRef = useRef(pin), projectRef = useRef(projects), rowsRef = useRef(new Map<string, HTMLButtonElement>());
  pinRef.current = pin; projectRef.current = projects;
  useEffect(() => { setSearch(route.configSearch ?? ''); }, [route.configSearch]);
  useEffect(() => {
    if (!query.data) return;
    projectRef.current(query.data.authorizedProjects);
    if (!route.configView && query.data.readView) pinRef.current(query.data.readView);
  }, [query.data, route.configView]);
  const result = query.data;
  const update = (patch: Partial<Route>) => navigate({ ...patch, configOffset: 0, configId: undefined, evidenceOffset: 0 });

  if (route.unassigned) return <Empty title={t('config.empty')} copy={t('config.emptyHint')}><button onClick={() => navigate({ unassigned: false, project: undefined })}>{t('webui.all')}</button></Empty>;
  return <>
    <Heading title={t('webui.config')} sub={t('config.scopeNote')}>
      <button onClick={query.loading ? query.cancel : refresh}>{t(query.loading ? 'webui.cancel' : 'config.refresh')}</button>
    </Heading>
    {route.configThread && <p className="read-notice">{t('config.threadFilter')} <button onClick={() => update({ configThread: undefined })}>{t('config.clearThread')}</button></p>}
    {query.loading && <p role="status">{t('webui.loading')}</p>}
    {query.error && <QueryError error={query.error} code={query.code} retry={query.code === 'VIEW_EXPIRED' || query.code === 'NOT_FOUND' ? refresh : query.retry}/>}
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
        <select aria-label={t('config.sort')} value={route.configSort ?? 'tokens'} onChange={event => update({ configSort: event.target.value as Route['configSort'] })}>{(['content_tokens','characters','size','activity','recent','tokens','name'] as const).map(s => <option key={s} value={s}>{t(`config.${s}`)}</option>)}</select>
      </div>
      <div className="config-layout">
        <section className="panel config-list" aria-label={t('webui.config')}>
          <div className="list-meta">{t('config.count', { count: result.page.total })}</div>
          {result.items.map(item => <button className={`config-row measurement-row ${route.configId === item.id ? 'active' : ''}`} key={item.id} ref={row=>{if(row)rowsRef.current.set(item.id,row);else rowsRef.current.delete(item.id);}} aria-current={route.configId === item.id ? 'true' : undefined} onClick={() => navigate({ configId: item.id, evidenceOffset: 0 })}>
            <span className="config-kind">{t(`config.${item.kind}`)}</span><span className="config-identity"><strong>{item.name}</strong><small title={item.path}>{item.path}</small><span className="tag">{stateLabel(item)}</span></span>
            <span className="config-metric"><Token value={item.contentTokens} estimated/><small>{t('config.content_tokens')}</small></span><span className="config-metric">{item.characters?.toLocaleString()??'—'}<small>{t('config.characters')}</small></span><span className="config-metric">{item.usageCount?.toLocaleString()??'—'}<small>{t('config.activity')}</small></span><span className="config-metric" title={item.bytes==null?undefined:`${item.bytes.toLocaleString()} B`} aria-label={item.bytes==null?undefined:`${t('config.size')}: ${item.bytes.toLocaleString()} B`}>{bytesLabel(item.bytes)}<small>{t('config.size')}</small></span><span className="config-metric"><span>{timestamp(item.lastRecordAt,route.timezone).split(' · ')[0]}</span><small>{t('config.recent')}</small></span>
          </button>)}
          {!result.items.length && <Empty title={t('config.empty')} copy={t('config.emptyHint')}/>}
          <Pagination page={result.page} onPage={offset => navigate({ configOffset: offset, configId: undefined, evidenceOffset: 0 })}/>
        </section>
        {route.configId && result.readView && <ConfigDetail key={route.configId} client={client} route={route} readView={result.readView} navigate={navigate} refresh={refresh} restoreFocus={()=>rowsRef.current.get(route.configId!)?.focus()}/>}
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
function ConfigDetail({ client, route, readView, navigate, refresh, restoreFocus }: { client: UsageClient; route: Route; readView: string; navigate: (patch: Partial<Route>) => void; refresh: () => void; restoreFocus:()=>void }) {
  const [relatedOffset, setRelatedOffset] = useState(0);
  const base: ConfigRequest = { ...configRequest(route), readView, snapshotId: undefined, kind: undefined, observation: undefined, search: undefined, itemId: route.configId };
  const query = useConfig(client, { ...base, action: 'evidence', offset: route.evidenceOffset ?? 0, limit: 20 });
  const related = useConfig(client, { ...base, action: 'related_scopes', offset: relatedOffset, limit: 20 });
  const result = query.data, item = result?.items[0];
  const back=detailReturnRoute(route);
  return <Modal title={item?.name??t('config.evidence')} drawer restoreFocus={restoreFocus} onClose={()=>navigate({configId:undefined,evidenceOffset:0})}><section className="detail config-detail" aria-label={t('config.evidence')} aria-busy={query.loading}>
    {back&&<button className="link" onClick={()=>navigate(back)}>{t('webui.back')}</button>}
    {query.loading && <p role="status">{t('webui.loading')}</p>}{query.error && <QueryError error={query.error} code={query.code} retry={query.code === 'VIEW_EXPIRED' || query.code === 'NOT_FOUND' ? refresh : query.retry}/>}
    {item && result && <><p className="tag">{stateLabel(item)}</p><p className="config-path"><code>{item.path}</code></p>
      <p>{t(item.estimate ? 'config.contentNote' : item.estimateStatus === 'schemaUnavailable' ? 'config.schemaUnavailable' : item.estimateStatus === 'resourceLimited' ? 'config.estimateLimited' : 'config.tokenizerUnavailable')}</p>
<dl className="facts"><dt>{t('config.tokens')}</dt><dd>{item.usage?<Pair summary={item.usage}/>:'—'}</dd><dt>{t('config.activity')}</dt><dd>{item.usageCount?.toLocaleString()??'—'}</dd><dt>{t('config.reads')}</dt><dd>{t('config.fileReadsCount',{count:item.counts.fileReads})}</dd><dt>{t('config.recent')}</dt><dd>{timestamp(item.lastRecordAt,route.timezone)}</dd></dl>
 <details className="provenance"><summary>{t('config.measurementDetails')}</summary><p>{t('config.byteBasis')}</p>      <dl className="facts"><dt>{t('config.size')}</dt><dd>{item.bytes == null ? '—' : `${item.bytes.toLocaleString()} B`}</dd><dt>{t('config.content_tokens')}</dt><dd><Token value={item.contentTokens} estimated/></dd><dt>{t('config.characters')}</dt><dd>{item.characters?.toLocaleString()??'—'}</dd>{item.skillMetadata&&<><dt>{t('config.descriptionCharacters')}</dt><dd>{item.skillMetadata.descriptionCharacters?.toLocaleString()??'—'}</dd><dt>{t('config.metadataStatus')}</dt><dd>{metadataLabel(item.skillMetadata.status)}</dd></>}<dt>{t('config.measurement')}</dt><dd>{measurementLabel(item.measurementStatus)} · {estimateLabel(item.estimateStatus)}</dd></dl>
      {item.kind==='skill'&&<><dl className="facts"><dt>{t('config.bodyTokens')}</dt><dd><Token value={item.bodyTokenEstimate?.tokens} estimated/></dd><dt>{t('config.bodyStatus')}</dt><dd>{bodyEstimateLabel(item.bodyEstimateStatus)}</dd>{item.bodyTokenEstimate&&<><dt>{t('config.estimateBasis')}</dt><dd><code>{item.bodyTokenEstimate.method}</code></dd><dt>{t('config.bodyHash')}</dt><dd><code>{item.bodyTokenEstimate.contentHash}</code></dd></>}</dl><p className="note">{t('config.bodyNote')}</p></>}
      {item.estimate&&<dl className="facts"><dt>{t('config.estimateBasis')}</dt><dd><code>{item.estimate.method}</code></dd><dt>{t('config.contentHash')}</dt><dd><code>{item.estimate.contentHash}</code></dd></dl>}<p className="note">{t('config.unknownCounts')}</p>
</details>
 <ConfigSuggestion client={client} route={route} itemId={item.id} readView={readView} navigate={navigate} refresh={refresh}/>
      <p className="note">{t('config.outcomes', { success: item.counts.succeeded, failed: item.counts.failed, unknown: item.counts.outcomeUnknown })}</p><p className="note">{t('config.associatedNote')}</p><p className="note">{t('config.versionNote')}</p>
      {!!item.sourceContexts?.length&&<details className="provenance"><summary>{t('webui.sourceInstance')}</summary>{item.sourceContexts.map(c=><p key={c.inventoryId}><code>{c.sourceInstanceId}</code> · {t('config.fileReadsCount',{count:c.counts.fileReads})} · {t('config.toolCallsCount',{count:c.counts.toolCalls})}<br/>{stateLabel({...item,observation:c.observation})} · <code>{c.contentHash}</code></p>)}</details>}<h3>{t('config.evidence')}</h3>{!result.evidence.length && <p>{t('config.noEvidence')}</p>}
      {result.evidence.map(e => <article className="config-evidence" key={e.id}><strong>{e.title ?? e.threadId}</strong><p>{t(e.eventType === 'file_read' ? 'config.file_read' : 'config.tool_call')} · {timestamp(e.timestamp, route.timezone)}</p>{e.sourceInstanceId&&<p><code>{e.sourceInstanceId}</code></p>}{e.usage && <Pair summary={e.usage}/>}<button className="link" disabled={!result.usageRevision} onClick={() => navigate(relatedTurnRoute(route,result.usageRevision!,e.threadId,e.turnId??undefined))}>{t('config.viewThread')}</button></article>)}
      <Pagination page={result.page} onPage={offset => navigate({ evidenceOffset: offset })}/>
      <h3>{t('config.relatedScopes')}</h3>{related.error && <QueryError error={related.error} code={related.code} retry={related.code === 'VIEW_EXPIRED' || related.code === 'NOT_FOUND' ? refresh : related.retry}/>}
      {related.data?.relatedScopes.map(s => <p key={s.project ?? ''}><button className="link" title={s.project ?? ''} onClick={() => navigate({ project: s.project ?? undefined, unassigned: s.project == null, configView: readView, configId: item.id, evidenceOffset: 0, configOffset: 0 })}>{directoryName(s.project)}</button> · {s.evidenceCount}</p>)}
      {related.data && <Pagination page={related.data.page} onPage={setRelatedOffset}/>}
    </>}
  </section></Modal>;
}

function metadataLabel(status:string){switch(status){case 'parsed':return t('config.metadata.parsed');case 'invalid':return t('config.metadata.invalid');case 'resourceLimited':return t('config.metadata.resourceLimited');case 'unsupported':return t('config.metadata.unsupported');default:return t('webui.unknown');}}

function bodyEstimateLabel(status?:string){switch(status){case 'estimated':return t('config.estimated');case 'resourceLimited':return t('config.estimateLimited');case 'unsupported':return t('config.metadata.unsupported');case 'invalid':return t('config.metadata.invalid');default:return t('webui.unknown');}}

function measurementLabel(status?:string){switch(status){case 'complete':return t('config.complete');case 'unreadable':return t('config.unreadable');case 'missing':return t('config.missing');case 'resourceLimited':return t('config.estimateLimited');default:return t('webui.unknown');}}
function estimateLabel(status?:string){switch(status){case 'estimated':return t('config.estimated');case 'schemaUnavailable':return t('config.schemaUnavailable');case 'notApplicable':return t('config.notApplicable');default:return bodyEstimateLabel(status);}}
