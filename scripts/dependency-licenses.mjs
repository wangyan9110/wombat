// Local metadata only: no installs, dependency upgrades, or network requests.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const hash = data => createHash('sha256').update(data).digest('hex');
const read = file => readFileSync(file, 'utf8');
function run(program, args) {
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${program} metadata failed: ${result.error?.message || result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}
function textFiles(folder) {
  return readdirSync(folder, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^(LICENSE|LICENCE|COPYING|NOTICE|COPYRIGHT|AUTHORS|PATENTS)(?:$|[._-])/i.test(entry.name))
    .map(entry => path.join(folder, entry.name)).sort();
}
function texts(files, selected) {
  // For dual-licensed crates use the offered MIT alternative, retaining additional notices.
  if (selected.startsWith('MIT') && files.some(file => /LICENSE[-_]MIT$/i.test(file))) {
    files = files.filter(file => !/LICENSE[-_]APACHE$/i.test(file));
  }
  if (!files.length) throw new Error('Dependency license text is missing');
  return files.map(file => ({ name: path.basename(file), sha256: hash(readFileSync(file)), text: read(file).trimEnd() }));
}

if (check) {
  const recorded = JSON.parse(read(path.join(root, 'docs/dependency-licenses.json'))).generationPlatform;
  if (recorded && (recorded.os !== process.platform || recorded.arch !== process.arch)) {
    throw new Error(`Inventory was generated for ${recorded.os}/${recorded.arch}; review target-platform optional packages separately before regeneration`);
  }
}
const runtimeKeys = new Set();
const installed = new Map();
const absentOptional = new Map();
// Recursive listing includes the workspace root and every importer. Without a
// workspace file pnpm recursively discovers unrelated package folders and emits
// separate JSON documents, so retain the single-project form in that case.
const workspaceArgs = existsSync(path.join(root, 'pnpm-workspace.yaml')) ? ['--recursive'] : [];
const projects = run('corepack', ['pnpm', 'list', ...workspaceArgs, '--depth', '-1', '--json']);
const privateWorkspacePaths = new Set(projects.filter(project => project.private).map(project => realpathSync(project.path)));
function visit(value, runtime, optionalNames = new Set()) {
  if (Array.isArray(value)) return value.forEach(item => visit(item, runtime));
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, dependency] of Object.entries(value[group] || {})) {
      const folder = path.resolve(dependency.path);
      const manifest = path.join(folder, 'package.json');
      if (!existsSync(manifest)) {
        if (group !== 'optionalDependencies' && !optionalNames.has(name)) throw new Error(`Required dependency missing: ${name}`);
        absentOptional.set(`${name}@${dependency.version}`, { name, version: dependency.version });
      } else {
        const metadata = JSON.parse(read(manifest));
        const key = `${metadata.name}@${metadata.version}`;
        // First-party workspace packages are traversed, but are not third-party
        // dependencies. Identify them by their resolved directory, not a name
        // prefix that could accidentally hide an external package.
        if (!privateWorkspacePaths.has(realpathSync(folder))) {
          if (runtime) runtimeKeys.add(key);
          if (!installed.has(key)) installed.set(key, { folder, metadata });
        }
      }
      const parent = existsSync(manifest) ? JSON.parse(read(manifest)) : {};
      visit(dependency, runtime, new Set(Object.keys(parent.optionalDependencies || {})));
    }
  }
}
visit(run('corepack', ['pnpm', 'list', ...workspaceArgs, '--prod', '--depth', 'Infinity', '--json']), true);
visit(run('corepack', ['pnpm', 'list', ...workspaceArgs, '--depth', 'Infinity', '--json']), false);
const binaryParents = {
  '@esbuild/': 'esbuild',
  '@rollup/rollup-': 'rollup',
  '@opentui/core-': '@opentui/core',
};
const nodeEntries = [];
const nodeSections = [];
for (const [key, { folder, metadata }] of [...installed].sort(([a], [b]) => a.localeCompare(b))) {
  let files = textFiles(folder);
  let licenseSource = 'installed package';
  if (!files.length) {
    const supplement = path.join(root, 'licenses/upstream/xterm-headless-5.5.0');
    if (key === '@xterm/headless@5.5.0') {
      const provenance = JSON.parse(read(path.join(supplement, 'provenance.json')));
      const notice = path.join(supplement, 'LICENSE');
      if (provenance.package !== metadata.name || provenance.version !== metadata.version || provenance.sha256 !== hash(readFileSync(notice))) throw new Error(`Pinned license mismatch: ${key}`);
      files = [notice];
      licenseSource = provenance.source;
    } else {
      const parentName = Object.entries(binaryParents).find(([prefix]) => metadata.name.startsWith(prefix))?.[1];
      const parent = [...installed.values()].find(item => item.metadata.name === parentName && item.metadata.version === metadata.version);
      if (!parent) throw new Error(`No license attribution for binary package ${key}`);
      files = textFiles(parent.folder);
      licenseSource = `same-version ${parentName} package`;
    }
  }
  if (typeof metadata.license !== 'string') throw new Error(`License needs review: ${key}`);
  const licenseTexts = texts(files, metadata.license);
  nodeEntries.push({ name: metadata.name, version: metadata.version, license: metadata.license, role: runtimeKeys.has(key) ? 'runtime' : 'development', licenseSource, files: licenseTexts.map(({ text, ...item }) => item) });
  nodeSections.push(`## ${key}\nDeclared license: ${metadata.license}\nNotice source: ${licenseSource}\n\n` + licenseTexts.map(item => `### ${item.name}\n\n${item.text}\n`).join('\n'));
}

