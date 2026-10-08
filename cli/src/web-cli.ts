import { once } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import {open as openFile} from 'node:fs/promises';
import type {WebViewRequest} from '@wombat/client';
import path from 'node:path';
import { homedir } from 'node:os';
import { CoreError, validateWebViewRequest } from '@wombat/client';
import { createNodeClient } from '@wombat/client/node';
import { t } from '@wombat/client/locale';
import { startWebHost } from '@wombat/web';
import { explicitLaunchLanguage } from './locale.js';

export async function runWebCli(argv: string[]): Promise<number> {
  let port = 0, json = false, open = false, contextFile:string|undefined;
  const roots: string[] = [], projectRoots: string[] = [], seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { process.stdout.write(t('cli.web.help')); return 0; }
    const [name, inline] = arg.split(/=(.*)/s);
    if (!['--port', '--root', '--project-root', '--json', '--open', '--context'].includes(name) || (!['--root', '--project-root'].includes(name) && seen.has(name)))
      throw new CoreError('INVALID_ARGUMENT', t('cli.web.invalid', { value: arg }));
    seen.add(name);
    if (name === '--json' || name === '--open') {
      if (inline !== undefined) throw new CoreError('INVALID_ARGUMENT', t('cli.web.invalid', { value: arg }));
      if (name === '--json') json = true; else open = true; continue;
    }
    const value = inline ?? argv[++i];
    if (!value || value.startsWith('--')) throw new CoreError('INVALID_ARGUMENT', t('cli.web.invalid', { value: arg }));
    if(name==='--context')contextFile=path.resolve(value);
    else if (name === '--root') roots.push(path.resolve(value));
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
  let browser: ChildProcess | undefined;
  const stopped = new AbortController();
  const stop = () => stopped.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    let view:{url:string;context:WebViewRequest}|undefined;
    if(contextFile){
      const file=await openFile(contextFile,'r');
      let raw:unknown;
      try{
        const info=await file.stat();
        if(!info.isFile()||info.size>65536)throw new CoreError('INVALID_ARGUMENT',t('web.contextInvalid'));
        const buffer=Buffer.alloc(65537);
        let size=0;
        while(size<buffer.length){const {bytesRead}=await file.read(buffer,size,buffer.length-size,null);if(!bytesRead)break;size+=bytesRead;}
        if(size>65536)throw new CoreError('INVALID_ARGUMENT',t('web.contextInvalid'));
        try{raw=JSON.parse(buffer.subarray(0,size).toString('utf8'));}catch{throw new CoreError('INVALID_ARGUMENT',t('web.contextInvalid'));}
      }finally{await file.close();}
      validateWebViewRequest(raw);
      view=await host.openView(raw,{signal:stopped.signal});
    }
    const url=view?.url??host.url;
    process.stdout.write(json ? JSON.stringify({ outputVersion: 1, url, pid: process.pid,...(view?{context:view.context}:{}) }) + '\n' : t('cli.web.started', { url }) + '\n');
    if (open) {
      const program = process.platform === 'darwin' ? '/usr/bin/open' : process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/rundll32.exe') : '/usr/bin/xdg-open';
      browser = spawn(program, process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url], {stdio: 'ignore', windowsHide: true, timeout: 10000});
      browser.once('error', () => process.stderr.write(t('cli.web.openFailed')+'\n'));
      browser.once('exit', code => {if (code && !stopped.signal.aborted) process.stderr.write(t('cli.web.openFailed')+'\n');});
      browser.unref();
    }
    if (!stopped.signal.aborted) await once(stopped.signal, 'abort');
  } finally { if (browser?.exitCode === null) browser.kill(); process.off('SIGINT', stop); process.off('SIGTERM', stop); await host.close(); }
  return 0;
}
