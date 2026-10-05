import { UseBasis } from '../UseBasis.js';
import type { OptimizeResult } from '@wombat/client';
import { followUpText, t } from '@wombat/client/locale';
import { timestamp } from '../components.js';
export function FollowUp({ observation, timezone }: { observation: OptimizeResult['followUps'][number]; timezone: string }) {
  return <section className="review-related follow-up"><h3>{t('optimize.followUp')}</h3><p>{t('optimize.awaitingFollowUp')}</p><p>{followUpText(observation)}</p><p className="note">{t('optimize.followUp.scope')} {timestamp(observation.after, timezone)}</p><p className="note">{t('optimize.followUp.note')}</p><UseBasis basis={observation.useBasis}/></section>;
}
