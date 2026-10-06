import { reviewFindingLabel, reviewStatusLabel, t } from '@wombat/client/locale';
import type { OptimizeSuggestion } from '@wombat/client';
export { reviewStatusLabel as statusLabel } from '@wombat/client/locale';
export function reviewStateLabel(suggestion: Pick<OptimizeSuggestion, 'status' | 'decision'>) {
  if (!suggestion.decision) return reviewStatusLabel(suggestion.status);
  const decision = t(suggestion.decision.kind === 'keep' ? 'optimize.kept' : 'optimize.inapplicable');
  return suggestion.status === 'pending' ? decision : `${decision} · ${reviewStatusLabel(suggestion.status)}`;
}
export const findingLabel = reviewFindingLabel;
