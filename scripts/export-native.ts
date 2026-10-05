import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { checkedSourceRevision, currentNativeTarget, nativeBinary, nativeNotices, nodeRuntimeBinary, nodeRuntimeNotice, resolveNodeRuntimeLicense, sha256 } from './native-platforms.ts';
import { releaseNodeVersion } from './github-release.ts';
const { values } = parseArgs({ args: process.argv.slice(2).filter(arg => arg !== '--'),
  options: { output: { type: 'string', default: 'dist/native-artifacts' }, 'runtime-license': {type: 'string'} } });
import {checkBuild} from './build-identity.ts';
checkBuild(process.cwd());
const target = currentNativeTarget();
const source = checkedSourceRevision();
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const folder = path.join(values.output!, target);
mkdirSync(path.join(folder, 'licenses'), { recursive: true });
mkdirSync(path.join(folder, 'runtime'), { recursive: true });
const binary = nativeBinary(target);
copyFileSync(path.join('dist', binary), path.join(folder, binary));
if (process.version !== `v${releaseNodeVersion}`) throw new Error(`Release runtime must be Node ${releaseNodeVersion}; found ${process.version}`);
const runtimeBinary = nodeRuntimeBinary(target);
copyFileSync(process.execPath, path.join(folder, 'runtime', runtimeBinary));
if (!target.startsWith('win32-')) chmodSync(path.join(folder, 'runtime', runtimeBinary), 0o755);
for (const [file, destination] of [['licenses/node-dependencies.txt', 'node-dependencies.txt'], ['licenses/rust-dependencies.txt', 'rust-dependencies.txt'], ['docs/dependency-licenses.json', 'inventory.json']])
  copyFileSync(file, path.join(folder, 'licenses', destination));
copyFileSync(resolveNodeRuntimeLicense(values['runtime-license']), path.join(folder, 'licenses', nodeRuntimeNotice));
writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ target, version, source, sha256: sha256(path.join(folder, binary)),
  runtime: {name: 'node', version: releaseNodeVersion, sha256: sha256(path.join(folder, 'runtime', runtimeBinary))},
  notices: Object.fromEntries(nativeNotices.map(file => [file, sha256(path.join(folder,'licenses',file))])) }, null, 2) + '\n');
console.log('Native artifact: ' + folder);
