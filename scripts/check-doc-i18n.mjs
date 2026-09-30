import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'scripts/doc-i18n.manifest.json'), 'utf8'));
const args = process.argv.slice(2).filter(arg => arg !== '--');
const write = args[0] === '--write';
if (write) args.shift();
const requested = args;
const errors = [];
const pairs = manifest.pairs;
const known = new Set([...manifest.legacyUnpaired, ...manifest.excluded]);
if (known.size !== manifest.legacyUnpaired.length + manifest.excluded.length) errors.push('duplicate legacy or excluded manifest entry');
const pairByPath = new Map();
const content = file => readFileSync(path.join(root, file), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');

for (const pair of pairs) {
  for (const file of [pair.zh, pair.en, pair.record]) {
    if (known.has(file) || pairByPath.has(file)) errors.push(`${file}: duplicate i18n manifest entry`);
    pairByPath.set(file, pair);
    known.add(file);
  }
}

function walk(directory) {
  const found = [];
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    if (entry.isDirectory() && ['target', 'dist', 'node_modules', 'vendor', '.git'].includes(entry.name)) continue;
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(relative));
    else if (entry.name.endsWith('.md') || entry.name.endsWith('.i18n.json')) found.push(relative);
  }
  return found;
}

for (const directory of ['docs', 'core', 'client', 'tui', 'cli', '.agents/notes']) {
  for (const file of walk(directory)) {
    if (!known.has(file)) errors.push(`${file}: add a complete bilingual pair to the manifest or justify an exclusion`);
  }
}
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.md') && !known.has(entry.name)) {
    errors.push(`${entry.name}: add a complete bilingual pair to the manifest or justify an exclusion`);
  }
}
for (const file of [...manifest.legacyUnpaired, ...manifest.excluded]) {
  if (!existsSync(path.join(root, file))) errors.push(`${file}: stale i18n manifest entry`);
}

function normalizedLinks(file, body, language) {
  const links = [];
  let fenced = false;
  for (const line of body.split('\n').slice(3)) {
    if (/^```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    for (const match of line.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].trim();
      if (/^(?:[a-z]+:|#|\/)/i.test(target)) { links.push(target); continue; }
      const [local, fragment = ''] = target.split('#', 2);
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), local));
      const linkedPair = pairByPath.get(resolved);
      if (linkedPair && (language === 'zh' ? resolved !== linkedPair.zh : resolved !== linkedPair.en)) {
        errors.push(`${file}: link ${target} points to the other language`);
      }
      links.push(`${linkedPair ? linkedPair.zh : resolved}#${fragment}`);
    }
  }
  return links;
}

function signature(body) {
  const headings = [];
  const lists = [];
  const fences = [];
  let currentFence = null;
  for (const line of body.split('\n')) {
    if (/^```/.test(line)) {
      if (currentFence === null) currentFence = [line];
      else { currentFence.push(line); fences.push(currentFence.join('\n')); currentFence = null; }
      continue;
    }
    if (currentFence !== null) { currentFence.push(line); continue; }
    const heading = /^(#{1,6})\s+/.exec(line);
    if (heading) headings.push(heading[1].length);
    const list = /^\s*([-*+]\s+|\d+[.)]\s+)/.exec(line);
    if (list) lists.push(/^\d/.test(list[1]) ? 'ordered' : 'unordered');
  }
  if (currentFence !== null) errors.push('unclosed Markdown code fence');
  return { headings, lists, fences };
}

for (const pair of pairs) {
  const missing = [pair.zh, pair.en, pair.record].filter(file => !existsSync(path.join(root, file)));
  if (missing.length && !(write && missing.length === 1 && missing[0] === pair.record)) {
    errors.push(`${pair.zh}: incomplete pair; missing ${missing.join(', ')}`);
    continue;
  }
  const zh = content(pair.zh);
  const en = content(pair.en);
  const expectedZhSwitcher = `[English](${path.posix.basename(pair.en)})`;
  const expectedEnSwitcher = `[中文](${path.posix.basename(pair.zh)})`;
  if (!zh.split('\n').slice(0, 4).some(line => line.includes(expectedZhSwitcher))) {
    errors.push(`${pair.zh}: missing English language switcher after the title`);
  }
  if (!en.split('\n').slice(0, 4).some(line => line.includes(expectedEnSwitcher))) {
    errors.push(`${pair.en}: missing Chinese language switcher after the title`);
  }
  const zhSignature = signature(zh);
  const enSignature = signature(en);
  for (const field of ['headings', 'lists', 'fences']) {
    if (JSON.stringify(zhSignature[field]) !== JSON.stringify(enSignature[field])) {
      errors.push(`${pair.zh} ↔ ${pair.en}: ${field} structure differs`);
    }
  }
  const zhLinks = normalizedLinks(pair.zh, zh, 'zh');
  const enLinks = normalizedLinks(pair.en, en, 'en');
  if (JSON.stringify(zhLinks) !== JSON.stringify(enLinks)) errors.push(`${pair.zh} ↔ ${pair.en}: link targets differ`);
  if (!write && !missing.length) {
    const expected = JSON.stringify({ zh: hash(zh), en: hash(en) }, null, 2) + '\n';
    if (content(pair.record) !== expected) errors.push(`${pair.record}: pair changed; review both languages, then record this pair`);
  }
}

if (write) {
  if (!requested.length) errors.push('pass one or more confirmed pair paths after --write');
  for (const anchor of requested) if (!pairByPath.has(anchor)) errors.push(`${anchor}: pair is not declared`);
} else if (requested.length) {
  errors.push(`unknown arguments: ${requested.join(' ')}`);
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
if (write) {
  for (const pair of new Set(requested.map(anchor => pairByPath.get(anchor)))) {
    const record = JSON.stringify({ zh: hash(content(pair.zh)), en: hash(content(pair.en)) }, null, 2) + '\n';
    writeFileSync(path.join(root, pair.record), record);
    console.log(`Confirmed pair recorded: ${pair.record}`);
  }
} else {
  console.log(`Bilingual documentation passed: ${pairs.length} pair(s), ${manifest.legacyUnpaired.length} legacy unpaired page(s).`);
}
