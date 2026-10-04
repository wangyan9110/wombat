import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { checkedSourceRevision, currentNativeTarget, nativeBinary, nativeNotices, sha256 } from './native-platforms.ts';
const { values } = parseArgs({ options: { output: { type: 'string', default: 'dist/native-artifacts' } } });
import {checkBuild} from './build-identity.ts';
checkBuild(process.cwd());
const target = currentNativeTarget();
const source = checkedSourceRevision();
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const folder = path.join(values.output!, target);
mkdirSync(path.join(folder, 'licenses'), { recursive: true });
const binary = nativeBinary(target);
copyFileSync(path.join('dist', binary), path.join(folder, binary));
for (const [file, destination] of [['licenses/node-dependencies.txt', 'node-dependencies.txt'], ['licenses/rust-dependencies.txt', 'rust-dependencies.txt'], ['docs/dependency-licenses.json', 'inventory.json']])
  copyFileSync(file, path.join(folder, 'licenses', destination));
writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ target, version, source, sha256: sha256(path.join(folder, binary)), notices: Object.fromEntries(nativeNotices.map(file => [file, sha256(path.join(folder,'licenses',file))])) }, null, 2) + '\n');
console.log('Native artifact: ' + folder);
