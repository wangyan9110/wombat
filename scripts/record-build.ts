import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {builtFiles, sourceIdentity} from './build-identity.ts';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
writeFileSync(path.join(root, 'dist/build.json'), JSON.stringify({format: 1, target: process.platform+'-'+process.arch, sourceSha256: sourceIdentity(root), files: builtFiles(root)}, null, 2)+'\n');