const executable = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const localCargo = path.join(os.homedir(), '.cargo', 'bin', executable);
const cargo = process.env.WOMBAT_CARGO || (existsSync(localCargo) ? localCargo : executable);
const rustMetadata = run(cargo, ['metadata', '--locked', '--offline', '--manifest-path', 'core/Cargo.toml', '--format-version', '1']);
// Cargo.lock also retains optional dependencies that are not enabled in this build.
// Preserve notices conservatively for every lock entry and annotate the enabled
// normal/build/dev graph across target conditions; never invent missing license texts.
const treeResult = spawnSync(cargo, ['tree', '--locked', '--offline', '--manifest-path', 'core/Cargo.toml', '--target', 'all', '-e', 'normal,build,dev', '--prefix', 'none', '--format', '{p}'], { cwd: root, encoding: 'utf8', timeout: 60000 });
if (treeResult.error || treeResult.status !== 0) throw new Error(`Cargo dependency graph failed: ${treeResult.stderr}`);
const enabledRust = new Set(treeResult.stdout.split('\n').map(row => row.match(/^(\S+) v(\S+)/)).filter(Boolean).map(match => `${match[1]}@${match[2]}`));
const inactiveRust = rustMetadata.packages.filter(item => item.name !== 'wombat-core' && !enabledRust.has(`${item.name}@${item.version}`)).map(item => ({name:item.name,version:item.version,declaredLicense:item.license,repository:item.repository,status:'locked_optional_not_enabled',noticeVerified:true}));
const rustEntries = [];
const rustSections = [];
for (const metadata of rustMetadata.packages.filter(item => item.name !== 'wombat-core').sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))) {
  const folder = path.dirname(metadata.manifest_path);
  let files = textFiles(folder);
  let declared = metadata.license;
  let licenseSource = 'locked crate package';
  if (!files.length && existsSync(path.join(root, `licenses/upstream/${metadata.name}-${metadata.version}/provenance.json`))) {
    const supplement = path.join(root, `licenses/upstream/${metadata.name}-${metadata.version}`);
    const provenance = JSON.parse(read(path.join(supplement, 'provenance.json')));
    for (const entry of provenance.files) {
      if (hash(readFileSync(path.join(supplement, entry.file))) !== entry.sha256) throw new Error('Pinned supplemental license hash mismatch');
    }
    files = textFiles(supplement);
    licenseSource = `recorded upstream revision ${provenance.sourceRevision}`;
  }
  if (!declared) throw new Error(`License needs review: ${metadata.name}`);
  const selected = declared.includes('MIT') ? (declared.includes('AND Unicode-3.0') ? 'MIT AND Unicode-3.0' : 'MIT') : declared;
  if (!files.length) throw new Error(`Dependency license text is missing: ${metadata.name}@${metadata.version} (${folder})`);
  const licenseTexts = texts(files, selected);
  rustEntries.push({ name: metadata.name, version: metadata.version, license: declared, selectedLicense: selected, licenseSource, enabledInBuild: enabledRust.has(`${metadata.name}@${metadata.version}`), files: licenseTexts.map(({ text, ...item }) => item) });
  rustSections.push(`## ${metadata.name}@${metadata.version}\nDeclared license: ${declared}\nSelected alternative: ${selected}\nNotice source: ${licenseSource}\n\n` + licenseTexts.map(item => `### ${item.name}\n\n${item.text}\n`).join('\n'));
}

