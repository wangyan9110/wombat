import type { ConfigItem, ConfigResult } from '@wombat/client';
import { observedCount, t } from '@wombat/client/locale';
export function InvocationCounts({ counts, coverage }: { counts: ConfigItem['counts']; coverage: ConfigResult['coverage'] }) {
  return <dl className="facts">
    <dt>{t('config.toolCalls')}</dt><dd>{observedCount(counts.toolCalls, coverage, 'tool_call') == null ? t('webui.unknown') : t('config.toolCallsCount', { count: counts.toolCalls })}</dd>
    <dt>{t('config.resourceReads')}</dt><dd>{observedCount(counts.resourceReads, coverage, 'resource_read') == null ? t('webui.unknown') : t('config.resourceReadsCount', { count: counts.resourceReads })}</dd>
  </dl>;
}
export function SourceCounts({ counts, coverage }: { counts: ConfigItem['counts']; coverage: ConfigResult['coverage'] }) {
  const rows = [
    ['fileReads', 'file_read', 'config.reads', 'config.fileReadsCount'],
    ['toolCalls', 'tool_call', 'config.toolCalls', 'config.toolCallsCount'],
    ['resourceReads', 'resource_read', 'config.resourceReads', 'config.resourceReadsCount'],
  ] as const;
  return <>{rows.map(([field, event, label, message], index) => <span key={field}>{index > 0 && ' · '}{observedCount(counts[field], coverage, event) == null ? <>{t(label)}: {t('webui.unknown')}</> : t(message, { count: counts[field] })}</span>)}</>;
}
