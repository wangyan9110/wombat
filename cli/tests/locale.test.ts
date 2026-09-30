import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLanguageArgs } from '../src/locale.js';
import { locale } from '@wombat/client/locale';
import { usageHelp } from '../src/usage-app-cli.js';
import { dateLabel, effort, usageLabel } from '../src/format.js';
test('language selection is independent of command placement and query arguments', () => {
  for (const argv of [['--lang', 'en', 'prices', '--json'], ['prices', '--lang=en', '--json']]) {
    assert.deepEqual(parseLanguageArgs(argv, { WOMBAT_LANG: 'zh' }), { argv: ['prices', '--json'], locale: 'en' });
  }
  assert.equal(parseLanguageArgs([], { LANG: 'C.UTF-8' }).locale, 'en');
  assert.throws(() => parseLanguageArgs(['--lang']), /requires/);
  assert.throws(() => parseLanguageArgs(['--lang=zh', '--lang=en']), /repeated/);
});
test('help, module-level labels and dates follow a switch after imports', () => {
  try {
    locale.setLocale('en');
    assert.match(usageHelp(), /Usage/); assert.match(usageHelp(), /--lang/);
    assert.equal(effort('high'), 'High');
    assert.equal(dateLabel('2026-09-30', '2026-09-30T00:00:00Z'), '9/30');
    locale.setLocale('zh'); assert.equal(effort('high'), '高'); assert.match(usageHelp(), /用法/);
  } finally { locale.setLocale('zh'); }
});
