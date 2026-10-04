import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { builtFiles, checkBuild } from './build-identity.ts';
import { hashFile, inventory } from './artifact-files.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Install a self-contained local skill, leaving unrelated skills and Codex settings alone. */
export function installCodexSkill(skillsRoot: string, replace = false): string {
  checkBuild(root);
  const destination = path.join(path.resolve(skillsRoot), 'wombat');
  if (existsSync(destination)) {
    const marker = path.join(destination, 'installation.json');
    if (!replace || !existsSync(marker) || JSON.parse(readFileSync(marker, 'utf8')).owner !== 'wombat-codex-skill')
      throw new Error('Skill already exists; --replace only replaces a Wombat-managed installation');
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  const staging = mkdtempSync(path.join(path.dirname(destination), '.wombat-install-'));
  const next = path.join(staging, 'next'), previous = path.join(staging, 'previous');
  let preserve = false;
  try {
    cpSync(path.join(root, 'integrations/codex/skills/wombat'), next, { recursive: true });
    const runtime = path.join(next, 'runtime');
    mkdirSync(runtime);
    for (const file of builtFiles(root)) {
      const output = path.join(runtime, file.path);
      mkdirSync(path.dirname(output), { recursive: true });
      copyFileSync(path.join(root, 'dist', file.path), output);
      if (hashFile(output) !== file.sha256) throw new Error('Runtime copy mismatch: ' + file.path);
    }
    for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) copyFileSync(path.join(root, file), path.join(next, file));
    writeFileSync(path.join(next, 'package.json'), JSON.stringify({ private: true, type: 'module', engines: { node: '>=22' } }) + '\n');
    const probe = spawnSync(process.execPath, [path.join(runtime, 'wombat.js'), '--help', '--json'], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
    if (probe.error || probe.status !== 0 || !JSON.parse(probe.stdout).commands.includes('optimize'))
      throw new Error('Installed CLI probe failed');
    checkBuild(root);
    const metadata = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    writeFileSync(path.join(next, 'installation.json'), JSON.stringify({
      format: 1, owner: 'wombat-codex-skill', version: metadata.version,
      target: process.platform + '-' + process.arch, installedAt: new Date().toISOString(),
      build: JSON.parse(readFileSync(path.join(root, 'dist/build.json'), 'utf8')), files: inventory(next),
    }, null, 2) + '\n');
    if (existsSync(destination)) renameSync(destination, previous);
    try { renameSync(next, destination); }
    catch (error) {
      if (existsSync(previous)) {
        try { renameSync(previous, destination); }
        catch (restoreError) {
          preserve = true;
          throw new AggregateError([error, restoreError], `Restore failed; previous skill retained at ${previous}`);
        }
      }
      throw error;
    }
    return destination;
  } finally { if (!preserve) rmSync(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ args: process.argv.slice(2).filter(arg => arg !== '--'), options: {
    'skills-root': { type: 'string', default: path.join(os.homedir(), '.agents/skills') },
    replace: { type: 'boolean', default: false },
  } });
  console.log(`Installed $wombat: ${installCodexSkill(values['skills-root']!, values.replace)}\nInvoke $wombat in Codex; restart if it is not discovered.`);
}
