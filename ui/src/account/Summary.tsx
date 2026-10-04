import type { AccountResult } from '@wombat/client';
import { t } from '@wombat/client/locale';
import { useEffect, useState } from 'react';
import { timestamp } from '../components.js';
import type { AccountState } from './useAccount.js';

export type AllowanceSummary =
  | { kind: 'current'; remainingPercent: number; durationMinutes: number; resetsAt: string; low: boolean }
  | { kind: 'multiple' }
  | { kind: 'stale' }
  | { kind: 'unknown'; status: string };

const validPercent = (value: number) => Number.isFinite(value) && value >= 0 && value <= 100;

/** Keep presentation conservative: only one complete, current window can become a headline value. */
export function summarizeAllowance(data: AccountResult, now = Date.now()): AllowanceSummary {
  if (data.allowance.status === 'stale') return { kind: 'stale' };
  // The native `codex` bucket is the only ordinary Codex allowance identity.
  // normalModelSlug is presentation metadata and must not select a substitute bucket.
  const windows = data.windows.filter(window => window.bucketId === 'codex');
  if (windows.length > 1) return { kind: 'multiple' };
  const window = windows[0];
  if (!window) return { kind: 'unknown', status: data.account.status !== 'available' ? data.account.status : data.allowance.status };
  const reset = Date.parse(window.resetsAt ?? '');
  if (window.status !== 'current' || !validPercent(window.usedPercent) || window.durationMinutes == null || !Number.isFinite(window.durationMinutes) || window.durationMinutes <= 0 || !Number.isFinite(reset)) {
    return { kind: 'unknown', status: data.allowance.status };
  }
  if (reset <= now) return { kind: 'stale' };
  const remainingPercent = Math.round((100 - window.usedPercent) * 100) / 100;
  return { kind: 'current', remainingPercent, durationMinutes: window.durationMinutes, resetsAt: window.resetsAt!, low: remainingPercent <= 10 };
}

export function allowanceDuration(minutes: number): string {
  if (minutes % 1440 === 0) return t('account.durationDays', { count: minutes / 1440 });
  if (minutes % 60 === 0) return t('account.durationHours', { count: minutes / 60 });
  return t('account.durationMinutes', { count: minutes });
}

function useSummary(data?: AccountResult) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!data) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [data]);
  return data ? summarizeAllowance(data, now) : undefined;
}

function statusText(state: AccountState, summary?: AllowanceSummary) {
  if (state.busy && !state.data) return t('webui.loading');
  if (state.error && !state.data) return t('account.unavailable');
  if (!summary) return t('account.noInformation');
  if (summary.kind === 'multiple') return t('account.viewAllowances');
  if (summary.kind === 'stale') return t('account.awaitingUpdate');
  if (summary.kind === 'unknown') {
    if (summary.status === 'signed_out') return t('account.signedOut');
    if (summary.status === 'unsupported') return t('account.unsupported');
    return t('account.noInformation');
  }
  return t('account.remaining', { percent: summary.remainingPercent });
}

export function AccountSummaryCard({ state, timezone, open }: { state: AccountState; timezone: string; open: () => void }) {
  const summary = useSummary(state.data);
  const current = summary?.kind === 'current' ? summary : undefined;
  return <button className={`account-summary-card${current?.low ? ' low' : ''}`} onClick={open} aria-label={`${t('account.codexAllowance')} · ${statusText(state, summary)}`}>
    <span className="account-summary-head"><strong>{t('account.codexAllowance')}</strong><small>{t('account.accountWide')}</small></span>
    <span className="account-summary-value">{statusText(state, summary)}</span>
    {current && <><meter min="0" max="100" value={current.remainingPercent} aria-label={t('account.remaining', { percent: current.remainingPercent })} /><span className="account-summary-meta">{allowanceDuration(current.durationMinutes)}</span><span className="account-summary-meta">{t('account.resetShort', { time: timestamp(current.resetsAt, timezone) })}</span></>}
  </button>;
}

export function AccountCompactButton({ state, open }: { state: AccountState; open: () => void }) {
  const summary = useSummary(state.data);
  const label = summary?.kind === 'current' ? t('account.compactRemaining', { percent: summary.remainingPercent }) : t('account.codexAllowance');
  return <button className={`quiet account-compact${summary?.kind === 'current' && summary.low ? ' low' : ''}`} onClick={open}>{label}</button>;
}
