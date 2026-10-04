import type { ConfigRequest, UsageClient } from '@wombat/client';
import { t } from '@wombat/client/locale';
import { useEffect, useRef, useState } from 'react';
import { Empty, Heading, Pagination, timestamp } from './components.js';
import './config.css';
import { QueryError } from './Feedback.js';
import { ExtensionInventory, InstructionInventory } from './Inventory.js';
import { OptimizeView } from './OptimizeView.js';
import { returnRoute, type Route } from './state.js';
import { configRequest } from './useConfig.js';
import { useInventory, useInventorySuggestions } from './useInventory.js';
export { configRequest } from './useConfig.js';


import { ConfigDetail } from './config/ConfigDetail.js';
import { issueText } from './config/presentation.js';
export function ConfigView({ client, route, navigate, pin, projects, refresh }: {
  client: UsageClient; route: Route; navigate: (patch: Partial<Route>) => void;
  pin: (view: string) => void; projects: (paths: string[]) => void; refresh: () => void;
}) {
  const instructions = route.page === 'instructions';
  const filters = configRequest(route);
  const onlySuggestions = instructions ? !!route.instructionSuggestions : !!route.extensionSuggestions;
  const query = useInventory(client, route.unassigned ? undefined : { ...filters, search: instructions ? undefined : filters.search }, instructions || onlySuggestions);
  const suggestions = useInventorySuggestions(client, query.data?.readView ?? undefined, route.project, route.source, route.agentsBytes, route.descriptionCharacters);
  const [search, setSearch] = useState(filters.search ?? '');
  const pinRef = useRef(pin), projectRef = useRef(projects);
  pinRef.current = pin; projectRef.current = projects;
  useEffect(() => { setSearch(filters.search ?? ''); }, [filters.search]);
  useEffect(() => {
    if (!query.data) return;
    projectRef.current(query.data.authorizedProjects);
    if (!route.configView && query.data.readView) pinRef.current(query.data.readView);
  }, [query.data, route.configView]);
  const result = query.data;
  const update = (patch: Pick<ConfigRequest, 'search' | 'kind'>) => navigate({ ...('search' in patch ? { [instructions ? 'instructionSearch' : 'extensionSearch']: patch.search ?? undefined } : {}), ...('kind' in patch ? { extensionKind: patch.kind === 'rule' ? undefined : patch.kind ?? undefined } : {}), configOffset: 0, configId: undefined, suggestion: undefined, evidenceOffset: 0 });
  const openSuggestion = (s: import('@wombat/client').OptimizeSuggestion) => navigate({ suggestion: s.id, suggestionRecord: s.recordId ?? undefined, optimizeView: result?.readView ?? undefined, decisionRevision: suggestions.revision, optimizeOffset: Math.floor(suggestions.ordered.findIndex(v => v.id === s.id) / 30) * 30, optimizeGroup: 'pending', optimizeCategory: undefined, configId: undefined });

  if (route.unassigned) return <Empty title={t('config.empty')} copy={t('config.emptyHint')}><button onClick={() => navigate({ unassigned: false, project: undefined })}>{t('webui.all')}</button></Empty>;
  return <>
    {!route.configId && !route.suggestion && returnRoute(route) && <p className="read-notice"><button className="link" onClick={() => navigate(returnRoute(route)!)}>{t('webui.back')}</button></p>}
    <Heading title={t(instructions ? 'webui.instructions' : 'webui.extensions')} sub={t(instructions ? 'config.instructionsScopeNote' : 'config.extensionsScopeNote')}>
      <button onClick={query.loading ? query.cancel : refresh}>{t(query.loading ? 'webui.cancel' : 'config.refresh')}</button>
    </Heading>
    {route.configThread && <p className="read-notice">{t('config.threadFilter')} <button onClick={() => navigate({ configThread: undefined, configId: undefined, configOffset: 0, evidenceOffset: 0 })}>{t('config.clearThread')}</button></p>}
    {query.loading && <p role="status">{t('webui.loading')}</p>}
    {query.error && <QueryError error={query.error} code={query.code} retry={query.code === 'VIEW_EXPIRED' || query.code === 'NOT_FOUND' ? refresh : query.retry} />}
    {result && <>
      <div className="config-toolbar">
        {!instructions && <nav className="config-types" aria-label={t('webui.extensions')}>{(['all', 'skill', 'mcp', 'hook'] as const).map(kind => <button key={kind} aria-pressed={(filters.kind ?? 'all') === kind} onClick={() => update({ kind: kind === 'all' ? undefined : kind })}>{t(`config.${kind}`)}</button>)}</nav>}
        <form className="search-form" onSubmit={event => { event.preventDefault(); update({ search: search || undefined }); }}><input aria-label={t('config.search')} placeholder={t('config.search')} value={search} onChange={event => setSearch(event.target.value)} /><button aria-label={t('webui.searchAction')}>⌕</button></form>
        <button aria-pressed={onlySuggestions} onClick={() => navigate({ [instructions ? 'instructionSuggestions' : 'extensionSuggestions']: !onlySuggestions, configOffset: 0 })}>{t('config.suggestionsOnly')}</button>
      </div>
      <div className="config-layout">
        <section className="panel config-list" data-view-scroll data-view-key="config-list" aria-label={t('webui.config')}>
          <div className="list-meta">{t('config.count', { count: result.page.total })}</div>
          {instructions ? <InstructionInventory coverage={result.coverage} onExpand={instructionExpansion => navigate({ instructionExpansion })} items={result.items} suggestions={suggestions.byItem} route={route} onlySuggestions={onlySuggestions} onOpen={item => navigate({ configId: item.id, suggestion: undefined, evidenceOffset: 0 })} onSuggestion={openSuggestion} /> : <ExtensionInventory coverage={result.coverage} items={onlySuggestions ? result.items.filter(i => suggestions.byItem.has(i.id)) : result.items} suggestions={suggestions.byItem} route={route} onOpen={item => navigate({ configId: item.id, suggestion: undefined, evidenceOffset: 0 })} onSuggestion={openSuggestion} />}
          {!result.items.length && <Empty title={t('config.empty')} copy={t('config.emptyHint')} />}
          {!instructions && !onlySuggestions && <Pagination page={result.page} onPage={offset => navigate({ configOffset: offset, configId: undefined, evidenceOffset: 0 })} />}
        </section>
        {suggestions.error && <QueryError error={suggestions.error.message} retry={refresh} />}
        {route.suggestion && <OptimizeView embedded client={client} route={{ ...route, optimizeView: result.readView ?? undefined }} navigate={navigate} pin={() => { }} />}
        {route.configId && !route.suggestion && result.readView && <ConfigDetail key={route.configId} client={client} route={route} readView={result.readView} navigate={navigate} refresh={refresh} restoreFocus={() => { for (const button of document.querySelectorAll<HTMLButtonElement>('[data-config-id]')) if (button.dataset.configId === route.configId) { button.focus(); break; } }} />}
      </div>
      <details className="provenance config-coverage"><summary>{t('config.issues')}</summary><p>{t('config.coverageNote')}</p>
        {!['current', 'fixed'].includes(result.coverage.historyStatus) && <p>{t(result.coverage.historyStatus === 'unavailable' ? 'config.historyUnavailable' : 'config.historyStale')}</p>}
        {result.coverage.issues.map((issue, i) => <p key={i}>{issueText(issue.code)}{issue.path && <> · <code>{issue.path}</code></>}</p>)}
        <h3>{t('config.authorized')}</h3>{result.authorizedProjects.map(path => <p key={path}><code>{path}</code></p>)}<p>{t('config.authorizeHint')}</p>
        <p>{t('config.readVersion', { version: result.readView ?? '—' })}</p><p>{timestamp(result.checkedAt, route.timezone)}</p>
      </details>
    </>}
  </>;
}
