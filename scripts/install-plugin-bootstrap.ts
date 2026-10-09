/** Shared installer stage. Codex owns plugin state; this never enables or trusts Hooks. */
import {lstatSync, readFileSync, mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {runBoundedCommand, stdoutFromLog} from './verify-e2e-helpers.ts';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function catalog(directory: string): void {
  const file = path.join(directory, '.agents/plugins/marketplace.json'), info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) throw new Error('Invalid bundled plugin marketplace.');
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!object(value) || value.name !== 'wombat-local' || !Array.isArray(value.plugins)) throw new Error('Invalid bundled plugin marketplace.');
  const plugins = value.plugins;
  if (!['wombat', 'wombat-collection'].every(name => plugins.some((plugin: unknown) => object(plugin) && plugin.name === name && object(plugin.source) && plugin.source.source === 'local' && plugin.source.path === (name === 'wombat' ? './plugin' : './collection-plugin')))) throw new Error('Invalid bundled plugin marketplace.');
}
export async function installBundledPlugin(marketplace: string, options: {binary?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; signal?: AbortSignal} = {}): Promise<'wombat' | 'wombat-collection'> {
  const directory = path.resolve(marketplace);
  catalog(directory);
  const env = options.env ?? process.env, binary = options.binary ?? env.WOMBAT_CODEX_BIN ?? 'codex';
  const prefix = /\.[cm]?js$/.test(binary) ? [process.execPath, binary] : [binary];
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'wombat-plugin-install-'));
  const controller = new AbortController(), abort = () => controller.abort();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    const run = async (stage: string, args: string[]) => {
      const log = path.join(temporary, stage + '.log');
      const result = await runBoundedCommand({command: [...prefix, ...args], cwd: process.cwd(), env, logFile: log, timeoutMs: options.timeoutMs ?? 20000, maxBytes: 1024 * 1024, signal});
      if (result.exitCode !== 0 || result.timedOut || result.outputLimit || result.interrupted || result.closeTimedOut || result.spawnError || result.logError) throw new Error(`Codex plugin ${stage} failed. Wombat is installed; install or check Codex, then rerun the installer with the plugin option.`);
      return stdoutFromLog(readFileSync(log, 'utf8'));
    };
    const installed: unknown = JSON.parse(await run('list', ['plugin', 'list', '--marketplace', 'wombat-local', '--json']));
    if (!object(installed) || !Array.isArray(installed.installed)) throw new Error('Unrecognized Codex plugin list. Wombat is installed.');
    const active = installed.installed.filter((entry: unknown) => object(entry) && entry.enabled === true && typeof entry.pluginId === 'string' && ['wombat@wombat-local', 'wombat-collection@wombat-local'].includes(entry.pluginId));
    if (active.length > 1) throw new Error('Multiple Wombat plugins are enabled. Choose one in Codex, then rerun the installer.');
    const name = active.some((entry: unknown) => object(entry) && entry.pluginId === 'wombat-collection@wombat-local') ? 'wombat-collection' : 'wombat';
    const marketplaces: unknown = JSON.parse(await run('catalogs', ['plugin', 'marketplace', 'list', '--json']));
    if (!object(marketplaces) || !Array.isArray(marketplaces.marketplaces)) throw new Error('Unrecognized Codex marketplace list. Wombat is installed.');
    const previous = marketplaces.marketplaces.find((entry: unknown) => object(entry) && entry.name === 'wombat-local');
    let previousSource: string | undefined;
    if (previous !== undefined) {
      if (!object(previous) || !object(previous.marketplaceSource) || previous.marketplaceSource.sourceType !== 'local' || typeof previous.marketplaceSource.source !== 'string') throw new Error('Existing wombat-local marketplace is not local. Choose its source in Codex before retrying.');
      if (path.resolve(previous.marketplaceSource.source) !== directory) {
        previousSource = previous.marketplaceSource.source;
        await run('unregister', ['plugin', 'marketplace', 'remove', 'wombat-local']);
      }
    }
    let registered = false;
    try {
      await run('marketplace', ['plugin', 'marketplace', 'add', directory]);
      registered = true;
      const result: unknown = JSON.parse(await run('install', ['plugin', 'add', name + '@wombat-local', '--json']));
      if (!object(result) || result.pluginId !== name + '@wombat-local' || typeof result.installedPath !== 'string' || !path.isAbsolute(result.installedPath)) throw new Error('Unrecognized Codex plugin installation result. Check the plugin in Codex.');
    } catch (error) {
      if (previousSource && !signal.aborted) {
        try {
          if (registered) await run('restore-remove', ['plugin', 'marketplace', 'remove', 'wombat-local']);
          await run('restore', ['plugin', 'marketplace', 'add', previousSource]);
        } catch {
          throw new Error('Plugin installation and marketplace recovery failed. Wombat is installed; restore wombat-local in Codex and rerun the installer.');
        }
      }
      throw error;
    }
    return name;
  } finally {
    process.off('SIGINT', abort); process.off('SIGTERM', abort);
    rmSync(temporary, {recursive: true, force: true});
  }
}
if (process.argv[1] === '-' || path.basename(process.argv[1] ?? '') === 'install-plugin-bootstrap.ts') {
  const marketplace = process.argv[2];
  if (!marketplace || process.argv.length !== 3) {console.error('A bundled plugin marketplace path is required.'); process.exitCode = 2;}
  else void installBundledPlugin(marketplace).then(name => console.log(`Installed ${name} through Codex. Start a new Codex conversation to use the plugin.`), error => {console.error(error instanceof Error ? error.message : 'Plugin installation failed. Wombat is installed.'); process.exitCode = 1;});
}
