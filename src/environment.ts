import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModuleResult, Resource } from './contracts.js';

interface SourceRoot { agent: 'codex' | 'claude'; root: string; scope: 'user' | 'workspace' }

export interface EnvironmentResult {
  resources: Resource[];
  status: ModuleResult[];
  ruleFiles: string[];
  warnings: string[];
}

const ignoredDirs = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.venv', 'vendor']);

async function safeStat(file: string) {
  try { return await fs.lstat(file); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function digest(file: string): Promise<string | null> {
  const stat = await safeStat(file);
  if (!stat?.isFile()) return null;
  return createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

function resourceId(agent: string, kind: string, file: string, name: string) {
  return createHash('sha256').update(`${agent}\0${kind}\0${file}\0${name}`).digest('hex').slice(0, 20);
}

async function fileResource(agent: Resource['agent'], kind: Resource['kind'], file: string, scope: Resource['scope'], name = path.basename(file), detail?: string): Promise<Resource | null> {
  const stat = await safeStat(file);
  if (!stat) return null;
  const linkedPath = stat.isSymbolicLink() ? await fs.readlink(file) : undefined;
  return {
    id: resourceId(agent, kind, file, name), agent, kind, name, path: file, scope,
    source: file, sizeBytes: stat.isFile() ? stat.size : null, fileCount: stat.isFile() ? 1 : null,
    sha256: stat.isFile() ? await digest(file) : null, configured: true,
    loaded: 'unverified', used: 'unverified', linkedPath, detail,
  };
}

async function skillDirectoryResource(root: SourceRoot, dir: string): Promise<Resource | null> {
  const stat = await safeStat(dir);
  if (!stat) return null;
  if (!stat.isDirectory() && !stat.isSymbolicLink()) return null;
  let bytes = 0; let files = 0; const hashes: string[] = []; let truncated = false;
  const seen = new Set<string>();
  async function visit(current: string, depth: number) {
    if (depth > 12 || files > 5000) { truncated = true; return; }
    const real = await fs.realpath(current).catch(() => current);
    if (seen.has(real)) return;
    seen.add(real);
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (ignoredDirs.has(entry.name)) continue;
      const child = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(child, depth + 1);
      else if (entry.isFile()) {
        const s = await fs.stat(child);
        bytes += s.size; files++;
        if (s.size <= 4_000_000) hashes.push(`${path.relative(dir, child)}:${await digest(child)}`);
      }
    }
  }
  if (stat.isDirectory()) await visit(dir, 0);
  const link = stat.isSymbolicLink() ? await fs.readlink(dir) : undefined;
  return {
    id: resourceId(root.agent, 'skill', dir, path.basename(dir)), agent: root.agent, kind: 'skill',
    name: path.basename(dir), path: dir, scope: root.scope, source: path.dirname(dir),
    sizeBytes: stat.isDirectory() ? bytes : null, fileCount: stat.isDirectory() ? files : null,
    sha256: hashes.length ? createHash('sha256').update(hashes.sort().join('\n')).digest('hex') : null,
    configured: true, loaded: 'unverified', used: 'unverified', linkedPath: link,
    detail: truncated ? '文件清单超过扫描上限，体积与哈希不完整' : undefined,
  };
}

async function scanSkills(root: SourceRoot, resources: Resource[]) {
  const dir = path.join(root.root, 'skills');
  const stat = await safeStat(dir);
  if (!stat?.isDirectory()) return;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const skill = await skillDirectoryResource(root, path.join(dir, entry.name));
    if (skill) resources.push(skill);
  }
}

function parseMcpNames(raw: string, file: string): string[] {
  if (file.endsWith('.toml')) {
    return [...raw.matchAll(/^\s*\[mcp_servers\.([A-Za-z0-9_-]+)(?:\.[^\]]+)?\]\s*$/gm)].map(match => match[1]);
  }
  const json = JSON.parse(raw) as Record<string, unknown>;
  const servers = json.mcpServers ?? json.mcp_servers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return [];
  return Object.keys(servers);
}