const inventory = {
  inventoryVersion: 1,
  generationPlatform: { os: process.platform, arch: process.arch },
  scope: 'All locked Rust packages with notices, annotated by the enabled normal/build/dev graph across target conditions; disabled optional packages are not compiled into this build. Locally installed Node dependency graphs cover the root and every workspace importer, including development dependencies; first-party private workspace packages are excluded from third-party notices. Optional Node binaries absent on this host are listed separately. This is not cross-platform installation verification.',
  lockfiles: {
    'pnpm-lock.yaml': hash(readFileSync(path.join(root, 'pnpm-lock.yaml'))),
    'core/Cargo.lock': hash(readFileSync(path.join(root, 'core/Cargo.lock'))),
  },
  node: nodeEntries,
  rust: rustEntries,
  inactiveLockedRustPackages: inactiveRust,
  uninstalledOptionalNodePackages: [...absentOptional.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)),
};
const summary = `# Third-party notices\n\nWombat's original code is licensed under [MIT](LICENSE). Third-party components retain their original licenses; the root license does not relicense them.\n\n- Node dependency notices: [license texts](licenses/node-dependencies.txt).\n- Rust dependency notices: [license texts](licenses/rust-dependencies.txt).\n- Versions, declared licenses, selected alternatives and notice hashes: [inventory](docs/dependency-licenses.json).\n\nThe inventory covers ${nodeEntries.length} installed Node packages (${nodeEntries.filter(item => item.role === 'runtime').length} runtime) and ${rustEntries.length} locked Rust packages other than Wombat. Enabled normal/build/dev dependencies are identified separately; optional lock entries not activated by current features are not compiled into this build, but their upstream license notices are still preserved. Node optional platform packages not installed here are recorded as unverified; their presence is not a platform support claim. Development dependencies are included conservatively.\n\nFor Rust dual-licensed packages, Wombat uses the offered MIT alternative where available, retaining additional required notices, including Unicode-3.0. The alternative LGPL license offered by r-efi is not selected. Its AUTHORS file is preserved. Binary Node packages without their own license text retain the same-version upstream package notice. Crates that omit license texts retain supplemental notices from recorded upstream revisions, with fixed hashes.\n\nDependency updates require a license review and regeneration. Run \`corepack pnpm licenses:generate\`, then \`corepack pnpm licenses:check\`. Both read local metadata only; an incomplete dependency cache fails explicitly. No dependency installation, upgrade, or network download is performed by these commands.\n\nThis inventory records source declarations and notices, not a legal warranty or verification of all platform binaries.\n`;
const outputs = new Map([
  ['docs/dependency-licenses.json', JSON.stringify(inventory, null, 2) + '\n'],
  ['licenses/node-dependencies.txt', '# Node dependency license texts\n\n' + nodeSections.join('\n')],
  ['licenses/rust-dependencies.txt', '# Rust dependency license texts\n\n' + rustSections.join('\n')],
  ['THIRD_PARTY_NOTICES.md', summary],
]);
for (const [relative, content] of outputs) {
  const target = path.join(root, relative);
  if (check) {
    if (!existsSync(target) || read(target) !== content) throw new Error(`License inventory drift: ${relative}; regenerate after reviewing dependency changes`);
  } else {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}
console.log(`Dependency notices ${check ? 'checked' : 'generated'}: ${nodeEntries.length} Node packages, ${rustEntries.length} Rust packages; no dependency changes.`);
