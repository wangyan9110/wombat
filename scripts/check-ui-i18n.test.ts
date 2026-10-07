import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkProject, dictionaryErrors, findCopy, readDictionary } from './check-ui-i18n.ts';

const dictionary = { 'state.complete': '已完成', 'state.failed': '失败', 'state.running': '运行中', 'state.unknown': '未知' };
const english = { 'state.complete': 'Completed', 'state.failed': 'Failed', 'state.running': 'Running', 'state.unknown': 'Unknown' };
function fixture(run: (root: string) => void): void {
  const root = mkdtempSync(path.join(tmpdir(), 'wombat-i18n-check-'));
  try {
    for (const dir of ['client/src/locale', 'cli/src', 'ui/src']) mkdirSync(path.join(root, dir), { recursive: true });
    writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    writeFileSync(path.join(root, 'client/src/locale/index.ts'), `import {zh} from './zh.js';
export type MessageKey = keyof typeof zh;
export type Translate = <K extends MessageKey>(key: K) => string;
export declare const t: Translate;
export declare const locale: {t: Translate};
export declare function labels<K extends string>(keys: Record<K, MessageKey>): Record<K, string>;`);
    saveDictionaries(root);
    run(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
function saveDictionaries(root: string, zh: Record<string, string> = dictionary, en: Record<string, string> = english): void {
  writeFileSync(path.join(root, 'client/src/locale/zh.ts'), `export const zh = ${JSON.stringify(zh)} as const;`);
  writeFileSync(path.join(root, 'client/src/locale/en.ts'), `export const en = ${JSON.stringify(en)} as const;`);
}
const script = fileURLToPath(new URL('./check-ui-i18n.ts', import.meta.url));

test('dictionary validation catches missing, blank, mixed-language and untranslated states with exact technical exceptions', () => {
  assert.deepEqual(dictionaryErrors(dictionary, english), []);
  assert.ok(dictionaryErrors(dictionary, { ...english, 'state.failed': 'Failed，失败' }).some(error => error.includes('Chinese text')));
  assert.ok(dictionaryErrors({ ...dictionary, 'state.running': 'Running' }, english).some(error => error.includes('shared by both locales')));
  assert.ok(dictionaryErrors({ ...dictionary, 'state.running': 'Still running' }, english).some(error => error.includes('Chinese locale')));
  assert.ok(dictionaryErrors(dictionary, { ...english, 'state.failed': '  ' }).some(error => error.includes('empty')));
  assert.ok(dictionaryErrors(dictionary, { 'state.complete': 'Completed' }).some(error => error.includes('missing')));
  assert.ok(dictionaryErrors({ note: '已发现 {count}' }, { note: 'Found {total}' }).some(error => error.includes('parameters')));
  assert.deepEqual(dictionaryErrors({ 'webui.languageChinese': '中文', 'config.rule': 'AGENTS.md' }, { 'webui.languageChinese': '中文', 'config.rule': 'AGENTS.md' }), []);
  assert.ok(dictionaryErrors({ 'config.rule': 'AGENTS.md failed' }, { 'config.rule': 'AGENTS.md failed' }).length);
  assert.ok(dictionaryErrors({ 'webui.languageChinese': '中文' }, { 'webui.languageChinese': '选择中文' }).length);
  // Source strings are interpolated verbatim; their eventual language is not inspected.
  assert.deepEqual(dictionaryErrors({ title: '来源：{title}' }, { title: 'Source: {title}' }), []);
});

test('dictionary parsing rejects duplicate keys, nonliteral entries and missing dictionary exports', () => {
  assert.deepEqual(readDictionary('en.ts', 'export const en = {"state.failed":"Failed"} as const satisfies Record<string,string>;').errors, []);
  for (const source of [
    'export const en = {"state.failed":"Failed", "state.failed":"Error"};',
    'export const en = {"state.failed":getMessage()};',
    'export const en = {...other};',
    'export const en = {[key]:"Error"};',
    'export const other = {};',
    'const en = {key:"Label"};',
    'export const en = {};',
  ]) assert.ok(readDictionary('en.ts', source).errors.length, source);
});

test('presentation sinks catch short, mixed and accessible copy without filtering source content or protocol comparisons', () => {
  for (const source of [
    'function View(){return <p>Loading failed</p>}',
    'function View(){return <pre><button>Retry</button></pre>}',
    'function View(){return <button>Retry</button>}',
    'const message="读取失败"; function View(){return <p>{message}</p>}',
    'function message(){return "读取失败"} function View(){return <p>{message()}</p>}',
    'const message=()=>"Loading failed"; function View(){return <p>{message()}</p>}',
    'const message="读取失败"; const options=[{label:message}]; function View(){return <select>{options.map(o=><option>{o.label}</option>)}</select>}',
    'function message(){return "读取失败"} const options=[{label:message()}];',
    'function View(){return <p>读取 failed</p>}',
    'function View(){return <input aria-label="Retry" placeholder="Search"/>}',
    'function View(){return <p>{ready ? "Completed" : "未知"}</p>}',
    'function View(){return <p>{`Failed ${count} operations`}</p>}',
    'const copy = {label:"Retry", message:"读取失败"};',
  ]) assert.ok(findCopy('view.tsx', source).length, source);
  assert.deepEqual(findCopy('view.tsx', `// 中文说明
const source = {originalText: "用户 Title 原文", protocol: "running"};
const dateInput = {placeholder:'YYYY-MM-DD'};
function View(){return <><h1>{source.originalText}</h1><p>{source.protocol === "running" ? t("state.running") : source.protocol}</p>
<input {...dateInput}/><code>native_id 中文原文</code><pre>wombat --json</pre><small>Token</small><small>USD</small>
<p>{count} ms</p><p>{count} Token ·</p><button aria-label={\`${'${count}'} ms\`}/></>}`), []);
});

test('source-only finite key resolution checks closed status templates, aliases, locale.t and lazy label maps', () => fixture(root => {
  const file = path.join(root, 'ui/src/view.tsx');
  writeFileSync(file, `import {t as translate,locale,labels} from '@wombat/client/locale';
const names = labels({done:'state.complete',fail:'state.failed'});
export function View(record:{status:'complete'|'failed'|'running'|'unknown'}){
return <p>{translate(\`state.${'${record.status}'}\`)} {locale.t('state.unknown')} {names.done}</p>;
}`);
  assert.deepEqual(checkProject(root), []);
  const { 'state.running': omittedZh, ...zh } = dictionary;
  const { 'state.running': omittedEn, ...en } = english;
  saveDictionaries(root, zh, en);
  assert.ok(checkProject(root).some(error => error.includes('state.running: translation key has no locale entry')));
  saveDictionaries(root);
  writeFileSync(file, `import {t as translate,locale,labels} from '@wombat/client/locale';
export function View(){const names=labels({missing:'state.notDefined'});return <p>{translate('state.notDefined')} {locale.t('state.anotherMissing')} {names.missing}</p>}`);
  const errors = checkProject(root);
  assert.ok(errors.some(error => error.includes('state.anotherMissing')));
  assert.ok(errors.filter(error => error.includes('state.notDefined')).length >= 2);
  writeFileSync(file, `import {t as translate,locale} from '@wombat/client/locale';
const captured = locale.t('state.running');
export function View(key:any){return <p>{translate(key)}</p>}`);
  const unsafe = checkProject(root);
  assert.ok(unsafe.some(error => error.includes('not finite')));
  assert.ok(unsafe.some(error => error.includes('module initialization')));
}));

test('executed checker returns nonzero diagnostics for invalid isolated sources and passes valid sources without dist', () => fixture(root => {
  const source = path.join(root, 'ui/src/view.tsx');
  writeFileSync(source, `import {t} from '@wombat/client/locale';export function View(){return <p>{t('state.running')}</p>}`);
  const run = () => spawnSync(process.execPath, [script, root], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  const valid = run();
  assert.equal(valid.error, undefined);
  assert.equal(valid.status, 0, valid.stderr);
  writeFileSync(source, `import {t} from '@wombat/client/locale';export function View(){return <p>{t('state.missing')} Loading failed</p>}`);
  const invalid = run();
  assert.equal(invalid.error, undefined);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /view\.tsx:1.*state\.missing/);
  assert.match(invalid.stderr, /JSX product copy/);
}));

test('transport result keys resolve from source without dist and still reject open or missing keys', () => fixture(root => {
  for (const transport of ['node', 'http']) {
    mkdirSync(path.join(root, 'client/src', transport), { recursive: true });
    writeFileSync(path.join(root, 'client/src', transport, 'index.ts'), `
export declare function createClient(): {query(): Promise<{status:'complete'|'failed'}>};`);
    const source = path.join(root, 'cli/src', `${transport}.ts`);
    writeFileSync(source, `import {createClient} from '@wombat/client/${transport}';
import {t} from '@wombat/client/locale';
export async function render(){const result=await createClient().query();return t(\`state.${'${result.status}'}\`);}`);
  }
  assert.deepEqual(checkProject(root), []);
  writeFileSync(path.join(root, 'client/src/node/index.ts'), `
export declare function createClient(): {query(): Promise<{status:string}>};`);
  assert.ok(checkProject(root).some(error => error.includes('node.ts:') && error.includes('not finite')));
  writeFileSync(path.join(root, 'client/src/http/index.ts'), `
export declare function createClient(): {query(): Promise<{status:'missing'}>};`);
  assert.ok(checkProject(root).some(error => error.includes('http.ts:') && error.includes('state.missing: translation key has no locale entry')));
}));


test('locale binding failures fail closed without treating unrelated application semantics as locale errors', () => fixture(root => {
  const file = path.join(root, 'ui/src/view.tsx'), entry = path.join(root, 'client/src/locale/index.ts');
  writeFileSync(entry, 'export declare const unrelated:string;');
  writeFileSync(file, `import {t} from '@wombat/client/locale';export function View(){return <p>{t('state.missing')}</p>}`);
  assert.ok(checkProject(root).some(error => error.includes('t: locale export could not be resolved')));
  writeFileSync(file, `import * as messages from '@wombat/client/locale';export function View(){return <p>{messages.t('state.missing')}</p>}`);
  assert.ok(checkProject(root).some(error => error.includes('locale call could not be resolved')));
  writeFileSync(entry, 'export declare const locale:{setLocale(value:string):void};');
  writeFileSync(file, `import {locale} from '@wombat/client/locale';export function View(){return <p>{locale.t('state.missing')}</p>}`);
  assert.ok(checkProject(root).some(error => error.includes('locale call could not be resolved')));
  rmSync(entry);
  assert.ok(checkProject(root).some(error => error.includes('locale module could not be resolved')));
}));

test('React state guard identifies imported hook setters and initial values while leaving codes and unrelated setters alone', () => fixture(root => {
  const file = path.join(root, 'ui/src/view.tsx');
  writeFileSync(path.join(root, 'ui/src/react.d.ts'), `declare module 'react' {
export function useState<S>(initial?:S):[S,(value:S|((previous:S)=>S))=>void];
export function useReducer(...args:unknown[]):[number,(value:string)=>void];
const React:{useState:typeof useState};export default React;
}`);
  writeFileSync(file, `import React,{useState as state} from 'react';import {t as translate} from '@wombat/client/locale';
export function View(){const [value,save]=state<string>();const [other,setOther]=React.useState({error:translate('state.unknown')});
save(translate('state.failed'));setOther(previous=>({...previous,error:translate('state.failed')}));return <p>{value}</p>;}`);
  assert.equal(checkProject(root).filter(error => error.includes('translated product text stored in React state')).length, 3);
  writeFileSync(file, `import {useState,useReducer} from 'react';import {t} from '@wombat/client/locale';
export function View(){const [code,setCode]=useState<'state.failed'|'state.complete'>('state.complete');
setCode('state.failed');const [value,setReducer]=useReducer(()=>0,0);setReducer(t('state.failed'));
function setError(message:string){return message;}setError(t('state.failed'));
const [,setLazy]=useState(()=>()=>t('state.failed'));setLazy(()=>()=>t('state.complete'));
const [,setBoolean]=useState(false);setBoolean(t('state.complete')==='Completed');return <p>{t(code)}</p>;}`);
  assert.deepEqual(checkProject(root), []);
}));

test('local static-copy tracing is bounded and respects lexical shadowing and data boundaries', () => {
  assert.deepEqual(findCopy('view.tsx', `const message="原始中文";function View(message:string){return <p>{message}</p>}`), []);
  const chain = Array.from({length:12},(_,index)=>`const v${index}=${index?'v'+(index-1):'"读取失败"'};`).join('');
  assert.ok(findCopy('view.tsx', chain+'function View(){return <p>{v11}</p>}').some(error => error.includes('inspection limit')));
});
