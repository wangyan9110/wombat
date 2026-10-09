import { numberLabel } from '@wombat/client/locale';
import type { OptimizeSuggestion } from '@wombat/client';
import { directoryName } from '../components.js';
import { reviewFindingLabel, reviewFindingNote, reviewFindingCount, t } from '@wombat/client/locale';

type Evidence = NonNullable<OptimizeSuggestion['findings'][number]['evidence']>;
function EvidenceDetails({ evidence }: { evidence: Evidence }) {
  return <>
    {evidence.hook && <article>
      <p>{t('optimize.referenceMissing')}: <code>{evidence.hook.target}</code></p>
      <p>{t('optimize.referenceBase')}: <code>{evidence.hook.project}</code></p>
    </article>}
    {evidence.references.map((reference, index) => <article key={index}>
      <p>{t(reference.status === 'referenceTargetMissing' ? 'optimize.referenceMissing' : 'optimize.referenceType')}: <code>{reference.target}</code></p>
      <p>{t('optimize.referenceBase')}: <code>{reference.baseDirectory}</code> · {reference.startLine}–{reference.endLine}</p>
    </article>)}
    <p>{t(evidence.applicability === 'nativeHookProject' ? 'optimize.hookTargetApplicability'
      : evidence.applicability === 'sameFileSameHeading' ? 'optimize.sameFileApplicability'
        : evidence.applicability === 'userDeclaredCopy' ? 'optimize.copyNote' : 'optimize.declaredApplicability')}</p>
    {evidence.declarationHash && <p>{t('optimize.declarationBasis')}: <code>{evidence.declarationHash}</code> · {evidence.relationId}</p>}
    <h4>{t('optimize.fileVersions')}</h4>
    {evidence.versions.map(version => <p key={version.itemId}><code>{version.path}</code><br /><code>{version.contentHash}</code></p>)}
    {evidence.positions.length > 0 && <>
      <h4>{t('optimize.positions')}</h4>
      {evidence.positions.map((position, index) => <p key={index}><code>{evidence.versions.find(version => version.itemId === position.itemId)?.path}</code> · {position.startLine}–{position.endLine} / [{position.startByte}, {position.endByte})</p>)}
    </>}
  </>;
}

export function formatIssueReason(code: string) {
  switch (code) {
    case 'frontMatterMissing': return t('optimize.formatIssue.frontMatterMissing');
    case 'frontMatterUnclosed': return t('optimize.formatIssue.frontMatterUnclosed');
    case 'frontMatterInvalid': return t('optimize.formatIssue.frontMatterInvalid');
    case 'nameMissing': return t('optimize.formatIssue.nameMissing');
    case 'nameTypeInvalid': return t('optimize.formatIssue.nameTypeInvalid');
    case 'nameTooLong': return t('optimize.formatIssue.nameTooLong');
    case 'nameInvalid': return t('optimize.formatIssue.nameInvalid');
    case 'nameDirectoryMismatch': return t('optimize.formatIssue.nameDirectoryMismatch');
    case 'descriptionMissing': return t('optimize.formatIssue.descriptionMissing');
    case 'descriptionTypeInvalid': return t('optimize.formatIssue.descriptionTypeInvalid');
    case 'licenseTypeInvalid': return t('optimize.formatIssue.licenseTypeInvalid');
    case 'allowed-toolsTypeInvalid': return t('optimize.formatIssue.allowedToolsTypeInvalid');
    case 'compatibilityTypeInvalid': return t('optimize.formatIssue.compatibilityTypeInvalid');
    case 'compatibilityTooLong': return t('optimize.formatIssue.compatibilityTooLong');
    case 'metadataTypeInvalid': return t('optimize.formatIssue.metadataTypeInvalid');
    default: return code;
  }
}

function FormatDiagnostics({ suggestion }: { suggestion: OptimizeSuggestion }) {
  const diagnostics = suggestion.item.skillMetadata?.diagnostics ?? [];
  return <>{diagnostics.map((diagnostic, index) => <article className="finding-evidence" key={`${diagnostic.code}:${index}`}>
    <p><code>{suggestion.item.path}</code>{diagnostic.line != null && <> · {t('optimize.line', { number: diagnostic.line })}</>}{diagnostic.column != null && <>:{diagnostic.column}</>}{diagnostic.field && <> · {t('optimize.field')}: <code>{diagnostic.field}</code></>}</p>
    <p><strong>{t('optimize.errorReason')}</strong> {formatIssueReason(diagnostic.code)}</p>
    {diagnostic.current != null && <div><small>{t('optimize.currentContent')}</small><pre><code>{diagnostic.current}</code></pre></div>}
    {diagnostic.expected != null && <div><small>{t('optimize.correctFormat')}</small><pre><code>{diagnostic.expected}</code></pre></div>}
  </article>)}</>;
}

export function Findings({ suggestion }: { suggestion: OptimizeSuggestion }) {
  return <ul className="finding-list">{suggestion.findings.map((finding, index) => {
    const count = reviewFindingCount(finding);
    return <li key={finding.identity.findingId ?? finding.rule + index}>
      <strong>{reviewFindingLabel(finding.rule)}</strong>
      <p>{reviewFindingNote(finding.rule, suggestion.item.project ? directoryName(suggestion.item.project) : undefined)}</p>
      {count ? <p>{count}</p> : finding.observed != null && <dl className="finding-measurements"><div><dt>{t('optimize.currentValue')}</dt><dd>{numberLabel(finding.observed)}</dd></div>{finding.threshold != null && <><div><dt>{t('optimize.comparisonValue')}</dt><dd>{numberLabel(finding.threshold)}</dd></div><div><dt>{t('optimize.difference')}</dt><dd>{numberLabel(Math.max(0, finding.observed - finding.threshold))}</dd></div></>}</dl>}
      {!finding.evidence && finding.rule !== 'skillFormat' && <p><code>{suggestion.item.path}</code></p>}
      {finding.rule === 'skillFormat' && <FormatDiagnostics suggestion={suggestion} />}
      {finding.rule !== 'hookTarget' && finding.rule !== 'skillFormat' && finding.evidenceCodes.length > 0 && <p>{finding.evidenceCodes.join(' · ')}</p>}
      {finding.evidence && <EvidenceDetails evidence={finding.evidence} />}
    </li>;
  })}</ul>;
}

export function FindingMethods({ suggestion }: { suggestion: OptimizeSuggestion }) {
  return <ul className="finding-list">{suggestion.findings.map((finding, index) => <li key={`${finding.rule}:${index}`}>
    <strong>{reviewFindingLabel(finding.rule)}</strong>
    <p><code>{finding.rule}</code> · <code>{finding.basis ?? t('webui.unknown')}</code> · <code>{suggestion.ruleVersion}</code></p>
    {finding.threshold != null && <p>{t('optimize.threshold')}: {numberLabel(finding.threshold)}</p>}
    {finding.evidence && <p><code>{finding.evidence.method}</code>{finding.evidence.direction && <> · <code>{finding.evidence.direction}</code> · <code>{finding.evidence.transform}</code></>}</p>}
  </li>)}</ul>;
}
