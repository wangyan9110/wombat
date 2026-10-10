import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { CoreError } from '@wombat/client';
import { OUTPUT_LIMIT } from './limits.js';

export async function loadAssets(
  directory: string,
): Promise<Map<string, { body: Buffer; type: string }>> {
  const assets = new Map<string, { body: Buffer; type: string }>();
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
  };
  async function walk(relative = ''): Promise<void> {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(name);
      else if (
        types[path.extname(name)] &&
        (await lstat(path.join(directory, name))).size <= OUTPUT_LIMIT
      )
        assets.set('/' + name.split(path.sep).join('/'), {
          body: await readFile(path.join(directory, name)),
          type: types[path.extname(name)],
        });
    }
  }
  await walk();
  if (!assets.has('/index.html'))
    throw new CoreError('WEB_ASSETS_MISSING', 'Web assets missing; run the complete build');
  return assets;
}
