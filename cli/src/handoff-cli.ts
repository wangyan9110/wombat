import {handoffExitCode} from './exit-codes.js';
import path from 'node:path';
import { allowanceStatus, CoreError, type HandoffRequest } from '@wombat/client';
import { createNodeClient } from '@wombat/client/node';
import { locale, t } from '@wombat/client/locale';
import { terminalText } from './display-text.js';
export function parseHandoffArgs(argv: string[]) {
  const request: HandoffRequest = { action: 'preview', language: locale.getSnapshot().locale }, seen = new Set<string>();
  let json = false, help = false;
  const fail = (value: string): never => { throw new CoreError('INVALID_ARGUMENT', t('cli.config.invalid', { value })); };
  if (argv[0] && !argv[0].startsWith('-')) { const action = argv.shift()!; if (!['preview', 'send'].includes(action)) fail(action); request.action = action as HandoffRequest['action']; }
  for (let i = 0; i < argv.length; i++) {
    const [key, inline] = argv[i].split(/=(.*)/s);
    if (['--help', '-h'].includes(key)) { help = true; continue; }
    if (key === '--json') { if (inline !== undefined || json) fail(key); json = true; continue; }
    if (!['--root', '--project-root', '--project', '--source', '--suggestion', '--read-view', '--decision-revision', '--selection-version','--without-skill','--skill'].includes(key)) fail(key);
    if (seen.has(key) && !['--root', '--project-root', '--suggestion','--skill'].includes(key)) fail(key); seen.add(key);
    if(key==='--without-skill'){if(inline!==undefined||request.withoutSkill)fail(key);request.withoutSkill=true;continue;}
    const value = inline ?? argv[++i]; if (!value || value.startsWith('--')) fail(key);
    switch (key) {
      case '--skill': {const equal=value.indexOf('=');if(equal<1||equal===value.length-1)fail(key);(request.skillSelections??=[]).push({projectId:value.slice(0,equal),path:path.resolve(value.slice(equal+1))});break;}
      case '--root': (request.roots ??= []).push(path.resolve(value)); break;
      case '--project-root': (request.projectRoots ??= []).push(path.resolve(value)); break;
      case '--suggestion': (request.suggestionIds ??= []).push(value); break;
      case '--project': request.project = path.resolve(value); break;
      case '--source': request.sourceInstanceId = value; break;
      case '--read-view': request.readView = value; break;
      case '--decision-revision': request.decisionRevision = value; break;
      case '--selection-version': request.selectionVersion = value; break;
    }
  }
  request.projectRoots ??= [process.cwd()];
  if (!help && request.action === 'send' && !request.selectionVersion) fail('--selection-version');
  return { request, json, help };
}
export async function runHandoffCli(argv: string[]): Promise<number> {
  const { request, json, help } = parseHandoffArgs([...argv]);
  if (help) { process.stdout.write(t('handoff.cliHelp')); return 0; }
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const result = await createNodeClient().handoff!(request, { signal: controller.signal });
    if (json) process.stdout.write(JSON.stringify(result) + '\n');
    else {
      process.stdout.write(t('handoff.note') + '\n');
      for (const p of result.projects) { process.stdout.write(`${terminalText(p.cwd)}\n`); for (const target of p.targets) process.stdout.write(`  ${terminalText(target.path)}\t${target.contentHash}\n`); }
      for (const check of result.allowanceChecks) { const status = allowanceStatus(check.assessment); process.stdout.write(check.projectId + '\t' + t(status === 'blocked' ? 'account.blockedNote' : status === 'low' ? 'account.lowNote' : status === 'available' ? 'account.sendAvailable' : 'account.sendUnknown') + '\n'); }
      for (const d of result.deliveries) process.stdout.write(`${d.projectId}\t${terminalText(d.status)}\t${d.errorCode ?? ''}${d.threadId ? `\ncodex resume ${d.threadId}` : ''}\n`);
      process.stdout.write(`${result.selectionVersion}\n${result.readView}\n${result.decisionRevision}\n`);
    }
    return handoffExitCode(result);
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
