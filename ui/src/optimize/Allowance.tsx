import { allowanceStatus, type AllowanceAssessment, type HandoffResult } from '@wombat/client';
import { t } from '@wombat/client/locale';
import { useEffect, useState } from 'react';
export function useAllowanceClock(data?: HandoffResult) {
  const [tick, setTick] = useState(0);
  const now = Date.now();
  useEffect(() => {
    const current = Date.now();
    const deadlines = data?.allowanceChecks.map(c => Date.parse(c.assessment.validUntil ?? '')).filter(d => Number.isFinite(d) && d > current) ?? [];
    if (!deadlines.length) return;
    const timer = setTimeout(() => setTick(value => value + 1), Math.min(...deadlines) - current + 1);
    return () => clearTimeout(timer);
  }, [data, tick]);
  return now;
}
export function HandoffAllowance({ assessment, now }: { assessment?: AllowanceAssessment; now: number }) {
  const status = assessment ? allowanceStatus(assessment, now) : 'unknown';
  return <div className="handoff-allowance" role="status"><p>{t(status === 'blocked' ? 'account.blockedNote' : status === 'low' ? 'account.lowNote' : status === 'available' ? 'account.sendAvailable' : 'account.sendUnknown')}</p>{assessment?.model && <p className="note">{t('account.assessedModel', { model: assessment.model })}</p>}</div>;
}
