import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Finding } from './contracts.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 20);

function lineForOffset(text: string, offset: number): number { return text.slice(0, offset).split('\n').length; }

export async function inspectRuleFile(file: string, workspace: string): Promise<Finding[]> {
  if (path.basename(file) !== 'AGENTS.md') return [];
  let content: string;
  try { content = await fs.readFile(file, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const findings: Finding[] = [];
  const scope: string | null = file.startsWith(workspace + path.sep) ? workspace : null;
  const paths = [...content.matchAll(/\]\((\.{1,2}\/[^)#\s]+)(?:#[^)]*)?\)|`(\.{1,2}\/[^`\s]+)`/g)];
  const checked = new Set<string>();
  for (const match of paths) {
    const reference = match[1] ?? match[2];
    if (!reference || /[*?{}]/.test(reference) || checked.has(reference)) continue;
    checked.add(reference);
    const resolved = path.resolve(path.dirname(file), reference);
    try { await fs.access(resolved); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') continue;
      const line = lineForOffset(content, match.index);
      findings.push({ id: hash(`missing:${file}:${reference}`), ruleId: 'rules.missing_relative_path', ruleVersion: '1',
        severity: 'review', confidence: 'fact', title: '规则引用的相对路径不存在',
        fact: `${file}:${line} 引用 ${reference}，按该文件所在目录解析后未找到目标。`,
        hypothesis: '引用可能已过期，也可能是尚未创建的示例路径。', recommendation: '核对该引用的用途；确定新路径后手动修改。',
        diff: null, agent: 'codex', workspace: scope, evidence: [{ file, line, sha256: hash(match[0]) }],
      });
    }
  }
  const blocks = [...content.matchAll(/(?:^|\n\s*\n)([^\n][\s\S]*?)(?=\n\s*\n|$)/g)];
  const seen = new Map<string, { line: number; block: string }>();
  for (const match of blocks) {
    const block = match[1].trim();
    if (block.length < 40 || block.startsWith('#') || block.includes('```')) continue;
    const normalized = block.replace(/\s+/g, ' ');
    const line = lineForOffset(content, match.index + match[0].indexOf(match[1]));
    const first = seen.get(normalized);
    if (!first) { seen.set(normalized, { line, block }); continue; }
    findings.push({ id: hash(`duplicate:${file}:${line}`), ruleId: 'rules.exact_duplicate_paragraph', ruleVersion: '1',
      severity: 'actionable', confidence: 'fact', title: '同一规则文件存在完全重复段落',
      fact: `${file} 的第 ${first.line} 行与第 ${line} 行段落内容相同。`,
      hypothesis: '可能是复制时重复添加；删除前仍需确认其所在标题与作用域。',
      recommendation: '审查第二处段落，确认后手动删除。', diff: block.split('\n').map(item => `-${item}`).join('\n'),
      agent: 'codex', workspace: scope, evidence: [{ file, line: first.line }, { file, line }],
    });
  }
  return findings;
}
