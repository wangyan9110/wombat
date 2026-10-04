import type { ConfigItem, ConfigResult, UsageResult } from '../client.js';
import { t } from './index.js';

type Coverage = ConfigResult['coverage'];
/** Only complete observable coverage can turn an absent event into zero. */
export function observedCount(count: number | null | undefined, coverage: Coverage, event: string): number | undefined {
  if (count != null && count > 0) return count;
  return count === 0 && coverage.status === 'complete' && coverage.absenceObservable && coverage.supportedEvidence.includes(event) ? 0 : undefined;
}

/** Recent reads and explicit usage are distinct, even when a file was loaded. */
export function inventoryRecordState(item: ConfigItem, coverage: Coverage): { kind: 'time' | 'absent' | 'unknown'; text?: string; hint?: string } {
  if (item.lastRecordAt && (item.kind === 'rule' || item.observation === 'used')) return { kind: 'time' };
  const reads = item.kind === 'rule';
  const event = reads ? 'file_read' : item.kind === 'skill' ? 'skill_invocation' : item.kind === 'hook' ? 'hook_execution' : 'tool_call';
  const count = observedCount(reads ? item.counts.fileReads : item.usageCount, coverage, event);
  if (count === 0 && item.observation !== 'loaded_only') return { kind: 'absent', text: t(reads ? 'config.noReads' : 'config.noUse'), hint: t(reads ? 'config.noReadsDates' : 'config.noUseDates') };
  return {
    kind: 'unknown',
    text: t(reads ? 'config.ruleLoadUnconfirmed' : 'config.usageUnconfirmed'),
    hint: t(reads ? 'config.ruleLoadHint' : 'config.extensionUsageHint'),
  };
}

/** Source status is a fact, not a generic history-unknown message. */
export function sourceReadLabel(source: UsageResult['quality']['sources'][number]): string {
  switch (source.status) {
    case 'notFound': return t('source.notFound');
    case 'failed': return t('source.unreadable');
    case 'partial': case 'cancelled': return t('source.incomplete');
    case 'unsupported': return t('source.unsupported');
    case 'complete': return t('source.read');
    default: return t('webui.unknown');
  }
}
