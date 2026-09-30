// Build a transferable native package and installer; no registry publication.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
function run(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: root, stdio: options.capture ? 'pipe' : 'inherit', encoding: 'utf8',
    timeout: 900_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(`${program} ${args.join(' ')} failed: ${result.error?.message ?? (result.stderr || `exit ${result.status}`)}`);
  return result.stdout;
}
for (const args of [
  ['build'], ['typecheck'], ['contracts:check'], ['licenses:check'], ['repo:check'],
  ['public:check', '--package'], ['package:check'],
]) run('corepack', ['pnpm', ...args]);
const releases = path.join(root, 'dist', 'releases');
mkdirSync(releases, { recursive: true });
const output = mkdtempSync(path.join(releases, `wombat-${pkg.version}-${process.platform}-${process.arch}-`));
let complete = false;
try {
  const pack = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output,
    '--cache', path.join(output, '.npm-cache')], { capture: true }));
  if (pack.length !== 1 || !pack[0].filename) throw new Error('npm pack produced no archive');
  const archive = pack[0].filename;
  const sha256 = createHash('sha256').update(readFileSync(path.join(output, archive))).digest('hex');
  copyFileSync(path.join(root, 'scripts/install-release.mjs'), path.join(output, 'install.mjs'));
  writeFileSync(path.join(output, 'release.json'), JSON.stringify({
    name: pkg.name, version: pkg.version, platform: process.platform, arch: process.arch,
    node: pkg.engines.node, archive, sha256,
  }, null, 2) + '\n');
  writeFileSync(path.join(output, 'INSTALL.txt'),
    `Wombat ${pkg.version} (${process.platform}/${process.arch})\n\n` +
    '中文：需要匹配的平台、Node.js 26.4.0+、npm 和联网获取公开运行依赖。在本目录执行 node install.mjs。安装程序输出命令路径。\n' +
    'English: On a matching machine with Node.js 26.4.0+, npm and registry access, run node install.mjs in this directory. The installer prints the command path.\n');
  rmSync(path.join(output, '.npm-cache'), { recursive: true, force: true });
  complete = true;
  console.log(`Release bundle: ${output}\nInstall on a matching machine with Node.js 26.4.0+: node install.mjs\nNo publication performed.`);
} finally {
  if (!complete) rmSync(output, { recursive: true, force: true });
}
