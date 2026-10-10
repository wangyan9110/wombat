import type { ConfigResult } from '@wombat/client';
import { t } from '@wombat/client/locale';
import { timestamp } from '../components.js';

export function HookRegistry({
  registry,
  itemId,
  timezone,
}: {
  registry: ConfigResult['hookRegistry'];
  itemId: string;
  timezone: string;
}) {
  const rows = registry.contexts.flatMap((c) =>
    c.registrations
      .filter((r) => r.itemId === itemId)
      .map((r) => ({ ...r, project: c.project, complete: c.complete })),
  );
  return (
    <section aria-label={t('config.hookRegistry')}>
      <h3>{t('config.hookRegistry')}</h3>
      <p>{t('config.hookRegistryNote')}</p>
      {!rows.length && <p>{t('config.hookRegistryUnknown')}</p>}
      {registry.checkedAt && (
        <p>{t('config.hookObservedAt', { time: timestamp(registry.checkedAt, timezone) })}</p>
      )}
      {rows.map((r) => (
        <article key={r.project + r.nativeKey}>
          <p className="config-path">
            <code>{r.project}</code>
          </p>
          {r.pluginId && (
            <p className="config-path">{t('config.hookPlugin', { name: r.pluginId })}</p>
          )}
          <p>
            {t(r.enabled ? 'config.hookEnabled' : 'config.hookDisabled')} ·{' '}
            {t(`config.hookTrust.${r.trust}`)}
          </p>
          {!r.complete && <p>{t('config.hookRegistryPartial')}</p>}
        </article>
      ))}
    </section>
  );
}
