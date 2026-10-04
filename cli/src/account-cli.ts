import { CoreError } from '@wombat/client';
import { createNodeClient } from '@wombat/client/node';
import { t } from '@wombat/client/locale';
import { terminalText } from './display-text.js';
export async function runAccountCli(argv: string[]): Promise<number> {
  const seen = new Set<string>();
  for (const arg of argv) {
    if (!['read', 'refresh', '--json', '--help', '-h'].includes(arg) || seen.has(arg)) throw new CoreError('INVALID_ARGUMENT', t('cli.config.invalid', { value: arg }));
    seen.add(arg);
  }
  if (seen.has('read') && seen.has('refresh')) throw new CoreError('INVALID_ARGUMENT', t('cli.config.invalid', { value: 'read refresh' }));
  if (seen.has('--help') || seen.has('-h')) { process.stdout.write(t('account.cliHelp')); return 0; }
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const result = await createNodeClient().account!({ action: seen.has('refresh') ? 'refresh' : 'read' }, { signal: controller.signal });
    if (seen.has('--json')) process.stdout.write(JSON.stringify(result) + '\n');
    else {
      process.stdout.write(`${t('account.title')} · ${terminalText(result.identity?.maskedEmail ?? result.identity?.kind ?? t('webui.unknown'))}\n`);
      for (const part of ['account', 'allowance', 'activity'] as const) process.stdout.write(`${t(`account.${part}`)}\t${terminalText(result[part].status)}\t${result[part].checkedAt ?? '—'}\t${result[part].errorCode ?? ''}\n`);
      for (const w of result.windows) process.stdout.write(`${terminalText(w.bucketName ?? w.bucketId)}\t${terminalText(w.model ?? '—')}\t${t('account.remaining', { percent: 100 - w.usedPercent })}\t${w.durationMinutes == null ? '—' : t('account.duration', { count: w.durationMinutes })}\t${w.resetsAt ?? '—'}\t${w.status}\n`);
      for (const b of result.buckets) {
        if (!b.credits && !b.individualLimit && b.spendControlReached == null && !b.rateLimitReachedType) continue;
        process.stdout.write(terminalText(b.name ?? b.id) + '\t' + b.status + '\n');
        if (b.credits) process.stdout.write(t('account.credits') + '\t' + JSON.stringify(b.credits) + '\n');
        if (b.individualLimit) process.stdout.write(t('account.spendLimit') + '\t' + JSON.stringify(b.individualLimit) + '\n');
        if (b.spendControlReached != null || b.rateLimitReachedType) process.stdout.write(t('account.nativeRestriction') + '\t' + JSON.stringify({ spendControlReached: b.spendControlReached, rateLimitReachedType: b.rateLimitReachedType }) + '\n');
      }
      if (result.resetCredits) process.stdout.write(t('account.resetCredits') + '\t' + JSON.stringify(result.resetCredits) + '\n' + t('account.resetReadonly') + '\n');
      if (result.buckets.some(b => b.credits || b.individualLimit)) process.stdout.write(t('account.nativeUnits') + '\n');
      if (result.summary) process.stdout.write(JSON.stringify(result.summary) + '\n');
      process.stdout.write(t('account.note') + '\n');
    }
    return [result.account, result.allowance, result.activity].some(s => ['unavailable', 'partial', 'stale'].includes(s.status)) ? 2 : 0;
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