async function scanMcp(agent: 'codex' | 'claude', file: string, scope: Resource['scope'], resources: Resource[]) {
  const stat = await safeStat(file);
  if (!stat?.isFile()) return;
  const raw = await fs.readFile(file, 'utf8');
  for (const name of new Set(parseMcpNames(raw, file))) {
    resources.push({
      id: resourceId(agent, 'mcp', file, name), agent, kind: 'mcp', name, path: file, scope,
      source: file, sizeBytes: null, fileCount: null, sha256: null, configured: true,
      loaded: 'unverified', used: 'unverified', detail: '仅确认配置存在；未验证连接或实际使用',
    });
  }
}

async function findWorkspaceRuleFiles(workspace: string): Promise<string[]> {
  const found: string[] = [];
  async function visit(dir: string, depth: number) {
    if (depth > 8 || found.length >= 500) return;
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && !ignoredDirs.has(entry.name) && !entry.name.startsWith('.')) await visit(file, depth + 1);
      else if (entry.isFile() && (entry.name === 'AGENTS.md' || entry.name === 'CLAUDE.md')) found.push(file);
    }
  }
  await visit(workspace, 0);
  return found;
}

export async function scanEnvironment(workspace: string, sourceDirs: Record<string, string[]> = {}): Promise<EnvironmentResult> {
  const home = os.homedir();
  const codexRoots = sourceDirs.codex?.length ? sourceDirs.codex : [process.env.CODEX_HOME || path.join(home, '.codex')];
  const claudeRoots = sourceDirs.claude?.length ? sourceDirs.claude : [path.join(home, '.claude')];
  const roots: SourceRoot[] = [
    ...codexRoots.map(root => ({ agent: 'codex' as const, root, scope: 'user' as const })),
    { agent: 'codex', root: path.join(home, '.agents'), scope: 'user' },
    ...claudeRoots.map(root => ({ agent: 'claude' as const, root, scope: 'user' as const })),
    { agent: 'codex', root: path.join(workspace, '.agents'), scope: 'workspace' },
    { agent: 'codex', root: path.join(workspace, '.codex'), scope: 'workspace' },
    { agent: 'claude', root: path.join(workspace, '.claude'), scope: 'workspace' },
  ];
  const resources: Resource[] = []; const status: ModuleResult[] = []; const warnings: string[] = [];
  for (const root of roots) {
    try {
      const stat = await safeStat(root.root);
      if (!stat) { status.push({ source: `${root.agent}:${root.root}`, state: 'empty', detail: '目录不存在' }); continue; }
      if (!stat.isDirectory()) { status.push({ source: `${root.agent}:${root.root}`, state: 'unsupported', detail: '不是目录' }); continue; }
      const before = resources.length;
      await scanSkills(root, resources);
      if (root.agent === 'codex') await scanMcp('codex', path.join(root.root, 'config.toml'), root.scope, resources);
      if (root.agent === 'claude') await scanMcp('claude', path.join(root.root, 'settings.json'), root.scope, resources);
      status.push({ source: `${root.agent}:${root.root}`, state: 'success', count: resources.length - before });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      status.push({ source: `${root.agent}:${root.root}`, state: code === 'EACCES' ? 'permission_denied' : 'partial', detail: String(error) });
    }
  }
  const ruleFiles = [
    path.join(codexRoots[0] || '', 'AGENTS.md'),
    path.join(claudeRoots[0] || '', 'CLAUDE.md'),
    ...await findWorkspaceRuleFiles(workspace).catch(error => { warnings.push(`工作空间规则扫描失败：${String(error)}`); return []; }),
  ];
  for (const file of new Set(ruleFiles)) {
    try {
      const agent = path.basename(file) === 'CLAUDE.md' ? 'claude' : 'codex';
      const scope: Resource['scope'] = file.startsWith(workspace + path.sep) ? 'workspace' : 'user';
      const item = await fileResource(agent, 'rule', file, scope);
      if (item) resources.push(item);
    } catch (error) { warnings.push(`规则文件无法读取 ${file}: ${String(error)}`); }
  }
  for (const [agent, file, scope] of [
    ['claude', path.join(home, '.claude.json'), 'user'],
    ['claude', path.join(workspace, '.mcp.json'), 'workspace'],
  ] as const) {
    try { await scanMcp(agent, file, scope, resources); }
    catch (error) { warnings.push(`MCP 配置无法解析 ${file}: ${String(error)}`); }
  }
  const unique = new Map(resources.map(resource => [resource.id, resource]));
  return { resources: [...unique.values()], status, ruleFiles: [...new Set(ruleFiles)], warnings };
}
