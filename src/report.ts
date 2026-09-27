import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScanSnapshot } from './contracts.js';
import { atomicWrite, dataHome } from './storage.js';

function rootDir() { return path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); }

export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => ({
    '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029',
  })[character] || character);
}

export async function writeReport(snapshot: ScanSnapshot, out?: string): Promise<string> {
  const reportDir = path.join(rootDir(), 'dist', 'report');
  const index = await fs.readFile(path.join(reportDir, 'index.html'), 'utf8');
  const jsMatch = index.match(/<script[^>]+src="([^"]+\.js)"[^>]*><\/script>/);
  const cssMatch = index.match(/<link[^>]+href="([^"]+\.css)"[^>]*>/);
  if (!jsMatch) throw new Error('报告前端未构建，请先运行 pnpm build');
  const js = await fs.readFile(path.join(reportDir, jsMatch[1].replace(/^\.\//, '')), 'utf8');
  const css = cssMatch ? await fs.readFile(path.join(reportDir, cssMatch[1].replace(/^\.\//, '')), 'utf8') : '';
  const html = index
    .replace(/<script[^>]+src="[^"]+\.js"[^>]*><\/script>/, () => `<script>window.__WOMBAT_SNAPSHOT__=${safeJson(snapshot)};<\/script><script type="module">${js.replaceAll('</script', '<\\/script')}</script>`)
    .replace(/<link[^>]+href="[^"]+\.css"[^>]*>/, () => `<style>${css.replaceAll('</style', '<\\/style')}</style>`)
    .replace('</head>', `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"></head>`);
  const target = path.resolve(out ?? path.join(dataHome(), 'reports', `${snapshot.snapshotId}.html`));
  await atomicWrite(target, html);
  return target;
}
