import {useState} from 'react';
import { t } from '@wombat/client/locale';
import { Modal, timestamp } from './components.js';
import { QueryError } from './Feedback.js';
import { accountStatus, AllowanceDetails } from './account/Allowance.js';
import type { AccountState } from './account/useAccount.js';
import './account.css';
/** Account reads never depend on project scans, prices or the selected scope. */
export function AccountPanel({ state, timezone, onClose }: { state: AccountState; timezone: string; onClose: () => void }) {
  const { data, busy, error, refresh } = state;
  const [historyOpen,setHistoryOpen]=useState(false);
  return <Modal title={t('account.codexAllowance')} onClose={onClose}><div className="account-panel">
    <p>{t('account.note')}</p><div className="controls"><button disabled={busy} onClick={refresh}>{t('account.refresh')}</button></div>
    {busy && <p role="status">{t('webui.loading')}</p>}{error && <QueryError error={error.message} code={error.code} retry={refresh} />}
    {data?.historyErrorCode&&<p role="alert">{t('account.historyStorageError',{code:data.historyErrorCode})}</p>}
    <details onToggle={e=>{setHistoryOpen(e.currentTarget.open);if(e.currentTarget.open)state.readHistory();}}><summary>{t('account.history')}</summary>{historyOpen&&<><p className="note">{t('account.historyNote')}</p>{state.historyBusy&&<p role="status">{t('webui.loading')}</p>}{state.historyError&&<QueryError error={state.historyError.message} code={state.historyError.code} retry={state.readHistory}/>}<button className="link" disabled={state.historyBusy} onClick={state.readHistory}>{t('account.refresh')}</button>{state.history?.history?.observations.map(o=><article key={o.id}><h4>{timestamp(o.observedAt,timezone)} · {accountStatus(o.status)}</h4>{o.windows.map(w=><p key={w.bucketId+':'+w.id}>{w.bucketId} · {w.id}: {w.usedPercent}% · {w.deltaPercentagePoints==null?t(`account.interval.${w.intervalStatus}`):t('account.percentagePoints',{value:w.deltaPercentagePoints})}</p>)}</article>)}</>}</details>
    {data && <><section><h3>{t('account.account')}</h3><p>{data.identity?.maskedEmail ?? data.identity?.kind ?? accountStatus(data.account.status)}{data.identity?.plan && <> · {data.identity.plan}</>}</p><p className="note">{accountStatus(data.account.status)} · {data.account.checkedAt ? timestamp(data.account.checkedAt, timezone) : t('account.notRead')} {data.account.errorCode && <code>{data.account.errorCode}</code>}</p></section>
      <section><h3>{t('account.allowance')}</h3><AllowanceDetails data={data} timezone={timezone} /></section>
      <section><h3>{t('account.activity')}</h3><p className="note">{accountStatus(data.activity.status)} · {data.activity.checkedAt ? timestamp(data.activity.checkedAt, timezone) : t('account.notRead')} {data.activity.errorCode && <code>{data.activity.errorCode}</code>}</p><dl className="facts">{(['lifetimeTokens', 'currentStreakDays', 'longestStreakDays', 'peakDailyTokens', 'longestRunningTurnSeconds'] as const).map(key => <div className="account-fact" key={key}><dt>{t(`account.${key}`)}</dt><dd>{data.summary?.[key]?.toLocaleString() ?? t('webui.unknown')}</dd></div>)}</dl></section></>}
  </div></Modal>;
}
