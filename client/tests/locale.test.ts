import test from 'node:test';
import assert from 'node:assert/strict';
import { LocaleRuntime, resolveLocale } from '../src/locale/index.js';
test('explicit, environment and system language precedence, including regional tags', () => {
  assert.equal(resolveLocale({ explicit: 'en-US', environment: 'zh', languages: ['zh-CN'] }), 'en');
  assert.equal(resolveLocale({ environment: 'zh_CN.UTF-8', languages: ['en'] }), 'zh');
  assert.equal(resolveLocale({ languages: ['ja', 'en-GB'] }), 'en');
  assert.equal(resolveLocale({ languages: ['ja'] }), 'zh');
  assert.throws(() => resolveLocale({ explicit: 'fr' }), /Unsupported/);
});
test('translation function stays stable across switches, interpolation leaves data literal', () => {
  const runtime = new LocaleRuntime(), translate = runtime.t;
  assert.equal(translate('cli.format.usage'), '用量');
  const first = runtime.getSnapshot();
  let updates = 0; const stop = runtime.subscribe(() => updates++);
  runtime.setLocale('en'); runtime.setLocale('en');
  assert.equal(updates, 1); assert.equal(translate, runtime.t);
  assert.equal(translate('cli.format.usage'), 'Usage');
  assert.equal(first.locale, 'zh'); assert.ok(Object.isFrozen(first));
  const value = '中文 {p0} $1';
  assert.equal(translate('common.turn_value', { p0: value }), `Turn ${value}`);
  stop(); runtime.setLocale('zh'); assert.equal(updates, 1);
});
test('one broken subscriber does not prevent others from seeing the updated locale', () => {
  const runtime = new LocaleRuntime(); let observed = '';
  runtime.subscribe(() => { throw new Error('subscriber'); });
  runtime.subscribe(() => { observed = runtime.getSnapshot().locale; });
  assert.throws(() => runtime.setLocale('en'), /subscriber/);
  assert.equal(observed, 'en');
});
