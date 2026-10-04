import {accessSync, constants, existsSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {t} from '../locale/index.js';
import {CoreError} from '../errors.js';

/** Resolve only the exact platform dependency declared by the installed npm package. */
export function packagedCore(directory: string): string | undefined {
  const metadataFile = path.join(directory, '../package.json');
  if (!existsSync(metadataFile)) return;
  const metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
  const packages = metadata.wombat?.platformPackages;
  if (!packages) return;
  const target = process.platform + '-' + process.arch;
  const entry = packages[target];
  if (!entry) throw new CoreError('UNSUPPORTED_PLATFORM', t('core.package.unsupported', {target}));
  if (entry.alias !== metadata.name + '-' + target || entry.version !== metadata.version + '-' + target)
    throw new CoreError('CORE_UNAVAILABLE', t('core.package.invalid'));
  let file: string, platform;
  try {
    file = createRequire(metadataFile).resolve(entry.alias + '/package.json');
    // Resolution may retain a cached path after uninstalling a dependency.
    platform = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new CoreError('CORE_UNAVAILABLE', t('core.package.missing', {alias: entry.alias, command: `npm install -g ${metadata.name}@${metadata.version} --include=optional`}));
  }
  if (platform.name !== metadata.name || platform.version !== entry.version ||
      platform.wombat?.target !== target || platform.wombat?.source !== metadata.wombat.source)
    throw new CoreError('CORE_UNAVAILABLE', t('core.package.mismatch'));
  const binary = path.join(path.dirname(file), 'vendor', process.platform === 'win32' ? 'wombat-core.exe' : 'wombat-core');
  try {accessSync(binary, constants.X_OK);} catch {
    throw new CoreError('CORE_UNAVAILABLE', t('core.package.unavailable'));
  }
  return binary;
}
