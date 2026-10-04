import type { ConfigItem } from '@wombat/client';
import { t } from '@wombat/client/locale';
export const stateLabel = (item: ConfigItem) => ['missing', 'unreadable'].includes(item.configuredState) ? t(item.configuredState === 'missing' ? 'config.missing' : 'config.unreadable') : item.stale ? t('config.stale') : !item.current ? t('config.historical') : item.kind === 'rule' && item.observation === 'loaded_only' ? t('config.ruleLoaded') : item.kind === 'skill' && item.observation === 'used' ? t('config.skillUsed') : item.kind === 'skill' && item.configuredState === 'enabled' ? t('config.skillAvailable') : item.observation === 'unknown' ? t(item.kind === 'rule' ? 'config.ruleLoadUnconfirmed' : 'config.usageUnconfirmed') : t(`config.${item.observation}`);
export function issueText(code: string) {
  switch (code) {
    case 'configUnreadable': case 'configInvalid': case 'resourceLimited': case 'outsideAuthorizedRoot': case 'effectiveConfigUnknown': case 'historyCoverageUnknown': case 'projectNotAuthorized': case 'inventoryCacheUnavailable': return t(`config.issue.${code}`);
    default: return code;
  }
}
export function metadataLabel(status: string) { switch (status) { case 'parsed': return t('config.metadata.parsed'); case 'invalid': return t('config.metadata.invalid'); case 'resourceLimited': return t('config.metadata.resourceLimited'); case 'unsupported': return t('config.metadata.unsupported'); default: return t('webui.unknown'); } }

export function bodyEstimateLabel(status?: string) { switch (status) { case 'estimated': return t('config.estimated'); case 'resourceLimited': return t('config.estimateLimited'); case 'unsupported': return t('config.metadata.unsupported'); case 'invalid': return t('config.metadata.invalid'); default: return t('webui.unknown'); } }

export function measurementLabel(status?: string) { switch (status) { case 'complete': return t('config.complete'); case 'unreadable': return t('config.unreadable'); case 'missing': return t('config.missing'); case 'resourceLimited': return t('config.estimateLimited'); default: return t('webui.unknown'); } }
export function estimateLabel(status?: string) { switch (status) { case 'estimated': return t('config.estimated'); case 'schemaUnavailable': return t('config.schemaUnavailable'); case 'notApplicable': return t('config.notApplicable'); default: return bodyEstimateLabel(status); } }
