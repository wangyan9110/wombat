import {SetupPanel} from './SetupPanel.js';
import {StartupDirectories} from './StartupDirectories.js';
import type { UsageClient, UsageScope, UsageSummary } from '@wombat/client';
import { automaticPriceText, locale, sourceReadLabel, t } from '@wombat/client/locale';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Basis, Empty, Heading, Modal, directoryName, timestamp } from './components.js';
import { ConfigView } from './ConfigView.js';
import { EmptyUsage, QueryError } from './Feedback.js';
import { OptimizeSummary, OptimizeView } from './OptimizeView.js';
import { FreshnessNotice, Preparation } from './Preparation.js';
import { PricesView } from './PricesView.js';
import { saveLanguage } from './session.js';
import { Filters } from './shell/Filters.js';
import { NavigationTabs } from './shell/NavigationTabs.js';
import { ProjectNavigation } from './shell/ProjectNavigation.js';
import { QueryScope } from './shell/QueryScope.js';
import { Sources } from './shell/Sources.js';
import { WorkspaceHeader } from './shell/WorkspaceHeader.js';
import { advanceRelativeRoute, fromScope, linkedReturn, parseRoute, routeSearch, type Route } from './state.js';
import { ThreadsView } from './ThreadsView.js';
import { UsageDrawer, type UsageSelection } from './UsageDrawer.js';
import { UsageView } from './UsageView.js';
import { useScopeContext } from './useScopeContext.js';
import { useWorkspace } from './useWorkspace.js';
import { workspaceKey } from './workspace.js';
import { AccountPanel } from './AccountPanel.js';
import { AccountCompactButton, AccountSummaryCard } from './account/Summary.js';
import { useAccount } from './account/useAccount.js';
import { useNavigation } from './useNavigation.js';
export function App({ client }: { client: UsageClient }) {
  const { locale: language } = useSyncExternalStore(locale.subscribe, locale.getSnapshot);
  const [route, setRoute] = useState(() => parseRoute(location.search)), [dark, setDark] = useState(() => localStorage.getItem('wombat-theme') === 'dark');
  const [drawer, setDrawer] = useState<UsageSelection>(), [preferenceError, setPreferenceError] = useState(false);
  const preferenceQueue = useRef(Promise.resolve());
  const savePreference = (next: 'zh' | 'en') => { if (!client.preferences) return; preferenceQueue.current = preferenceQueue.current.catch(() => { }).then(async () => { try { await client.preferences!({ action: 'set', language: next }); setPreferenceError(false); } catch { setPreferenceError(true); } }); };
  const lastLanguage = useRef(language);
  useEffect(() => { if (lastLanguage.current !== language) { lastLanguage.current = language; savePreference(language); } }, [language]);
  const changeLanguage = (next: 'zh' | 'en') => locale.setLocale(next);
  const [configProjects, setConfigProjects] = useState<string[]>([]);
  const [setupOpen,setSetupOpen]=useState<'mode'|'use'>();
  const [setupDismissed,setSetupDismissed]=useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const account = useAccount(client, !!client.account);
  const [modal, setModal] = useState<'dates' | 'filters' | 'scope' | 'sources' | 'help' | UsageSummary>();
  const scopeContext = useScopeContext(client, ['instructions', 'extensions'].includes(route.page) ? route.configView : route.page === 'optimize' ? route.optimizeView : undefined);
  const workspace = useWorkspace(client, route), { data, loading, error, progress } = workspace;

  // A provisional task header has no stable ledger to pin. Preserve selection and
  // filters while following the authoritative scan, including after a reload.
  useEffect(() => {
    if (data?.freshness?.initialScan && route.snapshot === data.overview.snapshotRef.snapshotId) {
      setRoute(current => {
        if (current.snapshot !== data.overview.snapshotRef.snapshotId) return current;
        const next = { ...current, snapshot: undefined };
        history.replaceState(history.state, '', routeSearch(next));
        return next;
      });
    }
  }, [data, route.snapshot]);

  useEffect(() => { saveLanguage(sessionStorage, language); document.documentElement.lang = language; document.title = `Wombat · ${t(`webui.${route.page}`)}`; }, [language, route.page]);
  useEffect(() => { document.body.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('wombat-theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => { const tick = () => { if (document.visibilityState === 'visible') setRoute(current => { const next = advanceRelativeRoute(current); if (next !== current) history.replaceState(history.state, '', routeSearch(next)); return next; }); }; const timer = setInterval(tick, 60_000); document.addEventListener('visibilitychange', tick); return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); }; }, []);
  const navigate = useNavigation(route, setRoute, () => { setModal(undefined); setDrawer(undefined); });
  const authorizationChanged = () => { setConfigProjects([]); navigate({ configView: undefined, optimizeView: undefined, decisionRevision: undefined, snapshot: undefined, configId: undefined, suggestion: undefined }); workspace.refresh(); };
  const pinConfig = (view: string) => { const next = { ...route, configView: view }; history.replaceState(null, '', routeSearch(next)); setRoute(next); };
  const pinOptimize = (view: string, decisionRevision: string) => { const next = { ...route, optimizeView: view, decisionRevision }; history.replaceState(null, '', routeSearch(next)); setRoute(next); };
  const refreshConfig = () => navigate({ configView: undefined, snapshot: undefined, configId: undefined, configOffset: 0, evidenceOffset: 0 });
  const changeScope = (project?: string, unassigned = false) => navigate({ project, unassigned, dimension: project || unassigned ? 'models' : 'projects', offset: 0, periodOffset: 0, thread: undefined, turn: undefined, turnOffset: 0 });
  const resetFilters = (patch: Partial<Route>) => navigate({ ...patch, offset: 0, periodOffset: 0, thread: undefined, turn: undefined, turnOffset: 0 });
  const drill = (scope: UsageScope) => navigate({ ...fromScope(scope), returnTo: linkedReturn(route), page: 'threads', sort: route.sort === 'cost' ? 'cost' : 'tokens', offset: 0, thread: undefined, turn: undefined, turnOffset: 0, search: undefined });
  const empty = data ? <EmptyUsage paused={workspace.errorCode==='CANCELLED'} tasks={() => navigate({ page: 'threads', snapshot: data.overview.snapshotRef.snapshotId, allTime: true, relativeDays: undefined, model: undefined, modelUnknown: false, effort: undefined, effortUnknown: false, search: undefined, undated: false, offset: 0, thread: undefined, turn: undefined, turnOffset: 0 })} result={data.overview} sources={() => setModal('sources')} filtered={!!(route.project || route.unassigned || route.model || route.modelUnknown || route.effort || route.effortUnknown || route.agent || route.source || route.search || route.undated)} clear={() => resetFilters({ project: undefined, unassigned: false, model: undefined, modelUnknown: false, effort: undefined, effortUnknown: false, agent: undefined, source: undefined, search: undefined, undated: false })} dates={() => resetFilters({ ...fromScope(data.overview.availableRange ?? {}), timezone: route.timezone, model: route.model, modelUnknown: route.modelUnknown, effort: route.effort, effortUnknown: route.effortUnknown, agent: route.agent, source: route.source, project: route.project, unassigned: route.unassigned, search: undefined })} /> : null;
  const contextOverview = scopeContext.usage ?? data?.overview, facets = contextOverview?.facets, dirs = [...new Set([...(facets?.directories ?? []), ...(data?.freshness?.projectLoads?.flatMap(p => p.project == null ? [] : [p.project]) ?? []), ...configProjects, ...(scopeContext.config?.authorizedProjects ?? [])])];
  const scope = route.project ? directoryName(route.project) : route.unassigned ? t('webui.unassigned') : t('webui.all');
  const scopeValue = route.project ? 'directory:' + route.project : route.unassigned ? 'unassigned' : 'all';
  const filters = [route.model, route.modelUnknown ? t('webui.unknown') : null, route.effort, route.effortUnknown ? t('webui.unknown') : null, route.timezone].filter(Boolean);
  const sourceCount = contextOverview?.quality.sources.length;
  const sourceLabel = loading||workspace.pending||data?.freshness?.initialScan&&data.freshness.status!=='failed'&&!workspace.errorCode?t('source.reading'):workspace.errorCode==='CANCELLED'?t('source.incomplete'):sourceCount===1?sourceReadLabel(contextOverview!.quality.sources[0]):sourceCount===undefined?t('webui.unknown'):t('webui.sourceCount',{count:sourceCount});
  const initialReading = !!data?.freshness?.initialScan && data.freshness.status !== 'failed' && !workspace.errorCode;
  const configPage = ['instructions', 'extensions', 'optimize'].includes(route.page);
  const stale = !configPage && data && workspaceKey(data.route) !== workspaceKey(route);
  const setupOverview = !stale && contextOverview && (contextOverview.scope.project ?? undefined) === route.project && (contextOverview.scope.sourceInstanceId ?? undefined) === route.source && !!contextOverview.scope.projectUnknown === !!route.unassigned ? contextOverview : undefined;
  const shownRoute = stale && workspaceKey(data.route) !== workspaceKey(route) ? data.route : route;
  const page = shownRoute.page;
  const dateLabel = route.relativeDays;
  const goBack = () => { if (history.length > 1) history.back(); else navigate({ page: 'usage' }); };
  const openAccount = () => setAccountOpen(true);
  const accountCard = client.account ? <AccountSummaryCard state={account} timezone={route.timezone} open={openAccount} /> : undefined;
  const compactAccount = client.account ? <AccountCompactButton state={account} open={openAccount} /> : undefined;
  return <><a className="skip" href="#content">{t('webui.skip')}</a><div className="app"><ProjectNavigation route={route} scopeValue={scopeValue} dirs={dirs} projectLoads={data?.freshness?.projectLoads} hasUnassigned={facets?.hasUnassigned || data?.freshness?.projectLoads?.some(p => p.project == null)} sourceLabel={sourceLabel} changeScope={changeScope} onSources={() => setModal('sources')} footer={accountCard} /><div className="workspace"><WorkspaceHeader route={route} scope={scope} dark={dark} language={language} setDark={setDark} changeLanguage={changeLanguage} account={compactAccount} setModal={setModal} setup={()=>setSetupOpen('mode')} skill={()=>setSetupOpen('use')} /><ProjectNavigation compact route={route} scopeValue={scopeValue} dirs={dirs} projectLoads={data?.freshness?.projectLoads} hasUnassigned={facets?.hasUnassigned || data?.freshness?.projectLoads?.some(p => p.project == null)} sourceLabel={sourceLabel} changeScope={changeScope} onSources={() => setModal('sources')} /><NavigationTabs route={route} navigate={navigate} />{!['prices', 'sources'].includes(route.page) && !(route.page==='usage'&&(initialReading||!data&&loading)) && <QueryScope route={route} configPage={configPage} facets={facets} filters={filters} dateLabel={dateLabel} loading={loading} pending={workspace.pending || initialReading} errorCode={workspace.errorCode} setModal={setModal} resetFilters={resetFilters} navigate={navigate} refresh={workspace.refresh} cancel={workspace.cancel} />}<main id="content" tabIndex={-1} aria-busy={loading || workspace.pending}>{route.page==='usage'&&!setupDismissed&&(!data||initialReading||!!error)&&<p className="read-notice setup-notice"><span>{t('setup.notice')}</span><button onClick={()=>setSetupOpen('mode')}>{t('setup.title')}</button><button className="icon-button" aria-label={t('webui.close')} onClick={()=>setSetupDismissed(true)}>✕</button></p>}{route.page === 'usage' && !initialReading && <Heading title={t('webui.usage')} sub={shownRoute.undated?t('webui.undated'):shownRoute.allTime?t('webui.allDates'):`${shownRoute.since} — ${shownRoute.until} · ${shownRoute.timezone}`} />}{scopeContext.error && <QueryError error={scopeContext.error} code={scopeContext.code} retry={() => navigate({ configView: undefined, optimizeView: undefined, decisionRevision: undefined })} />}{preferenceError && <p role="alert" className="read-notice">{t('webui.preferenceError')} <button onClick={() => savePreference(language)}>{t('webui.savePreference')}</button></p>}{['prices', 'sources'].includes(route.page) && <div className="backline"><button className="link" onClick={goBack}>‹ {t('webui.back')}</button></div>}{!data && (loading || workspace.pending) && <p className="read-notice">{t('webui.firstValue')} <button onClick={() => navigate({ page: 'instructions' })}>{t('webui.config')}</button></p>}{(loading || workspace.pending || initialReading) && workspace.waitingSince !== undefined && <Preparation initial={initialReading} since={workspace.waitingSince} pending={workspace.pending} progress={progress} cancel={route.page==='usage'&&(initialReading||!data)?workspace.cancel:undefined} />}{error && <QueryError provisional={data?.freshness?.initialScan} error={error} code={workspace.errorCode} retry={workspace.refresh} hasResult={!!data} previousResultAt={data?.readAt ? timestamp(data.readAt, shownRoute.timezone) : undefined} />}{workspace.updatesAvailable && !error && <p className="read-notice" role="status">{t('webui.updatesAvailable')} <button onClick={workspace.refresh} disabled={loading}>{t('webui.applyUpdates')}</button></p>}{stale && <p className="read-notice" role="status">{t('webui.stale', { range: data.route.allTime ? t('webui.allDates') : data.route.undated ? t('webui.undated') : `${data.route.since} — ${data.route.until}` })}</p>}{!configPage && data && <FreshnessNotice data={data} />} {!configPage && data && !data.freshness?.initialScan && data.overview.quality.status === 'partial' && <p className="read-notice"><button className="link" onClick={() => setModal('sources')}>{t('webui.partial')}</button></p>}{workspace.renewed && <p className="read-notice" role="status">{t('webui.versionRenewed')}</p>}{!configPage && data && automaticPriceText({ ...data.overview, priceUpdate: data.priceUpdate }) && <p className="read-notice">{automaticPriceText({ ...data.overview, priceUpdate: data.priceUpdate })}</p>}{route.page === 'prices' ? <PricesView client={client} /> : route.page === 'sources' ? <Sources onChanged={authorizationChanged} client={client} data={data} result={contextOverview} retry={workspace.refresh} /> : route.page === 'optimize' ? <OptimizeView client={client} route={route} navigate={navigate} pin={pinOptimize} /> : configPage ? <ConfigView client={client} route={route} navigate={navigate} pin={pinConfig} projects={setConfigProjects} refresh={refreshConfig} /> : data?.freshness?.initialScan&&route.page==='usage' ? <StartupDirectories directories={dirs} open={project=>navigate({page:'threads',project,allTime:true,relativeDays:undefined,thread:undefined,turn:undefined})} instructions={()=>navigate({page:'instructions'})}/> : data ? <div inert={!!stale}>{page === 'threads' ? <ThreadsView empty={empty} refresh={workspace.refresh} client={client} data={data} route={shownRoute} navigate={navigate} usage={setDrawer} basis={setModal} /> : <><UsageView heading={false} empty={empty} setReading={workspace.setReading} client={client} refresh={workspace.refresh} data={data} route={shownRoute} navigate={navigate} drill={drill} usage={setDrawer} basis={setModal} />{page === 'usage' && <OptimizeSummary client={client} route={shownRoute} navigate={navigate} />}</>}</div> : !loading && !workspace.pending && !error ? <Empty title={t('webui.empty')} copy={t('webui.emptyHint')} /> : null}</main><footer className="statusbar"><span>{t('webui.local')} · {sourceLabel}</span><span>{data ? timestamp(data.overview.snapshotRef.createdAt, shownRoute.timezone) : ''}</span></footer></div></div><div id="token-popover" popover="auto" className="token-popover" role="status" />{setupOpen&&<SetupPanel key={JSON.stringify([route.project,route.source])} client={client} project={route.project} sourceInstanceId={route.source} overview={setupOverview} timezone={route.timezone} initial={setupOpen} close={()=>setSetupOpen(undefined)}/>} {accountOpen && <AccountPanel state={account} timezone={route.timezone} onClose={() => setAccountOpen(false)} />} {drawer && <UsageDrawer client={client} selection={drawer} route={route} navigate={navigate} onClose={() => setDrawer(undefined)} />} {modal && <Modal title={typeof modal === 'object' ? t('webui.basis') : modal === 'scope' ? t('webui.scope') : t(`webui.${modal}`)} onClose={() => setModal(undefined)}>{typeof modal === 'object' ? <Basis summary={modal} onPrices={() => navigate({ page: 'prices' })} /> : modal === 'sources' ? <Sources onChanged={authorizationChanged} client={client} compact data={data} result={contextOverview} retry={workspace.refresh} /> : modal === 'help' ? <><p>{t(`help.${['usage', 'threads', 'instructions', 'extensions', 'optimize'].includes(route.page) ? route.page as 'usage' | 'threads' | 'instructions' | 'extensions' | 'optimize' : 'usage'}`)}</p></> : modal === 'scope' ? <><p>{t('webui.scopeNote')}</p>{route.project && <code>{route.project}</code>}</> : <Filters kind={modal as 'dates' | 'filters'} route={route} data={data} apply={resetFilters} />}</Modal>}</>;
}
