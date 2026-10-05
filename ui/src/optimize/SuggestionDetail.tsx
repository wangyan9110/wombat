import type { OptimizeRequest, OptimizeResult, OptimizeSuggestion, UsageClient } from '@wombat/client';
import { reviewPresentation, t } from '@wombat/client/locale';
import { useEffect, useState } from 'react';
import { Modal, Token, timestamp } from '../components.js';
import { QueryError } from '../Feedback.js';
import { ReviewUsage, TextChanges } from '../ReviewUsage.js';
import { ReviewFacts } from './Assessments.js';
import { returnRoute, linkedReturn, type Route } from '../state.js';
import { FindingMethods, Findings } from './Findings.js';
import { findingLabel, reviewStateLabel } from './presentation.js';
import { HandoffButton } from './Handoff.js';
import { FollowUp } from './FollowUp.js';
interface Props { selected: OptimizeSuggestion; result: OptimizeResult; client: UsageClient; route: Route; busy: boolean; error?: { message: string; code?: string }; navigate: (patch: Partial<Route>) => void; refresh: () => void; run: (action: OptimizeRequest['action'], suggestionId?: string, decisionReason?: OptimizeRequest['decisionReason']) => Promise<void> }
type CopyStatus='optimize.copied'|'optimize.copyFailed';
export function SuggestionDetail({ selected, result, client, route, busy, error, navigate, refresh, run }: Props) {
  const [copy, setCopy] = useState<CopyStatus>();
  const [reason, setReason] = useState<'object_changed' | 'incorrect_evidence'>('object_changed');
  const followUp = result.followUps.find(o => o.recordId === selected.recordId && o.suggestionId === selected.id);
  useEffect(() => setCopy(undefined), [route.suggestion, route.project, route.source]);
  return <Modal key={selected.recordId ?? selected.id} title={reviewPresentation(selected).title} drawer onClose={() => navigate({ suggestion: undefined, suggestionRecord: undefined })}><div className="review-detail">
    {returnRoute(route) && <button className="link" onClick={() => navigate(returnRoute(route)!)}>{t('webui.back')}</button>}<p className="tag">{t(`optimize.${selected.category}`)} · {reviewStateLabel(selected)}</p><p><code className="config-path">{selected.item.path}</code></p><button className="link" disabled={busy} onClick={() => navigate({ page: selected.item.kind === 'rule' ? 'instructions' : 'extensions', returnTo: linkedReturn(route), configView: result.readView ?? undefined, configId: selected.item.id, instructionSearch: undefined, extensionSearch: undefined, extensionKind: undefined, configOffset: 0, configThread: undefined })}>{t('optimize.configuration')}</button>
    <section className="review-issue"><h3>{t('optimize.issueFound')}</h3><p>{selected.findings.map(f => findingLabel(f.rule)).join(' · ')}</p></section>
    <section className="review-evidence"><h3>{t('optimize.locationEvidence')}</h3><Findings suggestion={selected} /></section>
    <section><h3>{t('optimize.recommendedAction')}</h3><p className="review-benefit">{reviewPresentation(selected).value}</p>
      <details className="provenance"><summary>{t('optimize.steps')}</summary><p>{t('optimize.manualNote')}</p><button disabled={busy} onClick={() => { void (navigator.clipboard ? navigator.clipboard.writeText(selected.item.path) : Promise.reject(new Error())).then(() => setCopy('optimize.copied'), () => setCopy('optimize.copyFailed')); }}>{t('optimize.copyPath')}</button><p role="status">{copy?t(copy):''}</p></details></section>
    {selected.status === 'recheckUnavailable' && <div className="read-notice"><p>{t('optimize.recheckUnavailableHint')}</p><button disabled={busy} onClick={() => void run('recheck', selected.id)}>{t('optimize.recheck')}</button></div>}
    <ReviewUsage key={JSON.stringify([selected.item.id, result.readView, route.since, route.until, route.allTime, route.timezone, route.agent, route.source, route.project])} client={client} suggestion={selected} readView={result.readView!} route={route} navigate={navigate} refresh={refresh} />
    <details className="provenance review-basis"><summary>{t('optimize.howDetermined')}</summary>{route.optimizeGroup === 'history' && <h3>{t('optimize.originalFindings')}</h3>}<FindingMethods suggestion={selected} />{selected.item.bodyTokenEstimate && <dl className="facts"><dt>{t('config.bodyTokens')}</dt><dd><Token value={selected.item.bodyTokenEstimate.tokens} /></dd><dt>{t('config.estimateBasis')}</dt><dd><code>{selected.item.bodyTokenEstimate.method}</code></dd><dt>{t('config.bodyHash')}</dt><dd><code>{selected.item.bodyTokenEstimate.contentHash}</code></dd></dl>}<p className="note">{t('optimize.scopeNote')}</p><p className="note">{t('optimize.recordDatesNote')}</p><p className="note">{timestamp(selected.recordedAt ?? selected.checkedAt, route.timezone)}</p></details>
    <section className="review-history"><h3>{t('optimize.handlingRecord')}</h3>
      <TextChanges suggestion={selected} />
      {followUp && <FollowUp observation={followUp} timezone={route.timezone} />}
      <ReviewFacts suggestion={selected} timezone={route.timezone} />
      {error && <QueryError error={error.message} code={error.code} retry={refresh} />}{busy && <p role="status">{t('webui.loading')}</p>}
      <div className="review-actions">
      <button disabled={busy} onClick={() => void run('recheck', selected.id)}>{t('optimize.recheck')}</button>
      {(route.optimizeGroup ?? 'pending') === 'pending' && <>
        <HandoffButton client={client} route={route} suggestionId={selected.id} disabled={busy} />
        <button disabled={busy} onClick={() => void run('keep', selected.id, 'necessary')}>{t('optimize.keep')}</button>
        <label>{t('optimize.decisionReason')}<select disabled={busy} value={reason} onChange={e => setReason(e.target.value as typeof reason)}>
          <option value="object_changed">{t('optimize.reason.objectChanged')}</option>
          <option value="incorrect_evidence">{t('optimize.reason.incorrectEvidence')}</option>
        </select></label>
        <button disabled={busy} onClick={() => void run('not_applicable', selected.id, reason)}>{t('optimize.notApplicable')}</button>
      </>}
      {selected.decision && <>
        <button disabled={busy} onClick={() => void run('redisplay', selected.id)}>{t('optimize.redisplay')}</button>
      </>}
      </div>
    </section>
  </div></Modal>;
}
