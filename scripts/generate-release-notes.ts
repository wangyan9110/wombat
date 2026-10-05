import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import type {GitHubReleaseSet} from './github-release.ts';
import {nativeTargets} from './native-platforms.ts';
import {previousReleaseTag, readPublishedReleaseTags} from './release-history.ts';
import {repositorySlug} from './release-policy.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
interface ReleaseNotesInput {version: string; summary: string; highlights: string[]; knownLimitations: string[]}

function list(values: string[]): string { return values.map(value => `- ${value}`).join('\n'); }

export function validateReleaseSet(set: GitHubReleaseSet): void {
  if (set.format !== 1 || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(set.version)) throw new Error('Release set has an invalid version');
  if (!/^[0-9a-f]{40}$/.test(set.source) || !/^[0-9a-f]{64}$/.test(set.sourceSha256)) throw new Error('Release set has an invalid source identity');
  const targets = [...set.targets].sort(), expected = [...nativeTargets].sort();
  if (JSON.stringify(targets) !== JSON.stringify(expected)) throw new Error(`Release set must contain exactly: ${expected.join(', ')}`);
  if (set.assets.length !== expected.length || new Set(set.assets.map(asset => asset.target)).size !== expected.length) throw new Error('Release set must contain one archive for each target');
  for (const asset of set.assets) {
    if (asset.archive !== `wombat-${asset.target}.tar.gz` || !/^[0-9a-f]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0)
      throw new Error(`Release asset is invalid: ${asset.target}`);
  }
}

export function renderReleaseNotes(input: ReleaseNotesInput, set: GitHubReleaseSet, repository: string, previousTag?: string): string {
  if (input.version !== set.version || !input.summary.trim() || !input.highlights.length || !input.knownLimitations.length)
    throw new Error('Release notes input is incomplete or does not match the release set');
  validateReleaseSet(set);
  const prerelease = set.version.includes('-');
  const tag = `v${set.version}`;
  const installSuffix = prerelease ? ` | sh -s -- --version ${set.version}` : ' | sh';
  const windowsCommand = prerelease
    ? `& ([scriptblock]::Create((irm https://raw.githubusercontent.com/${repository}/main/install.ps1))) -Version ${set.version}`
    : `& ([scriptblock]::Create((irm https://raw.githubusercontent.com/${repository}/main/install.ps1)))`;
  const update = prerelease ? `wombat update --check --version ${set.version}` : 'wombat update --check\nwombat update';
  const compare = previousTag
    ? `Changes since [${previousTag}](https://github.com/${repository}/releases/tag/${previousTag}): [compare ${previousTag}...${tag}](https://github.com/${repository}/compare/${previousTag}...${tag})`
    : `See the [commit history](https://github.com/${repository}/commits/${tag}).`;
  return `# Wombat ${tag}\n\n${input.summary}\n\n## Highlights\n\n${list(input.highlights)}\n\n## Install or update\n\nmacOS and Linux:\n\n\`\`\`sh\ncurl -fsSL https://raw.githubusercontent.com/${repository}/main/install.sh${installSuffix}\n\`\`\`\n\nWindows PowerShell:\n\n\`\`\`powershell\n${windowsCommand}\n\`\`\`\n\nUpdate an installer-managed copy:\n\n\`\`\`sh\n${update}\n\`\`\`\n\nSupported archives: ${set.targets.join(', ')}.\n\n## Known limitations\n\n${list(input.knownLimitations)}\n\n## Verification and security\n\nAll five archives were built and exercised on their target platforms from commit \`${set.source}\`. Installers and updates verify the published size and SHA-256 digest before switching versions. GitHub provides build provenance attestations for the platform archives. Wombat reads local sources without changing them; network behavior and native handoff follow the documented privacy boundaries.\n\n## Feedback and changes\n\nReport problems in [GitHub Issues](https://github.com/${repository}/issues). Private security reports should follow the [security policy](https://github.com/${repository}/security/policy).\n\n${compare}\n`;
}

export function parseReleaseNotesArgs(argv: string[]): {set: string; output: string} {
  const {values} = parseArgs({args: argv.filter(arg => arg !== '--'),
    options: {set: {type: 'string'}, output: {type: 'string'}}});
  if (!values.set || !values.output) throw new Error('Usage: corepack pnpm release:notes -- --set <release-set.json> --output <notes.md>');
  return {set: values.set, output: values.output};
}

function main(): void {
  const values = parseReleaseNotesArgs(process.argv.slice(2));
  const set = JSON.parse(readFileSync(path.resolve(values.set), 'utf8')) as GitHubReleaseSet;
  const input = JSON.parse(readFileSync(path.join(root, 'scripts/release-notes', `${set.version}.json`), 'utf8')) as ReleaseNotesInput;
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {repository: string | {url: string}};
  const repository = repositorySlug(typeof pkg.repository === 'string' ? pkg.repository : pkg.repository.url);
  const tags = readPublishedReleaseTags(repository);
  const notes = renderReleaseNotes(input, set, repository, previousReleaseTag(tags, set.version));
  if (/\b(?:TODO|TBD|NEXT_PREVIEW_VERSION)\b/.test(notes)) throw new Error('Generated release notes contain an unresolved placeholder');
  writeFileSync(path.resolve(values.output), notes);
  console.log(`Generated English release notes for v${set.version}: ${path.resolve(values.output)}`);
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (entry === import.meta.url) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exit(1); }
}
