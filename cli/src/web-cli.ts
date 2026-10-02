import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { CoreError } from '@wombat/client';
import { createNodeClient } from '@wombat/client/node';
import { t } from '@wombat/client/locale';
import { startWebHost } from '@wombat/web';
import { explicitLaunchLanguage } from './locale.js';

export async function runWebCli(argv: string[]): Promise<number> {
  let port = 0, json = false;
  const roots: string[] = [], projectRoots: string[] = [], seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { process.stdout.write(t('cli.web.help')); return 0; }
    const [name, inline] = arg.split(/=(.*)/s);
    if (!['--port', '--root', '--project-root', '--json'].includes(name) || (!['--root', '--project-root'].includes(name) && seen.has(name)))
      throw new CoreError('INVALID_ARGUMENT', t('cli.web.invalid', { value: arg }));
    seen.add(name);
    if (name === '--json') {
      if (inline !== undefined) throw new CoreError('INVALID_ARGUMENT', t('cli.web.invalid', { value: arg }));
      json = true; continue;
    }
    const value = inline ?? argv[++i];
    if (!value || value.startsWith('--')) throw new CoreError('INVALID_ARGUMENT', t('cli.web.invalid', { value: arg }));
    if (name === '--root') roots.push(path.resolve(value));
    else if (name === '--project-root') projectRoots.push(path.resolve(value));
    else {
      if (!/^\d+$/.test(value) || Number(value) > 65535) throw new CoreError('INVALID_ARGUMENT', t('cli.web.invalid', { value }));
      port = Number(value);
    }
  }
  const bundled = new URL('./web/', import.meta.url);
  const assets = existsSync(new URL('index.html', bundled)) ? bundled : new URL('../../dist/web/', import.meta.url);
  const sourceRoots=roots.length?roots:[path.resolve(process.env.CODEX_HOME??path.join(homedir(),'.codex'))];
  const projects=projectRoots.length?projectRoots:[process.cwd()];
  const language=explicitLaunchLanguage();
  // Copyable recovery material only. Source data never invokes this command.
  const launch=[process.execPath,...process.execArgv,path.resolve(process.argv[1]),...(language?['--lang',language]:[]),'web',...sourceRoots.flatMap(r=>['--root',r]),...projects.flatMap(r=>['--project-root',r])];
  const quote=(s:string)=>process.platform==='win32'?JSON.stringify(s):"'"+s.replaceAll("'","'\"'\"'")+"'";
  const restartCommand=process.platform==='win32'?undefined:launch.map(quote).join(' ');
  const host = await startWebHost({ client: createNodeClient({automaticPrices:false}), automaticPrices:process.env.WOMBAT_AUTO_PRICES!=='0', assets: fileURLToPath(assets), port, roots:sourceRoots, projectRoots:projects, locale:language,restartCommand });
  const stopped = new AbortController();
  const stop = () => stopped.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    process.stdout.write(json ? JSON.stringify({ outputVersion: 1, url: host.url, pid: process.pid }) + '\n' : t('cli.web.started', { url: host.url }) + '\n');
    if (!stopped.signal.aborted) await once(stopped.signal, 'abort');
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); await host.close(); }
  return 0;
}
