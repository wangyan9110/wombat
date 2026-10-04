import type {AccountRequest,AccountResult} from '@wombat/client';
/** A fixed synthetic observation; no native account or credentials are read. */
export function accountFixture(request:AccountRequest,empty=false):AccountResult {
 const checkedAt='2026-10-04T02:00:00Z';
 const section={status:empty?'unavailable':'available',checkedAt};
 return {outputVersion:1,action:request.action??'read',account:section,allowance:section,activity:section,identity:empty?null:{id:'synthetic-account',kind:'chatgpt',maskedEmail:'demo@example.invalid',plan:'synthetic'},windows:empty?[]:[{id:'synthetic-week',bucketId:'codex',usedPercent:72,durationMinutes:10080,resetsAt:'2099-10-11T02:00:00Z',status:'current'}],buckets:empty?[]:[{id:'codex',status:'current'}],summary:empty?null:{lifetimeTokens:1100,currentStreakDays:1,longestStreakDays:1,peakDailyTokens:1100,longestRunningTurnSeconds:100}};
}
