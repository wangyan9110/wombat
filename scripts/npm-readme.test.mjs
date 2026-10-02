import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import { npmReadme } from './npm-readme.ts';
import { inspectPair } from './doc-pairing.mjs';

test('localized README images retain language ownership and section parity', () => {
  const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const manifest = JSON.parse(read('scripts/doc-i18n.manifest.json'));
  const pairs = new Map([...manifest.pairs, ...manifest.assetPairs].flatMap(pair => [[pair.zh, pair], [pair.en, pair]]));
  const pair = pairs.get('README.md');
  const zh = read(pair.zh), en = read(pair.en);
  assert.deepEqual(inspectPair(pair, zh, en, pairs).errors, []);
  assert.ok(inspectPair(pair, zh, en.replace('prototype-overview-en.jpg', 'prototype-overview-zh.jpg'), pairs)
    .errors.some(error => error.includes('other language')));
});

test('npm README resolves both languages, logos and images without changing anchors or commands', () => {
  for (const file of ['README.md', 'README.zh-CN.md']) {
    const original = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const result = npmReadme(original, 'v0.3.0');
    assert.match(result, /srcset="https:\/\/raw\.githubusercontent\.com\/wangyan9110\/wombat\/v0\.3\.0\/assets\/wombat-logo-dark\.svg"/);
    assert.match(result, /src="https:\/\/raw\.githubusercontent\.com\/wangyan9110\/wombat\/v0\.3\.0\/assets\/wombat-logo-light\.svg"/);
    assert.match(result, /\]\(https:\/\/raw\.githubusercontent\.com\/wangyan9110\/wombat\/v0\.3\.0\/assets\/prototype-overview-(?:zh|en)\.jpg\)/);
    assert.match(result, /\]\(https:\/\/raw\.githubusercontent\.com\/wangyan9110\/wombat\/v0\.3\.0\/assets\/prototype-review-(?:zh|en)\.jpg\)/);
    assert.match(result, /\]\(https:\/\/github\.com\/wangyan9110\/wombat\/blob\/v0\.3\.0\/README(?:\.zh-CN)?\.md\)/);
    assert.deepEqual(result.match(/```[\s\S]*?```/g), original.match(/```[\s\S]*?```/g));
    assert.deepEqual(result.match(/\]\(#[^)]+\)/g), original.match(/\]\(#[^)]+\)/g));
    assert.doesNotMatch(result, /(?:\]\(|(?:src|srcset)=")assets\//);
    assert.equal(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), original);
  }
});

test('README assets are explicit and present, and public metadata preserves root privacy', () => {
  const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const assets = metadata.files.filter(file => file.startsWith('assets/'));
  assert.deepEqual(assets.slice().sort(), [
    'assets/prototype-overview-en.jpg', 'assets/prototype-overview-zh.jpg',
    'assets/prototype-review-en.jpg', 'assets/prototype-review-zh.jpg',
    'assets/wombat-logo-dark.svg', 'assets/wombat-logo-light.svg',
  ].sort());
  for (const file of assets) {
    assert.match(file, /^assets\/[a-z-]+\.(?:svg|jpg)$/);
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)));
  }
  assert.equal(metadata.private, true);
  for (const key of ['description', 'keywords', 'repository', 'homepage', 'bugs']) assert.ok(metadata[key]);
  assert.throws(() => npmReadme('', '../private'), /Invalid/);
});
