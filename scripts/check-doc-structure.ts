import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';

type MarkdownNode = ReturnType<typeof fromMarkdown>['children'][number];

/** Inspect authored Markdown without interpreting code blocks as instructions or prose. */
export function structureErrors(file: string, source: string): string[] {
  const tree = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const errors: string[] = [];
  const titles = tree.children.filter(node => node.type === 'heading' && node.depth === 1);
  if (titles.length !== 1 || tree.children.find(node => node.type !== 'html') !== titles[0]) {
    errors.push(`${file}: start with exactly one level-one title`);
  }
  function visit(node: MarkdownNode): void {
    if (node.type === 'paragraph' && node.position && node.position.start.line !== node.position.end.line) {
      errors.push(`${file}:${node.position.start.line}: keep each prose paragraph on one physical line`);
    }
    if (node.type === 'heading' && node.children.length === 0) {
      errors.push(`${file}:${node.position?.start.line}: heading must have a title`);
    }
    // Quoted material preserves its original line breaks; code and tables are not prose paragraphs.
    if (node.type === 'blockquote') return;
    if ('children' in node) for (const child of node.children) visit(child);
  }
  for (const node of tree.children) visit(node);
  return errors;
}

function main(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const manifest = JSON.parse(readFileSync(path.join(root, 'scripts/doc-i18n.manifest.json'), 'utf8')) as {
    pairs: Array<{ zh: string; en: string }>;
  };
  const budgets = JSON.parse(readFileSync(path.join(root, 'scripts/doc-budgets.json'), 'utf8')) as Record<string, number>;
  const files = new Set([
    ...manifest.pairs.flatMap(pair => [pair.zh, pair.en]),
    ...Object.keys(budgets).filter(file => path.basename(file) === 'AGENTS.md'),
  ]);
  const errors = [...files].flatMap(file => structureErrors(file, readFileSync(path.join(root, file), 'utf8')));
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else console.log(`Documentation structure passed: ${files.size} authored files.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
