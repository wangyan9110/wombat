// Inspect syntax, not comments or raw source text. Source/log values are never translated.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const han = /[\u3400-\u9fff]/u;
export function findCopy(file, content) {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const errors = [];
  function visit(node) {
    const literal = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
    const value = literal ? node.text : ts.isTemplateExpression(node) ? node.head.text + node.templateSpans.map(span => span.literal.text).join('') : undefined;
    if (value !== undefined) {
      const property = ts.isPropertyAssignment(node.parent) && node.parent.initializer === node ? node.parent.name.getText(source) : '';
      const copyProperty = /^(label|title|description|placeholder|footer|emptyLabel|message)$/.test(property);
      const englishCopy = copyProperty && /[A-Za-z]/.test(value) && /\s/.test(value) && !/^YYYY-MM-DD$/.test(value);
      if (han.test(value) || englishCopy) errors.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: move product copy into the locale dictionary`);
    }
    if (ts.isCallExpression(node) && node.expression.getText(source) === 't') {
      let parent = node.parent;
      while (parent && !ts.isFunctionLike(parent) && !ts.isSourceFile(parent)) parent = parent.parent;
      if (parent && ts.isSourceFile(parent)) errors.push(`${file}: translation captured during module initialization; resolve labels lazily`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return errors;
}
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(`${dir}/${entry.name}`) : entry.name.endsWith('.ts') ? [`${dir}/${entry.name}`] : []); }
function dictionary(file) {
  const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true), result = {};
  function visit(node) { if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.initializer)) result[node.name.text] = node.initializer.text; ts.forEachChild(node, visit); }
  visit(tree); return result;
}
export function dictionaryErrors(zh, en) {
  const errors = [];
  const slots = value => [...new Set(value.match(/\{\w+\}/g) ?? [])].sort().join();
  for (const key of new Set([...Object.keys(zh), ...Object.keys(en)])) {
    if (!(key in zh) || !(key in en)) errors.push(`${key}: missing locale entry`);
    else if (slots(zh[key]) !== slots(en[key])) errors.push(`${key}: interpolation parameters differ`);
  }
  return errors;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const errors = [...files('cli/src'), ...files('tui/src')].flatMap(file => findCopy(file, readFileSync(file, 'utf8')));
  errors.push(...dictionaryErrors(dictionary('client/src/locale/zh.ts'), dictionary('client/src/locale/en.ts')));
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('Product locale dictionaries, parameters and copy ownership passed.');
}
