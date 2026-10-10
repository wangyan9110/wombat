import { UseBasis } from '../UseBasis.js';
import type { OptimizeResult } from '@wombat/client';
import { followUpText, t } from '@wombat/client/locale';
import { timestamp } from '../components.js';
import { Population } from '../UsageStatistics.js';
export function FollowUp({ observation, timezone }: { observation: OptimizeResult['followUps'][number]; timezone: string }) {
  const comparison=observation.usageComparison;
  return <section className="review-related follow-up"><h3>{t('optimize.followUp')}</h3><p>{t('optimize.awaitingFollowUp')}</p><p>{followUpText(observation)}</p><p className="note">{t('optimize.followUp.scope')} {timestamp(observation.after, timezone)}</p><p className="note">{t('optimize.followUp.note')}</p><UseBasis basis={observation.useBasis}/>{comparison&&<details><summary>{t('optimize.followUp.usageComparison')}</summary><h4>{t('optimize.followUp.baseline')}</h4><p>{timestamp(comparison.baselineStart,timezone)} — {timestamp(comparison.changeAt,timezone)}</p><Population population={comparison.baseline}/><h4>{t('optimize.followUp.current')}</h4><p>{timestamp(comparison.changeAt,timezone)} — {timestamp(comparison.observedThrough,timezone)}</p><Population population={comparison.current}/><p className="note">{t('optimize.followUp.usageComparisonNote')}</p></details>}</section>;
}
