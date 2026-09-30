/** Static source inventory only. Never evaluates prototype JavaScript or computes CSS cascade. */
import { readFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import ts from 'typescript';
import type { Inventory, Location } from './types.ts';
import { args, main, writeJson } from './io.ts';
export function extract(htmlPath: string, extraSources: string[] = []): Inventory {
  const html = resolve(htmlPath);
  const result: Inventory = { schemaVersion: 3, hashEncoding: 'raw-bytes', computed: false, executed: false, sources: [], rules: [], issues: [], scripts: [], elements: [] };
  const seen = new Set<string>(), visitedJs = new Set<string>();
  function source(file: string): string | undefined {
    try {
      const bytes = readFileSync(file);
      if (!seen.has(file)) { seen.add(file); result.sources.push({ path: file, sha256: createHash('sha256').update(bytes).digest('hex') }); }
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    } catch (error) { result.issues.push({ source: file, reason: String(error) }); return undefined; }
  }
  function local(ref: string, origin: string, module = false): string | undefined {
    if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(ref) || !ref.split(/[?#]/)[0] || module && !ref.startsWith('.') && !ref.startsWith('/')) {
      result.issues.push({ source: origin, reference: ref, reason: 'non-local or bare resource; unresolved' }); return;
    }
    try { return resolve(dirname(origin), decodeURIComponent(ref.split(/[?#]/)[0])); }
    catch { result.issues.push({ source: origin, reference: ref, reason: 'invalid resource URL' }); return; }
  }
  function cssFile(file: string, conditions: string[] = [], stack: string[] = []): void {
    if (stack.includes(file)) { result.issues.push({ source: file, reason: 'CSS import cycle' }); return; }
    const content = source(file); if (content !== undefined) css(content, file, conditions, [...stack, file]);
  }
  function css(content: string, file: string, conditions: string[] = [], stack: string[] = [], offset = 0, columnOffset = 0): void {
    let root: postcss.Root;
    try { root = postcss.parse(content, { from: file }); }
    catch (error) { result.issues.push({ source: file, reason: String(error) }); return; }
    function visit(container: postcss.Container, active: string[]): void {
      for (const node of container.nodes ?? []) {
        const location = { source: file, line: (node.source?.start?.line ?? 1) + offset, column: (node.source?.start?.column ?? 1) + ((node.source?.start?.line ?? 1) === 1 ? columnOffset : 0) };
        if (node.type === 'rule') {
          const declarations = (node.nodes ?? []).filter(n => n.type === 'decl').map(n => ({ property: n.prop, value: n.value, important: !!n.important, line: (n.source?.start?.line ?? 1) + offset }));
          result.rules.push({ ...location, order: result.rules.length, selector: node.selector, conditions: active, declarations });
          if (node.nodes?.some(n => n.type === 'rule' || n.type === 'atrule')) result.issues.push({ ...location, reason: 'nested CSS requires explicit lowering; not expanded' });
        } else if (node.type === 'atrule') {
          const name = node.name.toLowerCase();
          if (name === 'import') {
            const parts = valueParser(node.params).nodes.filter(n => n.type !== 'space' && n.type !== 'comment');
            const first = parts[0];
            const urlNodes = first?.type === 'function' ? first.nodes.filter(n => n.type !== 'space' && n.type !== 'comment') : [];
            const ref = first?.type === 'string' ? first.value : first?.type === 'function' && first.value.toLowerCase() === 'url' && urlNodes.length === 1 && ['string', 'word'].includes(urlNodes[0].type) ? urlNodes[0].value : undefined;
            if (!ref) { result.issues.push({ ...location, reason: 'unsupported import' }); continue; }
            const target = local(ref, file), rest = node.params.slice(first.sourceEndIndex).trim();
            if (target) cssFile(target, [...active, ...(rest ? ['@import ' + rest] : [])], stack);
          } else if (node.nodes && ['media', 'supports', 'layer', 'container', 'scope'].includes(name)) visit(node, [...active, '@' + node.name + ' ' + node.params]);
          else result.issues.push({ ...location, reason: 'unexpanded at-rule: @' + node.name + ' ' + node.params });
        }
      }
    }
    visit(root, conditions);
  }
  function js(content: string, file: string, inline = false, offset = 0, columnOffset = 0): void {
    const ast = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.jsx') ? ts.ScriptKind.JSX : /\.[cm]?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS);
    const entry: Inventory['scripts'][number] = { source: file, line: offset + 1, column: columnOffset + 1, inline, dependencies: [], candidates: [] };
    result.scripts.push(entry);
    const location = (node: ts.Node): Location => { const pos = ast.getLineAndCharacterOfPosition(node.getStart(ast)); return { source: file, line: pos.line + offset + 1, column: pos.character + 1 + (pos.line === 0 ? columnOffset : 0) }; };
    const diagnosticAst = ast as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] };
    for (const d of diagnosticAst.parseDiagnostics ?? []) result.issues.push({ source: file, reason: ts.flattenDiagnosticMessageText(d.messageText, '\n') });
    function dependency(node: ts.Node | undefined): void {
      if (!node || !ts.isStringLiteralLike(node)) { result.issues.push({ source: file, reason: 'computed JS dependency; unresolved' }); return; }
      entry.dependencies.push(node.text);
      const target = local(node.text, file, true); if (target) jsFile(target);
    }
    function candidate(node: ts.Node, kind: string): void { entry.candidates.push({ ...location(node), kind, expression: node.getText(ast) }); }
    function visit(node: ts.Node): void {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) { if (node.moduleSpecifier) dependency(node.moduleSpecifier); }
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(ast);
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword || callee === 'require') dependency(node.arguments[0]);
        if (/\.(addEventListener|removeEventListener)$/.test(callee)) candidate(node, 'event-registration');
        if (/\.(createElement|append|appendChild|replaceChildren|remove|setAttribute)$/.test(callee) || /\.classList\.(add|remove|toggle|replace)$/.test(callee)) candidate(node, 'dom-mutation');
        if (/\.(focus|blur|scrollIntoView|scrollTo|getBoundingClientRect)$/.test(callee)) candidate(node, 'browser-layout-or-focus');
        if (['fetch', 'setTimeout', 'setInterval', 'requestAnimationFrame'].includes(callee)) candidate(node, 'effect-or-timer');
        if (callee === 'eval' || callee === 'Function') result.issues.push({ ...location(node), reason: 'runtime-generated JavaScript requires observation' });
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
        const target = node.left.getText(ast);
        if (/\.on\w+$/.test(target)) candidate(node, 'event-assignment');
        else if (/\.(innerHTML|outerHTML|textContent|className|disabled|hidden|value)$/.test(target) || target.includes('.style.')) candidate(node, 'dom-assignment');
        else candidate(node, 'assignment');
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  function jsFile(file: string): void {
    if (visitedJs.has(file)) return; visitedJs.add(file);
    const content = source(file); if (content === undefined) return;
    if (/\.[cm]?[jt]sx?$/.test(file)) js(content, file);
    else result.issues.push({ source: file, reason: 'dependency fingerprinted without JS parsing; explicit extension required' });
  }
  type Node = DefaultTreeAdapterTypes.Node;
  const content = source(html); if (content === undefined) return result;
  function walk(node: Node): void {
    if ('tagName' in node) {
      const attributes = Object.fromEntries(node.attrs.map(a => [a.name, a.value]));
      const location = { source: html, line: node.sourceCodeLocation?.startLine ?? 1, column: node.sourceCodeLocation?.startCol };
      // Omit synthetic html/head/body nodes inserted by the HTML parser.
      if (node.sourceCodeLocation) result.elements.push({ ...location, tag: node.tagName, attributes, text: ['script','style'].includes(node.tagName) ? '' : node.childNodes.filter(n => 'value' in n).map(n => (n as DefaultTreeAdapterTypes.TextNode).value).join('') });
      if (node.tagName === 'base') result.issues.push({ ...location, reason: 'HTML base URL not applied' });
      if ('style' in attributes) result.issues.push({ ...location, reason: 'element style attribute requires DOM matching' });
      for (const [name, value] of Object.entries(attributes)) if (/^on/i.test(name)) {
        result.issues.push({ ...location, reason: 'inline event handler requires element/action mapping: ' + name });
        const attr = node.sourceCodeLocation?.attrs?.[name];
        const anchor = { source: html, line: attr?.startLine ?? location.line, column: attr?.startCol ?? location.column };
        result.scripts.push({ ...anchor, inline: true, dependencies: [], candidates: [{ ...anchor, kind: 'inline-handler', expression: value }] });
      }
      if (node.tagName === 'link' && attributes.rel?.toLowerCase().split(/\s+/).includes('stylesheet') && attributes.href) {
        const target = local(attributes.href, html); if (target) cssFile(target, attributes.media ? ['@media ' + attributes.media] : []);
      }
      const body = node.childNodes.filter(n => 'value' in n).map(n => (n as DefaultTreeAdapterTypes.TextNode).value).join('');
      const offset = (node.sourceCodeLocation?.startTag?.endLine ?? location.line) - 1;
      const columnOffset = (node.sourceCodeLocation?.startTag?.endCol ?? 1) - 1;
      if (node.tagName === 'style') css(body, html, attributes.media ? ['@media ' + attributes.media] : [], [], offset, columnOffset);
      if (node.tagName === 'script' && (!attributes.type || ['module', 'text/javascript', 'application/javascript'].includes(attributes.type))) {
        if (attributes.src) { const target = local(attributes.src, html); if (target) jsFile(target); }
        else js(body, html, true, offset, columnOffset);
      }
      if ('content' in node) walk(node.content);
    }
    if ('childNodes' in node) node.childNodes.forEach(walk);
  }
  walk(parse(content, { sourceCodeLocationInfo: true }));
  for (const extra of extraSources) {
    const file = resolve(extra); if (/\.[cm]?[jt]sx?$/.test(extname(file))) jsFile(file); else source(file);
  }
  return result;
}
main(import.meta.url, () => {
  const a = args(['html', 'out'], ['extra-source']);
  const result = extract(a.html as string, a['extra-source'] as string[] | undefined);
  writeJson(a.out as string, result);
  console.log(JSON.stringify({ rules: result.rules.length, sources: result.sources.length, scripts: result.scripts.length, issues: result.issues.length, output: a.out }));
  if (result.issues.length) process.exitCode = 2;
});
