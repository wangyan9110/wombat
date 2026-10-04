import { InvocationCounts, SourceCounts } from './InvocationCounts.js';
import { HookRegistry } from './HookRegistry.js';
import type { ConfigRequest, UsageClient } from '@wombat/client';
import { configEvidenceLabel,observedCount,inventoryRecordState,t } from '@wombat/client/locale';
import { Modal, Pagination, Pair, Token, directoryName, timestamp } from '../components.js';
import { ConfigSuggestion } from '../ConfigSuggestion.js';
import { QueryError } from '../Feedback.js';
import { RuleChecks } from '../RuleChecks.js';
import { returnRoute, relatedTurnRoute, type Route } from '../state.js';
import { configRequest, useConfig } from '../useConfig.js';
import { bodyEstimateLabel, estimateLabel, measurementLabel, metadataLabel, stateLabel } from './presentation.js';
export function ConfigDetail({ client, route, readView, navigate, refresh, restoreFocus }: { client: UsageClient; route: Route; readView: string; navigate: (patch: Partial<Route>) => void; refresh: () => void; restoreFocus: () => void }) {
  const relatedOffset = route.relatedOffset ?? 0;
  const base: ConfigRequest = { ...configRequest(route), readView, snapshotId: undefined, kind: undefined, kinds: undefined, observation: undefined, search: undefined, itemId: route.configId };
  const query = useConfig(client, { ...base, action: 'evidence', offset: route.evidenceOffset ?? 0, limit: 20 });
  const related = useConfig(client, { ...base, action: 'related_scopes', offset: relatedOffset, limit: 20 });
  const result = query.data, item = result?.items[0];
  const back = returnRoute(route);
  return <Modal title={item?.name ?? t('config.evidence')} drawer restoreFocus={restoreFocus} onClose={() => navigate({ configId: undefined, evidenceOffset: 0 })}><section className="detail config-detail" aria-label={t('config.evidence')} aria-busy={query.loading}>
    {back && <button className="link" onClick={() => navigate(back)}>{t('webui.back')}</button>}
    {query.loading && <p role="status">{t('webui.loading')}</p>}{query.error && <QueryError error={query.error} code={query.code} retry={query.code === 'VIEW_EXPIRED' || query.code === 'NOT_FOUND' ? refresh : query.retry} />}
    {item && result && <><p className="tag">{stateLabel(item)}</p><p className="config-path"><code>{item.path}</code></p>
      {item.current && item.observation === 'unknown' && <p className="note">{t(item.kind === 'rule' ? 'config.ruleLoadHint' : item.kind === 'skill' && item.configuredState === 'enabled' ? 'config.skillAvailableHint' : 'config.extensionUsageHint')}</p>}
      {item.kind === 'hook' && <><p>{t('config.hookDeclaration')}</p><HookRegistry registry={result.hookRegistry} itemId={item.id} timezone={route.timezone} /></>}<p>{t(item.estimate ? item.kind === 'hook' ? 'config.hookMeasurementNote' : 'config.contentNote' : item.estimateStatus === 'schemaUnavailable' ? 'config.schemaUnavailable' : item.estimateStatus === 'resourceLimited' ? 'config.estimateLimited' : 'config.tokenizerUnavailable')}</p>
      <dl className="facts"><dt>{t('config.tokens')}</dt><dd>{item.usage ? <Pair summary={item.usage} /> : '—'}</dd><dt>{t(item.kind === 'skill' ? 'config.observedUses' : 'config.activity')}</dt><dd>{item.usageCount?.toLocaleString() ?? '—'}</dd>{item.kind==='skill'&&<><dt>{t('webui.relatedTasks')}</dt><dd>{item.relatedTasks.toLocaleString()}</dd></>}<dt>{t(item.kind === 'rule' ? 'config.ruleLoads' : 'config.reads')}</dt><dd>{observedCount(item.counts.fileReads,result.coverage,'file_read')==null?t('webui.unknown'):t('config.fileReadsCount', { count: item.counts.fileReads })}</dd><dt>{t('config.recent')}</dt><dd>{inventoryRecordState(item,result.coverage).kind==='time'?timestamp(item.lastRecordAt,route.timezone):inventoryRecordState(item,result.coverage).text}</dd></dl>
      {item.kind === 'mcp' && <InvocationCounts counts={item.counts} coverage={result.coverage} />}
      <details className="provenance"><summary>{t('config.measurementDetails')}</summary><p>{t('config.byteBasis')}</p>      <dl className="facts"><dt>{t('config.size')}</dt><dd>{item.bytes == null ? '—' : `${item.bytes.toLocaleString()} B`}</dd><dt>{t('config.content_tokens')}</dt><dd><Token value={item.contentTokens} estimated /></dd><dt>{t('config.characters')}</dt><dd>{item.characters?.toLocaleString() ?? '—'}</dd>{item.skillMetadata && <><dt>{t('config.descriptionCharacters')}</dt><dd>{item.skillMetadata.descriptionCharacters?.toLocaleString() ?? '—'}</dd><dt>{t('config.metadataStatus')}</dt><dd>{metadataLabel(item.skillMetadata.status)}</dd></>}<dt>{t('config.measurement')}</dt><dd>{measurementLabel(item.measurementStatus)} · {estimateLabel(item.estimateStatus)}</dd></dl>
        {item.kind === 'skill' && <><dl className="facts"><dt>{t('config.bodyTokens')}</dt><dd><Token value={item.bodyTokenEstimate?.tokens} estimated /></dd><dt>{t('config.bodyStatus')}</dt><dd>{bodyEstimateLabel(item.bodyEstimateStatus)}</dd>{item.bodyTokenEstimate && <><dt>{t('config.estimateBasis')}</dt><dd><code>{item.bodyTokenEstimate.method}</code></dd><dt>{t('config.bodyHash')}</dt><dd><code>{item.bodyTokenEstimate.contentHash}</code></dd></>}</dl><p className="note">{t('config.bodyNote')}</p></>}
        {item.estimate && <dl className="facts"><dt>{t('config.estimateBasis')}</dt><dd><code>{item.estimate.method}</code></dd><dt>{t('config.contentHash')}</dt><dd><code>{item.estimate.contentHash}</code></dd></dl>}<p className="note">{t(item.kind === 'rule' ? 'config.ruleLoadHint' : item.kind === 'skill' ? 'config.skillUsageNote' : 'config.unknownCounts')}</p>
      </details>
      <ConfigSuggestion client={client} route={route} itemId={item.id} readView={readView} navigate={navigate} refresh={refresh} />
      <RuleChecks client={client} route={route} itemId={item.id} readView={readView} />
      <p className="note">{item.counts.succeeded+item.counts.failed+item.counts.outcomeUnknown>0?t('config.outcomes',{success:item.counts.succeeded,failed:item.counts.failed,unknown:item.counts.outcomeUnknown}):t(item.kind === 'rule' ? 'config.ruleLoadHint' : 'config.unknownCounts')}</p><p className="note">{t('config.associatedNote')}</p><p className="note">{t('config.versionNote')}</p>
      {!!item.sourceContexts?.length && <details className="provenance"><summary>{t('webui.sourceInstance')}</summary>{item.sourceContexts.map(c => <p key={c.inventoryId}><code>{c.sourceInstanceId}</code> · <SourceCounts counts={c.counts} coverage={result.coverage} /><br />{stateLabel({ ...item, observation: c.observation })} · <code>{c.contentHash}</code></p>)}</details>}<h3>{t('config.evidence')}</h3>{!result.evidence.length && <p>{t('config.noEvidence')}</p>}
      {result.evidence.map(e => <article className="config-evidence" key={e.id}><strong>{e.title ?? e.threadId}</strong><p>{configEvidenceLabel(e.eventType)} · {timestamp(e.timestamp, route.timezone)}</p>{e.sourceInstanceId && <p><code>{e.sourceInstanceId}</code></p>}{e.usage && <Pair summary={e.usage} />}<button className="link" disabled={!result.usageRevision} onClick={() => navigate(relatedTurnRoute(route, result.usageRevision!, e.threadId, e.turnId ?? undefined))}>{t('config.viewThread')}</button></article>)}
      <Pagination page={result.page} onPage={offset => navigate({ evidenceOffset: offset })} />
      <h3>{t('config.relatedScopes')}</h3>{related.error && <QueryError error={related.error} code={related.code} retry={related.code === 'VIEW_EXPIRED' || related.code === 'NOT_FOUND' ? refresh : related.retry} />}
      {related.data?.relatedScopes.map(s => <p key={s.project ?? ''}><button className="link" title={s.project ?? ''} onClick={() => navigate({ project: s.project ?? undefined, unassigned: s.project == null, configView: readView, configId: item.id, evidenceOffset: 0, configOffset: 0 })}>{directoryName(s.project)}</button> · {s.evidenceCount}</p>)}
      {related.data && <Pagination page={related.data.page} onPage={relatedOffset => navigate({ relatedOffset })} />}
    </>}
  </section></Modal>;
}
