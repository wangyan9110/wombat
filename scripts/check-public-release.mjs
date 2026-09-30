// Read-only guards for public source and package contents, not a publication command.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const issues = [];
function run(program, args) {
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${program} check failed: ${result.error?.message || result.stderr.trim()}`);
  return result.stdout;
}
const git = args => run('git', args);
const read = file => readFileSync(path.join(root, file), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const privatePath = /^(?:internal\/|docs\/(?:planning|design|reviews)\/|docs\/benchmarks\/(?:.*real-smoke-|machine-install-selftest-|rust-kernel-2026-09-28))/;
const homePath = new RegExp('/' + '(?:Users|home)/[A-Za-z0-9_.-]+/');
const credentials = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  new RegExp('(?:sk|ghp|github_pat)' + '[-_][A-Za-z0-9_]{32,}'),
  new RegExp('eyJ[A-Za-z0-9_-]{24,}' + '\\.[A-Za-z0-9_-]{24,}\\.[A-Za-z0-9_-]{24,}'),
];
function inspect(relative, content, scope) {
  if (privatePath.test(relative)) issues.push(`${scope}: private path ${relative}`);
  if (homePath.test(content)) issues.push(`${scope}: personal home path in ${relative}`);
  if (credentials.some(pattern => pattern.test(content))) issues.push(`${scope}: credential-shaped text in ${relative}`);
}
const files = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))]
  .filter(file => existsSync(path.join(root, file)));
for (const file of files) {
  const content = readFileSync(path.join(root, file));
  if (!content.includes(0)) inspect(file, content.toString('utf8'), 'working tree');
  else if (privatePath.test(file)) issues.push(`working tree: private path ${file}`);
}
const markdown = files.filter(file => file.endsWith('.md') && !file.startsWith('core/vendor/'));
let checkedLinks = 0;
for (const file of markdown) {
  for (const match of read(file).matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, '').replace(/\s+"[^"]*"$/, '');
    if (/^(?:[a-z]+:|#|\/)/i.test(target)) continue;
    target = decodeURIComponent(target.split('#')[0]);
    if (!target) continue;
    const resolved = path.resolve(root, path.dirname(file), target);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) issues.push(`link outside public repository: ${file}`);
    else if (!existsSync(resolved)) issues.push(`missing link: ${file} -> ${target}`);
    checkedLinks++;
  }
}
const pkg = JSON.parse(read('package.json'));
if (pkg.license !== 'MIT' || !read('LICENSE').includes('Permission is hereby granted')) issues.push('root MIT license missing');
if (!/^license = "MIT"$/m.test(read('core/Cargo.toml'))) issues.push('core license metadata missing');
const inventory = JSON.parse(read('docs/dependency-licenses.json'));
for (const [file, digest] of Object.entries(inventory.lockfiles)) {
  if (hash(readFileSync(path.join(root, file))) !== digest) issues.push(`license inventory lock mismatch: ${file}`);
}
for (const required of ['THIRD_PARTY_NOTICES.md', 'licenses/node-dependencies.txt', 'licenses/rust-dependencies.txt']) {
  if (!existsSync(path.join(root, required))) issues.push(`required notice missing: ${required}`);
}
// App-local checkpoints are not publication branches and must not be mirrored.
const publicRefs = git(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/tags', 'refs/remotes']).trim().split('\n').filter(Boolean);
const commits = publicRefs.length ? git(['rev-list', ...publicRefs]).trim().split('\n').filter(Boolean) : [];
const blobs = new Map();
for (const commit of commits) {
  for (const row of git(['ls-tree', '-rz', '--full-tree', commit]).split('\0').filter(Boolean)) {
    const [meta, file] = row.split('\t');
    if (privatePath.test(file)) issues.push(`history ${commit.slice(0, 8)}: private path ${file}`);
    if (meta.includes(' blob ')) blobs.set(meta.split(' ')[2], file);
  }
}
for (const [oid, file] of blobs) {
  const content = git(['cat-file', 'blob', oid]);
  if (!content.includes('\0')) inspect(file, content, 'reachable history');
}
let packagedFiles = null;
if (process.argv.includes('--package')) {
  const packed = JSON.parse(run('npm', ['pack', '--dry-run', '--ignore-scripts', '--json', '--cache', '/private/tmp/wombat-public-check-npm-cache']));
  packagedFiles = packed[0].files.map(item => item.path);
  for (const file of packagedFiles) if (privatePath.test(file)) issues.push(`package: private path ${file}`);
  const binary = process.platform === 'win32' ? 'wombat-core.exe' : 'wombat-core';
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'README.zh-CN.md', 'dist/wombat.js', `dist/${binary}`, 'dist/licenses/wombat-MIT.txt', 'dist/licenses/node-dependencies.txt', 'dist/licenses/rust-dependencies.txt']) {
    if (!packagedFiles.includes(file)) issues.push(`package: required file missing ${file}`);
  }
  for (const file of packagedFiles.filter(file => !files.includes(file))) {
    const content = readFileSync(path.join(root, file));
    // Native binaries can also leak build-home paths through panic/debug strings.
    inspect(file, content.toString('utf8'), 'package');
  }
}
if (issues.length) {
  console.error([...new Set(issues)].join('\n'));
  process.exitCode = 1;
} else console.log(`Public guards passed: ${files.length} files, ${checkedLinks} local links, ${commits.length} reachable commits${packagedFiles ? `, ${packagedFiles.length} package files` : ''}. No publication performed.`);
