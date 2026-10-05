import type { reviewPresentation } from '@wombat/client/locale';

type Presentation = ReturnType<typeof reviewPresentation>;
/** Some findings describe existence or targets and have no numerical measurement. */
export function SuggestionMetric({ presentation }: { presentation: Presentation }) {
  if (presentation.metricText == null && presentation.metric == null) return null;
  return <span className="config-metric">{presentation.metricText ?? <><span>{presentation.metric?.toLocaleString()}</span><small>{presentation.label}</small></>}</span>;
}
