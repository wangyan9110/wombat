import {buildSync} from 'esbuild';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const begin = '// BEGIN generated Wombat plugin bootstrap', end = '// END generated Wombat plugin bootstrap';
export function embedBootstrap(installer: string, code: string): string {
  const start = installer.indexOf(begin), finish = installer.indexOf(end);
  if (start < 0 || finish < start || installer.indexOf(begin, start + 1) >= 0 || installer.indexOf(end, finish + 1) >= 0) throw new Error('Installer needs one closed plugin bootstrap region.');
  return installer.slice(0, start + begin.length) + '\n' + code.trimEnd() + '\n' + installer.slice(finish);
}
export function installerBootstrap(root: string): string {
  const built = buildSync({entryPoints: [path.join(root, 'scripts/install-plugin-bootstrap.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node26.4', write: false, minify: true, legalComments: 'inline', metafile: true});
  const packages = new Set<string>();
  for (const file of Object.keys(built.metafile.inputs)) {
    if (!file.includes('node_modules/')) continue;
    let directory = path.dirname(path.resolve(file));
    while (!existsSync(path.join(directory, 'package.json'))) {
      const parent = path.dirname(directory);
      if (parent === directory) throw new Error('Bundled dependency has no metadata: ' + file);
      directory = parent;
    }
    packages.add(directory);
  }
  const notices = [...packages].map(directory => {
    const metadata = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')) as {name: string; version: string; license: string};
    if (metadata.license !== 'MIT' && metadata.license !== 'ISC') throw new Error('Review installer dependency license: ' + metadata.name);
    const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].map(name => path.join(directory, name)).find(existsSync);
    if (!license) throw new Error('Installer dependency notice missing: ' + metadata.name);
    return metadata.name + '@' + metadata.version + '\n' + readFileSync(license, 'utf8');
  }).sort().join('\n');
  return (notices ? '/* Bundled dependency notices\n' + notices.replaceAll('*/', '* /') + '\n*/\n' : '') + built.outputFiles[0].text;
}
export function generateInstallers(root: string, check: boolean): void {
  const code = installerBootstrap(root);
  for (const name of ['install.sh', 'install.ps1']) {
    const file = path.join(root, 'scripts/install', name), current = readFileSync(file, 'utf8'), generated = embedBootstrap(current, code);
    if (check) {if (current !== generated) throw new Error(name + ': generated bootstrap is stale; run pnpm installers:generate');}
    else writeFileSync(file, generated);
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  generateInstallers(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), process.argv.includes('--check'));
  console.log('Installer plugin bootstrap ' + (process.argv.includes('--check') ? 'checked.' : 'generated.'));
}
