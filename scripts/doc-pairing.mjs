// Wombat's pairing implementation, informed by DeepSeek Harness's section-record design.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
const hash = value => createHash('sha256').update(value).digest('hex');
const parse = body => fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
const text = node => node.value ?? node.children?.map(text).join('') ?? '';
function switcher(node, counterpart) {
  return node.type === 'paragraph' && node.children?.some(child => child.type === 'link' && child.url === path.posix.basename(counterpart))
    && /^(?:中文\s*\|\s*English|English\s*\|\s*中文)$/.test(text(node).trim());
}
function target(url, file, language, pairs, errors) {
  if (/^(?:[a-z]+:|#|\/)/i.test(url)) return url;
  const split = url.search(/[?#]/), local = split < 0 ? url : url.slice(0, split), suffix = split < 0 ? '' : url.slice(split);
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), decodeURIComponent(local)));
  const pair = pairs.get(resolved);
  if (pair && resolved !== pair[language]) errors.push(`${file}: link ${url} points to the other language`);
  return (pair?.zh ?? resolved) + suffix;
}
function analyze(body, file, counterpart, language, pairs, errors) {
  const tree = parse(body), signature = [], sections = [{ heading: '', depth: 0, blocks: [] }];
  let section = sections[0];
  const definitions = new Map();
  function definitionsIn(node) { if (node.type === 'definition') definitions.set(node.identifier, node.url); node.children?.forEach(definitionsIn); }
  definitionsIn(tree);
  function visit(node) {
    if (node.type === 'heading') signature.push(['heading', node.depth]);
    if (node.type === 'code') {
      signature.push(['code', node.lang ?? '', node.meta ?? '', node.value]);
      const raw = body.slice(node.position.start.offset, node.position.end.offset).split('\n');
      const opener = /^(`{3,}|~{3,})/.exec(raw[0]);
      if (opener && (raw.length < 2 || !new RegExp(`^\\s*${opener[1][0]}{${opener[1].length},}\\s*$`).test(raw.at(-1)))) errors.push(`${file}: unclosed code fence`);
    }
    if (node.type === 'list') signature.push(['list', Boolean(node.ordered), node.start ?? null, node.children.length]);
    if (node.type === 'listItem') signature.push(['item', node.checked ?? null]);
    if (node.type === 'table') signature.push(['table', node.align, node.children.map(row => row.children.length)]);
    if (node.type === 'link' || node.type === 'image') signature.push([node.type, target(node.url, file, language, pairs, errors)]);
    if (node.type === 'linkReference' || node.type === 'imageReference') {
      const url = definitions.get(node.identifier);
      if (url === undefined) errors.push(`${file}: undefined link reference ${node.identifier}`);
      else signature.push([node.type, target(url, file, language, pairs, errors)]);
    }
    node.children?.forEach(visit);
    if (node.type === 'list') signature.push(['end-list']);
  }
  let hasSwitcher = false;
  for (const [index, node] of tree.children.entries()) {
    if (index > 0 && tree.children[index - 1].type === 'heading' && tree.children[index - 1].depth === 1 && switcher(node, counterpart)) { hasSwitcher = true; continue; }
    visit(node);
    if (node.type === 'heading') { section = { heading: text(node), depth: node.depth, blocks: [] }; sections.push(section); }
    // Fenced/indented code is already compared exactly by the structural check.
    if (node.type !== 'code') section.blocks.push(body.slice(node.position.start.offset, node.position.end.offset));
  }
  if (!hasSwitcher) errors.push(`${file}: missing language switcher`);
  return { signature, sections };
}
/** Parse Markdown structure, compare semantic link targets, and hash translated sections. */
export function inspectPair(pair, zh, en, pairs) {
  const errors = [], left = analyze(zh, pair.zh, pair.en, 'zh', pairs, errors), right = analyze(en, pair.en, pair.zh, 'en', pairs, errors);
  if (JSON.stringify(left.signature) !== JSON.stringify(right.signature)) errors.push(`${pair.zh} ↔ ${pair.en}: Markdown structure, code, or link targets differ`);
  const sections = {}, headings = [], used = new Map();
  for (const [index, english] of right.sections.entries()) {
    const chinese = left.sections[index];
    if (!chinese) continue;
    if (english.depth) {
      while (headings.length && headings.at(-1).depth >= english.depth) headings.pop();
      headings.push({ depth: english.depth, slug: english.heading.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section' });
    }
    const base = '/' + headings.map(item => item.slug).join('/');
    const occurrence = (used.get(base) ?? 0) + 1; used.set(base, occurrence);
    if (!english.blocks.length && !chinese.blocks.length) continue;
    sections[base + (occurrence > 1 ? `~${occurrence}` : '')] = { zh: hash(chinese.blocks.join('\n\n')), en: hash(english.blocks.join('\n\n')) };
  }
  return { errors, record: { version: 2, sections } };
}
export function recordDifferences(recorded, current) {
  if (recorded?.version !== 2 || !recorded.sections || typeof recorded.sections !== 'object') return ['legacy or invalid record; use --migrate for unchanged confirmed pairs'];
  const errors = [];
  for (const [section, hashes] of Object.entries(current.sections)) {
    for (const language of ['zh', 'en']) if (recorded.sections[section]?.[language] !== hashes[language]) errors.push(`${section}: ${language} changed since confirmation`);
  }
  for (const section of Object.keys(recorded.sections)) if (!(section in current.sections)) errors.push(`${section}: section removed since confirmation`);
  return errors;
}
