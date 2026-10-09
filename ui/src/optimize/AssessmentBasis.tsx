import { numberLabel } from '@wombat/client/locale';
import type { OptimizeResult } from '@wombat/client';
import { assessmentReason, t } from '@wombat/client/locale';
import { formatIssueReason } from './Findings.js';
type Assessment = OptimizeResult['checks'][number];

export { assessmentReason } from '@wombat/client/locale';

/** Five typed input variants are rendered as recorded, including successful checks and absent measurements. */
export function AssessmentMeasurement({ check }: { check: Assessment }) {
  const measurement = check.basis.measurement;
  switch (measurement.kind) {
    case 'numeric': {
      const unit = check.rule === 'fileSize' ? 'bytes' : check.rule === 'bodyTokens' ? 'tokens'
        : check.rule === 'descriptionSize' || check.rule === 'descriptionStandard' ? 'characters' : 'value';
      const basis = measurement.basis === 'productReminder' || measurement.basis === 'agentSkillsSpecification' || measurement.basis === 'agentSkillsRecommendation'
        ? t(`optimize.assessment.basis.${measurement.basis}`) : t('optimize.assessment.basis');
      return <><dl className="facts"><dt>{t('optimize.assessment.observed')} · {t(`optimize.assessment.unit.${unit}`)}</dt><dd>{numberLabel(measurement.observed)}</dd>
        <dt>{t('optimize.threshold')}</dt><dd>{measurement.inclusive ? '≥' : '>'} {numberLabel(measurement.threshold)}</dd>
        {measurement.standardMax != null && <><dt>{t('optimize.assessment.standard')}</dt><dd>{numberLabel(measurement.standardMax)}</dd></>}
      </dl><p>{basis}</p>{measurement.suppressedByStandard&&<p className="note">{t('optimize.assessment.suppressed')}</p>}</>;
    }
    case 'existence': return <p>{t('optimize.assessment.existence')}: {t(measurement.missing ? 'optimize.assessment.missing' : measurement.measurementStatus === 'complete' ? 'optimize.assessment.exists' : 'optimize.assessment.existenceUnknown')}</p>;
    case 'skill_metadata': return <><p>{t('optimize.assessment.parse')}: {t(measurement.status === 'parsed' ? 'optimize.assessment.parsed' : measurement.status === 'invalid' ? 'optimize.assessment.invalid' : 'webui.unknown')}</p>
      {measurement.issues.map((issue, index) => <p key={index}>{formatIssueReason(issue) === issue ? t('optimize.assessment.reason.evidenceMissing') : formatIssueReason(issue)}</p>)}</>;
    case 'static': return <><p>{t('optimize.assessment.static')}: {t(measurement.complete === true ? 'optimize.assessment.complete' : measurement.complete === false ? 'optimize.assessment.incomplete' : 'webui.unknown')}</p><p>{t('optimize.assessment.found')}: {numberLabel(measurement.findings)}</p></>;
    case 'unsupported': return <p>{assessmentReason(measurement.reason)}</p>;
  }
}
