import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { CoreError } from '@wombat/client';
import { createNodeClient } from '@wombat/client/node';
import { locale, t } from '@wombat/client/locale';
import { startWebHost } from '@wombat/web';

export async function runWebCli(argv: string[]): Promise<number> {
  let port = 0, json = false;
  const roots: string[] = [], seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { process.stdout.write(t('cli.web.help')); return 0; }
    const [name, inline] = arg.split(/=(.*)/s);
    if (!['--port', '--root', '--json'].includes(name) || (name !== '--root' && seen.has(name)))
      throw new CoreError('INVALID_ARGUMENT', t('cli.web.invalid', { value: arg }));
    seen.add(name);
    if (name === '--json') {
      if (inline !== undefined) throw new CoreError('INVALID_ARGUMENT', t('cli.web.invalid', { value: arg }));
      json = true; continue;
    }
    const value = inline ?? argv[++i];
    if (!value || value.startsWith('--')) throw new CoreError('INVALID_ARGUMENT', t('cli.web.invalid', { value: arg }));
    if (name === '--root') roots.push(value);
    else {
      if (!/^\d+$/.test(value) || Number(value) > 65535) throw new CoreError('INVALID_ARGUMENT', t('cli.web.invalid', { value }));
      port = Number(value);
    }
  }
  const bundled = new URL('./web/', import.meta.url);
  const assets = existsSync(new URL('index.html', bundled)) ? bundled : new URL('../../dist/web/', import.meta.url);
  const host = await startWebHost({ client: createNodeClient(), assets: fileURLToPath(assets), port, roots: roots.length ? roots : undefined, locale: locale.getSnapshot().locale });
  const stopped = new AbortController();
  const stop = () => stopped.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    process.stdout.write(json ? JSON.stringify({ outputVersion: 1, url: host.url, pid: process.pid }) + '\n' : t('cli.web.started', { url: host.url }) + '\n');
    if (!stopped.signal.aborted) await once(stopped.signal, 'abort');
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); await host.close(); }
  return 0;
}
