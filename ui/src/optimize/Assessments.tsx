import type { OptimizeResult, OptimizeSuggestion } from '@wombat/client';
import { reviewFindingLabel, t } from '@wombat/client/locale';
import { timestamp } from '../components.js';
import { AssessmentMeasurement, assessmentReason } from './AssessmentBasis.js';
type Assessment = OptimizeResult['checks'][number];
type Scope = Assessment['basis']['scope'];
function ScopeDetails({scope}:{scope:Scope}) {
  return <dl className="facts"><dt>{t('webui.directory')}</dt><dd><code>{scope.project ?? scope.itemProject ?? '—'}</code></dd><dt>{t('webui.sourceInstance')}</dt><dd><code>{scope.sourceInstanceId ?? (scope.sourceInstances.join(' · ') || '—')}</code></dd><dt>{t('optimize.coverage')}</dt><dd>{t(scope.complete ? 'optimize.assessment.complete' : 'optimize.assessment.incomplete')}</dd></dl>;
}

/** Render Rust's outcome and comparison directly; missing evidence never becomes a pass. */
export function AssessmentRows({ checks, timezone }: { checks: Assessment[]; timezone: string }) {
  return <>{checks.map((check, index) => <article className="finding-evidence" key={check.assessmentId ?? `${check.rule}:${index}`}>
    <strong>{reviewFindingLabel(check.rule)}</strong>
    <p>{t(`optimize.check.${check.outcome}`)} · {timestamp(check.checkedAt, timezone)}</p>
    <p>{t(`optimize.assessment.comparison.${check.comparison.status}`)}</p>
    {(check.identityGap || check.findings.some(f => f.identity.gap)) && <p className="note">{t('optimize.assessment.identityGap')}</p>}
    <details className="provenance"><summary>{t('optimize.assessment.basis')}</summary>
      <AssessmentMeasurement check={check}/>
      {check.reason && <p>{assessmentReason(check.reason)}</p>}
      {check.comparison.reason && <p>{assessmentReason(check.comparison.reason)}</p>}
      {check.basis.gaps.length > 0 && <><h4>{t('optimize.assessment.gaps')}</h4>{check.basis.gaps.map((gap,index)=><p key={index}>{assessmentReason(gap)}</p>)}</>}
      <p>{t('optimize.assessment.cutoff')}: {timestamp(check.basis.cutoff, timezone)}</p>
      <details className="provenance"><summary>{t('optimize.assessment.scope')}</summary><ScopeDetails scope={check.basis.scope}/><p>{t('config.contentHash')}: <code>{check.contentVersion}</code></p></details>
      <details className="provenance"><summary>{t('optimize.assessment.technical')}</summary>
        <p>{t('optimize.assessment.method')}: <code>{check.ruleVersion} / {check.ruleSemanticsVersion}</code> · {check.methodVersions.map(m => <code key={m.method}>{m.method} / {m.version} </code>)}</p>
        <p><code>{check.basis.dependencyRevision ?? '—'}</code> · <code>{check.assessmentId ?? '—'}</code> · <code>{check.comparison.baselineAssessmentId ?? '—'}</code></p>
        <p><code>{[check.reason,check.identityGap,check.comparison.reason,...check.basis.gaps].filter(Boolean).join(' · ')}</code></p>
        <p>{check.findings.map((finding,index)=><code key={index}>{finding.identity.findingId ?? finding.identity.gap ?? '—'} </code>)}</p><p><code>{JSON.stringify(check.basis.measurement)}</code></p><p><code>{JSON.stringify(check.basis.scope)}</code></p>
      </details>
    </details>
  </article>)}</>;
}

export function ReviewFacts({ suggestion, timezone }: { suggestion: OptimizeSuggestion; timezone: string }) {
  const baseline = suggestion.reviewBaseline;
  return <>
    <section className="review-related"><h3>{t('optimize.assessment.latest')}</h3>
      {suggestion.checks.length ? <AssessmentRows checks={suggestion.checks} timezone={timezone} /> : <p>{t('optimize.evidenceIncomplete')}</p>}
    </section>
    <details className="provenance"><summary>{t('optimize.assessment.original')}</summary>
      {baseline ? <><p><code>{baseline.item.path}</code></p><ScopeDetails scope={baseline.scope}/><AssessmentRows checks={baseline.assessments} timezone={timezone} /></> : <p>{t('optimize.assessment.baselineMissing')}</p>}
    </details>
    {suggestion.decision && <section className="review-related"><h3>{t('optimize.assessment.decision')}</h3>
      <p>{t(suggestion.decision.kind === 'keep' ? 'optimize.kept' : 'optimize.inapplicable')} · {timestamp(suggestion.decision.recordedAt, timezone)}</p>
      <p>{t(suggestion.decision.reason === 'necessary' ? 'optimize.assessment.necessary' : suggestion.decision.reason === 'object_changed' ? 'optimize.reason.objectChanged' : 'optimize.reason.incorrectEvidence')}</p>
      <p className="note">{t('optimize.assessment.decisionNote')}</p>
      {suggestion.decision.binding.gap && <p>{t('optimize.assessment.identityGap')}</p>}
      <details className="provenance"><summary>{t('optimize.assessment.scope')}</summary><ScopeDetails scope={suggestion.decision.binding.scope}/><p>{t('config.contentHash')}: <code>{suggestion.decision.binding.contentVersion}</code></p></details>
      <details className="provenance"><summary>{t('optimize.assessment.technical')}</summary><p><code>{suggestion.decision.binding.identityBasis}</code> · <code>{suggestion.decision.binding.applicabilityId ?? '—'}</code></p><p><code>{suggestion.decision.binding.findingIds.join(' · ')}</code> · <code>{suggestion.decision.binding.assessmentIds.join(' · ')}</code></p><p><code>{suggestion.decision.binding.gap}</code></p></details>
    </section>}
  </>;
}
