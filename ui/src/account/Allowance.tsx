import { numberLabel } from '@wombat/client/locale';
import type { AccountResult } from '@wombat/client';
import { t } from '@wombat/client/locale';
import { timestamp } from '../components.js';

export function accountStatus(value: string) {
  switch (value) {
    case 'available':
    case 'current':
      return t('account.available');
    case 'partial':
      return t('account.partial');
    case 'stale':
      return t('account.stale');
    case 'signed_out':
      return t('account.signedOut');
    case 'unsupported':
      return t('account.unsupported');
    default:
      return t('account.unavailable');
  }
}
const reported = (value: boolean | null | undefined) =>
  t(value == null ? 'webui.unknown' : value ? 'account.yes' : 'account.no');
function ResetTime({ value, timezone }: { value?: string | null; timezone: string }) {
  if (!value) return null;
  return (
    <>
      <p>{t('account.reset', { time: timestamp(value, timezone) })}</p>
      {Date.parse(value) <= Date.now() && <p className="note">{t('account.resetDue')}</p>}
    </>
  );
}
export function AllowanceWindows({
  data,
  timezone,
  compact = false,
}: {
  data: AccountResult;
  timezone: string;
  compact?: boolean;
}) {
  const windows = compact ? data.windows.slice(0, 2) : data.windows;
  return (
    <>
      <p className="note">
        {accountStatus(data.allowance.status)} ·{' '}
        {data.allowance.checkedAt
          ? timestamp(data.allowance.checkedAt, timezone)
          : t('account.notRead')}{' '}
        {data.allowance.errorCode && <code>{data.allowance.errorCode}</code>}
      </p>
      <div className="allowance-windows">
        {windows.map((w) => (
          <article className="allowance-window" key={w.id}>
            <strong>
              {w.bucketName ?? w.bucketId}
              {w.model && <> · {w.model}</>}
            </strong>
            <p>
              {t('account.remaining', { percent: Math.round((100 - w.usedPercent) * 100) / 100 })}
            </p>
            <meter
              aria-label={w.bucketName ?? w.bucketId}
              min="0"
              max="100"
              value={100 - w.usedPercent}
            />
            {w.durationMinutes != null && (
              <p>{t('account.duration', { count: w.durationMinutes })}</p>
            )}
            <ResetTime value={w.resetsAt} timezone={timezone} />
          </article>
        ))}
      </div>
      {!data.windows.length && <p>{t('account.noWindows')}</p>}
      {compact && data.windows.length > 2 && (
        <p className="note">{t('account.moreWindows', { count: data.windows.length - 2 })}</p>
      )}
    </>
  );
}
export function AllowanceDetails({ data, timezone }: { data: AccountResult; timezone: string }) {
  const reset = data.resetCredits;
  return (
    <>
      <AllowanceWindows data={data} timezone={timezone} />
      {data.buckets
        .filter(
          (b) =>
            b.credits ||
            b.individualLimit ||
            b.spendControlReached != null ||
            b.rateLimitReachedType,
        )
        .map((b) => (
          <article className="allowance-window" key={b.id}>
            <h4>
              {b.name ?? b.id}
              {b.model && <> · {b.model}</>}
            </h4>
            <p className="note">
              {accountStatus(data.allowance.status === 'stale' ? 'stale' : b.status)}
            </p>
            {b.credits && (
              <>
                <h5>{t('account.credits')}</h5>
                <dl className="facts">
                  <dt>{t('account.balance')}</dt>
                  <dd>{b.credits.balance ?? t('webui.unknown')}</dd>
                  <dt>{t('account.hasCredits')}</dt>
                  <dd>{reported(b.credits.hasCredits)}</dd>
                  <dt>{t('account.unlimited')}</dt>
                  <dd>{reported(b.credits.unlimited)}</dd>
                </dl>
              </>
            )}
            {b.individualLimit && (
              <>
                <h5>{t('account.spendLimit')}</h5>
                <dl className="facts">
                  <dt>{t('account.limit')}</dt>
                  <dd>{b.individualLimit.limit ?? t('webui.unknown')}</dd>
                  <dt>{t('account.used')}</dt>
                  <dd>{b.individualLimit.used ?? t('webui.unknown')}</dd>
                </dl>
                <p>
                  {b.individualLimit.remainingPercent == null
                    ? t('webui.unknown')
                    : t('account.remaining', { percent: b.individualLimit.remainingPercent })}
                </p>
                <ResetTime value={b.individualLimit.resetsAt} timezone={timezone} />
              </>
            )}
            {b.spendControlReached != null && (
              <p>{t('account.spendReached', { value: reported(b.spendControlReached) })}</p>
            )}
            {b.rateLimitReachedType && (
              <p>
                {t('account.nativeRestriction')} <code>{b.rateLimitReachedType}</code>
              </p>
            )}
            <p className="note">{t('account.nativeUnits')}</p>
          </article>
        ))}
      {reset && (
        <section className="reset-credits">
          <h4>{t('account.resetCredits')}</h4>
          <p>
            {t('account.resetCount', {
              count:
                reset.availableCount == null
                  ? t('webui.unknown')
                  : numberLabel(reset.availableCount),
            })}
          </p>
          <p className="note">{t('account.resetReadonly')}</p>
          {reset.credits == null ? (
            <p>{t('account.resetDetailsUnknown')}</p>
          ) : reset.credits.length === 0 ? (
            <p>{t('account.resetDetailsEmpty')}</p>
          ) : (
            <ul>
              {reset.credits.map((c) => (
                <li key={c.id}>
                  <strong>{c.title ?? c.id}</strong> ·{' '}
                  {t(
                    c.status === 'available'
                      ? 'account.creditAvailable'
                      : c.status === 'redeeming'
                        ? 'account.creditRedeeming'
                        : c.status === 'redeemed'
                          ? 'account.creditRedeemed'
                          : 'webui.unknown',
                  )}
                  {c.description && <p>{c.description}</p>}
                  {c.grantedAt && (
                    <p>{t('account.granted', { time: timestamp(c.grantedAt, timezone) })}</p>
                  )}
                  {c.expiresAt && (
                    <p>{t('account.expires', { time: timestamp(c.expiresAt, timezone) })}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {reset.detailsTruncated && <p role="status">{t('account.resetTruncated')}</p>}
        </section>
      )}
      <p className="note">
        {t(
          data.ordinaryUsageAllowed == null
            ? 'account.ordinaryUnknown'
            : data.ordinaryUsageAllowed
              ? 'account.ordinaryAllowed'
              : 'account.ordinaryDenied',
        )}
      </p>
    </>
  );
}
