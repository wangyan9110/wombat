import { reviewFindingLabel, t } from '@wombat/client/locale';
import type { OptimizeSuggestion } from '@wombat/client';
export function statusLabel(status: string) { switch (status) { case 'verified': return t('optimize.verified'); case 'stillNeedsReview': return t('optimize.stillNeedsReview'); case 'recheckUnavailable': return t('optimize.recheckUnavailable'); default: return t('optimize.pending'); } }
export function reviewStateLabel(suggestion: Pick<OptimizeSuggestion, 'status' | 'decision'>) {
  if (!suggestion.decision) return statusLabel(suggestion.status);
  const decision = t(suggestion.decision.kind === 'keep' ? 'optimize.kept' : 'optimize.inapplicable');
  return suggestion.status === 'pending' ? decision : `${decision} · ${statusLabel(suggestion.status)}`;
}
export const findingLabel = reviewFindingLabel;
