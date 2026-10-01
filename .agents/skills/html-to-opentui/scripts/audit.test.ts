import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { extract } from './extract_prototype.ts';
import { checkSources } from './check_sources.ts';
import { checkGeometry } from './check_geometry.ts';
import { compareStyles } from './compare_styles.ts';
import type { Capture, GeometryRule, ColorRule } from './types.ts';
function fixture(run: (dir: string, write: (name: string, data: string | Buffer) => string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'html-to-opentui-test-'));
  try { run(dir, (name, data) => { const file = join(dir, name); writeFileSync(file, data); return file; }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
test('CSS import order, conditions, important and inline locations survive extraction', () => fixture((_, write) => {
  write('base.css', '.button { border: 1px solid #123; color: red!important }');
  write('main.css', '@import "base.css"; @media (max-width: 480px) { .button {padding: 3px 7px} }\n.button.active {color:#abc}');
  const html = write('index.html', '<link rel="stylesheet" href="main.css"><style>\n.button {color: blue}</style>');
  const result = extract(html);
  assert.deepEqual(result.issues, []); assert.equal(result.computed, false);
  assert.deepEqual(result.rules.map(r => r.selector), ['.button', '.button', '.button.active', '.button']);
  assert(result.rules[0].declarations[1].important);
  assert.deepEqual(result.rules[1].conditions, ['@media (max-width: 480px)']);
  assert.equal(result.rules[2].line, 2); assert.equal(result.rules[3].line, 2);
  assert.equal(result.sources.length, 3);
}));
test('CSS parsing respects quoted punctuation, escapes, comments and import URL conditions', () => fixture((_, write) => {
  write('base.css', '.x { content:"a;{b}"; --size:calc(2px + 3px); }');
  write('main.css', '@import url("base.css") screen; /* ;{} */ .x\\:active { color: #abc }');
  const result = extract(write('index.html', '<link rel="stylesheet" href="main.css?rev=1">'));
  assert.deepEqual(result.rules[0].conditions, ['@import screen']);
  assert.equal(result.rules[0].declarations[0].value, '"a;{b}"');
  assert.equal(result.rules[1].selector, '.x\\:active');
}));
test('cycles, remote resources, style attributes and unsupported nesting are explicit', () => fixture((_, write) => {
  write('base.css', '@import "base.css"; .a {color:green; & .b {color:red}}');
  const result = extract(write('index.html', '<link rel="stylesheet" href="base.css"><link rel="stylesheet" href="https://example.invalid/a.css"><p style="color:red">x</p>'));
  assert.equal(result.rules.length, 1); assert.equal(result.issues.length, 4);
}));
test('raw hashes preserve BOM/CRLF and detect changed or missing JavaScript', () => fixture((_, write) => {
  const bytes = Buffer.from('\uFEFF<style>p { color:#abc; }\r\n</style>');
  const html = write('index.html', bytes), js = write('model.js', 'const state="fixture";');
  const inventory = extract(html, [js]);
  assert.equal(inventory.sources[0].sha256, createHash('sha256').update(bytes).digest('hex'));
  assert(checkSources(inventory).passed);
  write('model.js', 'const state="changed";'); assert(!checkSources(inventory).passed);
  rmSync(js); assert(checkSources(inventory).checks.at(-1)?.error);
}));
test('JS graph discovers scripts, ESM, re-exports, literal dynamic imports, require and cycles without execution', () => fixture((_, write) => {
  write('main.js', 'import "./a.js"; export {x} from "./b.js"; import("./c.js"); require("./d.js"); globalThis.mustNotRun = true; throw Error("NEVER EXECUTE");');
  write('a.js', 'import "./main.js";'); write('b.js', 'export const x=1;'); write('c.js', 'export {};'); write('d.js', 'module.exports=1;');
  const result = extract(write('index.html', '<script src="main.js" defer></script>'));
  assert.equal(result.scripts.length, 5); assert.equal(result.sources.length, 6); assert.equal(result.executed, false);
  assert.equal((globalThis as Record<string, unknown>).mustNotRun, undefined);
  assert.equal(result.elements[0].attributes.defer, '');
}));
test('inline handlers, DOM mutation, browser APIs and state assignments are only candidates', () => fixture((_, write) => {
  const result = extract(write('index.html', '<button onclick="state.open = true">Open</button><script>\nbutton.onclick=()=>{state.open=true; panel.classList.toggle("open"); panel.focus();}; button.addEventListener("click", handler); setTimeout(handler, 100); panel.innerHTML="test"; document.createElement("div");</script>'));
  const candidates = result.scripts.flatMap(s => s.candidates);
  for (const kind of ['assignment','event-assignment','event-registration','dom-mutation','dom-assignment','browser-layout-or-focus','effect-or-timer']) assert(candidates.some(c => c.kind === kind), kind);
  assert(candidates.some(c => c.line === 2)); assert(result.issues.some(i => i.reason.includes('inline event handler')));
}));
test('computed imports, bare packages, missing files and malformed JS/CSS cannot silently pass', () => fixture((_, write) => {
  write('bad.css', '.x { color:');
  write('bad.js', 'import "package-name"; import(name); import "./missing.js"; const broken = ;');
  const result = extract(write('index.html', '<link rel="stylesheet" href="bad.css"><script src="bad.js"></script>'));
  assert(result.issues.length >= 5);
}));
test('source freshness rejects legacy and empty inventories', () => {
  assert.throws(() => checkSources({ sources: [] } as never));
  assert(!checkSources({ hashEncoding: 'raw-bytes', sources: [] }).passed);
});
test('CLI executes through a symlink instead of returning a false successful no-op', () => fixture((dir, write) => {
  const entry = join(dir, 'extract.ts');
  symlinkSync(new URL('./extract_prototype.ts', import.meta.url), entry);
  const output = join(dir, 'inventory.json');
  const run = spawnSync(process.execPath, [entry, '--html', write('index.html', '<p>Fixture</p>'), '--out', output], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(readFileSync(output, 'utf8')).elements.at(-1).text, 'Fixture');
  assert.match(run.stdout, /sources/);
}));
test('visual resources are byte-fingerprinted and a mask-only update invalidates the baseline', () => fixture((_, write) => {
  const mask = write('mark.svg', '<svg viewBox="0 0 2 2"><rect width="1" height="1"/></svg>');
  const raster = write('photo.png', Buffer.from([137, 80, 78, 71, 255, 0]));
  write('theme.css', '.logo { mask: url("mark.svg#shape"); } .photo { background: url(photo.png?rev=2); }');
  const inventory = extract(write('index.html', '<link rel="stylesheet" href="theme.css"><img src="photo.png"><svg><use href="#local"/></svg>'));
  assert.deepEqual(inventory.issues, []);
  assert(inventory.assets?.some(a => a.usage === 'css:mask' && a.path === mask));
  assert.equal(inventory.sources.filter(s => s.path === raster).length, 1, 'binary assets do not require UTF-8 decoding and duplicate references hash once');
  assert(checkSources(inventory).passed);
  write('mark.svg', '<svg viewBox="0 0 2 2"><circle r="1"/></svg>');
  assert.deepEqual(checkSources(inventory).checks.filter(c => !c.passed).map(c => c.path), [mask]);
}));
test('unavailable visual resources remain explicit rather than a complete-looking inventory', () => fixture((_, write) => {
  const inventory = extract(write('index.html', '<style>.logo { mask:url(missing.svg) } .photo {background:url(https://example.invalid/a.png)}</style><img srcset="a.png 1x, b.png 2x">'));
  assert.equal(inventory.assets?.length, 2);
  assert(inventory.issues.some(i => i.source?.endsWith('missing.svg')));
  assert(inventory.issues.some(i => i.reference === 'https://example.invalid/a.png'));
  assert(inventory.issues.some(i => i.reason.includes('srcset')));
}));
function screen(): Capture { return { name: 'report', width: 80, height: 24, plain: '模型 $1.5001', geometry: [
  { id: 'content', x: 10, y: 0, width: 60, height: 24 }, { id: 'head', x: 12, y: 2, width: 20, height: 1 },
  { id: 'data', x: 12, y: 4, width: 20, height: 2 }, { id: 'footer', x: 10, y: 20, width: 60, height: 4 },
] }; }
const rules: GeometryRule[] = [
  { screen: 'report', kind: 'aligned', nodes: ['head','data'], properties: ['x','width'] },
  { screen: 'report', kind: 'inside', node: 'footer' }, { screen: 'report', kind: 'centered', node: 'content' },
  { screen: 'report', kind: 'ordered', nodes: ['head','data','footer'] }, { screen: 'report', kind: 'text', value: '$1.5001' },
];
test('geometry and exact text pass; one-cell alignment drift needs explicit tolerance', () => {
  const s = screen(); assert(checkGeometry([s], rules).passed); s.geometry[2].x++;
  assert(!checkGeometry([s], rules).passed); assert(checkGeometry([s], rules.map(r => ({...r,tolerance:1}))).passed);
});
test('clipped footer, overlapping rows and truncated amount fail independently', () => {
  const s = screen(); s.geometry[3].y=22; s.geometry[2].y=2; s.plain='模型 $1.50';
  assert.deepEqual(checkGeometry([s], rules).checks.filter(c=>!c.passed).map(c=>c.rule.kind), ['inside','ordered','text']);
});
test('missing/duplicate/empty/nonfinite rectangles and duplicate screens fail', () => {
  for(const kind of ['missing','duplicate','empty','nonfinite']) {
    const s=screen(); if(kind==='missing')s.geometry.pop(); if(kind==='duplicate')s.geometry.push({...s.geometry[3]}); if(kind==='empty')s.geometry[3].height=0; if(kind==='nonfinite')s.geometry[3].x=NaN;
    assert(!checkGeometry([s],rules).passed);
  }
  assert(!checkGeometry([],rules).passed); assert(!checkGeometry([screen(),screen()],rules).passed);
});
test('empty mappings and invalid geometry rules fail closed', () => {
  assert(!checkGeometry([screen()],[]).passed);
  for(const r of [{kind:'bogus'},{kind:'text',value:''},{kind:'centered',axis:'z'},{kind:'inside',node:'footer',tolerance:-1}]) assert(!checkGeometry([screen()],[{screen:'report',...r} as GeometryRule]).passed);
});
function contentScreen(): Capture {
  return { name: 'field', width: 80, height: 24, plain: '2026-01-01', geometry: [
    { id: 'shell', x: 10, y: 2, width: 33, height: 3, contentRect: { x: 12, y: 3, width: 29, height: 1 } },
    { id: 'input', x: 12, y: 3, width: 31, height: 1 },
  ] };
}
const contentRule: GeometryRule = { screen: 'field', kind: 'inside-content', node: 'input', container: 'shell' };
test('outer containment can pass while text paints over padding and border', () => {
  const s = contentScreen();
  assert(checkGeometry([s], [{ ...contentRule, kind: 'inside' }]).passed);
  assert(!checkGeometry([s], [contentRule]).passed);
  s.geometry[1].width = 29;
  assert(checkGeometry([s], [contentRule]).passed);
  s.geometry[1].x--;
  assert(!checkGeometry([s], [contentRule]).passed);
});
test('content containment rejects missing, malformed and impossible evidence', () => {
  for (const contentRect of [undefined, { x: NaN, y: 3, width: 29, height: 1 }, { x: 12, y: 3, width: 0, height: 1 }, { x: 9, y: 3, width: 29, height: 1 }]) {
    const s = contentScreen(); s.geometry[0].contentRect = contentRect;
    assert(!checkGeometry([s], [{ ...contentRule, tolerance: 100 }]).passed);
  }
  for (const container of [undefined, '@viewport', 'missing']) assert(!checkGeometry([contentScreen()], [{ ...contentRule, container }]).passed);
});
test('axis-limited content check does not mistake scrolling for horizontal overflow', () => {
  const s = contentScreen(); s.geometry[1].width = 29; s.geometry[1].y = 10;
  assert(!checkGeometry([s], [contentRule]).passed);
  assert(checkGeometry([s], [{ ...contentRule, axis: 'x' }]).passed);
  assert(!checkGeometry([s], [{ ...contentRule, axis: 'z' } as unknown as GeometryRule]).passed);
  s.geometry[1].width++;
  assert(!checkGeometry([s], [{ ...contentRule, axis: 'x' }]).passed);
});
test('color comparison requires cascade evidence and detects missing or mismatching native text', () => fixture((_, write) => {
  const inventory = extract(write('index.html','<style>.x {color:#abc!important;color:#000}</style>'));
  const s=screen(); s.spans={lines:[{spans:[{text:'model',fg:{buffer:{0:170,1:187,2:204}},bg:{buffer:{0:0,1:0,2:0}}}]}]};
  const mapping:ColorRule[]=[{screen:'report',text:'model',selector:'.x',property:'color',channel:'fg',cascadeConfirmed:true}];
  assert(compareStyles(inventory,[s],mapping).passed);
  assert.throws(()=>compareStyles(inventory,[s],[{...mapping[0],cascadeConfirmed:false}]));
  assert(!compareStyles(inventory,[s],[{...mapping[0],text:'absent'}]).passed);
  s.spans.lines[0].spans[0].fg.buffer[0]=0; assert(!compareStyles(inventory,[s],mapping).passed);
  assert(!compareStyles(inventory,[s],[]).passed);
}));
test('CLI extraction and drift checks work from another directory; review issues exit 2', () => fixture((dir, write) => {
  const html=write('index.html','<style>.x {color:#abc}</style>'), out=join(dir,'result.json');
  const run=(file:string,args:string[])=>spawnSync(process.execPath,[new URL(file,import.meta.url).pathname,...args],{cwd:dir,encoding:'utf8'});
  assert.equal(run('./extract_prototype.ts',['--html',html,'--out',out]).status,0);
  assert.equal(run('./check_sources.ts',['--inventory',out]).status,0);
  write('index.html','<script src="https://example.invalid/x.js"></script>');
  assert.equal(run('./check_sources.ts',['--inventory',out]).status,1);
  assert.equal(run('./extract_prototype.ts',['--html',html,'--out',out]).status,2);
}));

test('incremental report distinguishes source properties, observed mismatch and implementation edits', async () => {
  const { planChanges } = await import('./plan_changes.ts');
  fixture((_,write)=>{
    write('style.css','.button {color:#abc;padding:4px}');
    const html=write('index.html','<link rel="stylesheet" href="style.css">');
    const before=extract(html), impl=write('view.ts','export const label="button";');
    const bindings={schemaVersion:1 as const,baselineSources:before.sources,components:[{id:'button',sources:[{path:before.rules[0].source,selectors:['.button']}],implementation:[{path:impl,sha256:createHash('sha256').update('export const label="button";').digest('hex')}],colors:[{screen:'report',text:'button',selector:'.button',property:'color',channel:'fg' as const,cascadeConfirmed:true}]}]};
    assert.equal(planChanges(before,before,bindings).requiresReview,false);
    write('style.css','.button {color:#123;padding:4px}');const after=extract(html);
    const report=planChanges(before,after,bindings);
    assert.deepEqual(report.cssChanges[0].properties.map(p=>p.property),['color']);
    assert.equal(report.components[0].status,'prototype-changed-review');
    write('view.ts','export const label="edited";');
    assert.equal(planChanges(before,after,bindings).components[0].status,'both-changed-review');
    const capture=screen();capture.spans={lines:[{spans:[{text:'button',fg:{buffer:{0:170,1:187,2:204}},bg:{buffer:{0:0,1:0,2:0}}}]}]};
    const observed=planChanges(before,after,bindings,[capture]);
    assert.equal(observed.components[0].status,'observed-mismatch');
    assert.equal(observed.components[0].observed.colors?.checks[0].expected,'#112233');
    assert.deepEqual(observed.components[0].observed.colors?.checks[0].actual,['#aabbcc']);
  });
});
test('incremental planning exposes unmapped changes, removed rules, order shifts and stale baseline', async()=>{
  const {planChanges}=await import('./plan_changes.ts');
  fixture((_,write)=>{
    const html=write('index.html','<style>.a{color:#123}.b{color:#456}.c{color:#789}</style>');const before=extract(html);
    write('index.html','<style>.b{color:#456}.a{color:#123}</style><script>button.onclick=()=>state.open=true;</script>');const after=extract(html);
    const bindings={schemaVersion:1 as const,baselineSources:before.sources,components:[]};const r=planChanges(before,after,bindings);
    assert(r.orderChanged);assert(r.structureChanged);assert(r.unmappedSources.length);assert.equal(r.unmappedCss[0].kind,'removed');assert(r.jsChanges[0].addedCandidates.length);
    assert.throws(()=>planChanges(before,after,{...bindings,baselineSources:after.sources}));
  });
});

test('incremental detection includes text-only HTML updates and unrecognized JS changes', async()=>{
  const {planChanges}=await import('./plan_changes.ts');
  fixture((_,write)=>{
    const html=write('index.html','<button>Daily</button><script src="controller.js"></script>');write('controller.js','const value = 1;');const before=extract(html);
    write('index.html','<button>Weekly</button><script src="controller.js"></script>');write('controller.js','const value = 2;');const after=extract(html);
    const bindings={schemaVersion:1 as const,baselineSources:before.sources,components:[{id:'period',sources:before.sources.map(s=>({path:s.path})),implementation:[]}]};
    const r=planChanges(before,after,bindings);assert(r.structureChanged);assert.equal(r.components[0].status,'prototype-changed-review');assert(r.jsChanges.length);
  });
});
test('invalid UTF-8 is reported rather than silently replacing source bytes',()=>fixture((_,write)=>{
  const html=write('index.html',Buffer.from([0xff,0xfe,0x00]));assert(extract(html).issues.length);
}));
test('incremental CLI writes review report without modifying implementation files',()=>fixture((dir,write)=>{
  const html=write('index.html','<style>.x{color:#123}</style>');const before=extract(html);
  write('index.html','<style>.x{color:#abc}</style>');const after=extract(html);
  const old=write('before.json',JSON.stringify(before)), current=write('after.json',JSON.stringify(after));
  const binding=write('bindings.json',JSON.stringify({schemaVersion:1,baselineSources:before.sources,components:[]}));
  const result=spawnSync(process.execPath,[new URL('./plan_changes.ts',import.meta.url).pathname,'--before',old,'--after',current,'--bindings',binding,'--out',join(dir,'plan.json')],{cwd:dir,encoding:'utf8'});
  assert.equal(result.status,2);assert.match(result.stdout,/requiresReview/);
}));

test('inline CSS and JS locations point into the HTML rather than column one',()=>fixture((_,write)=>{
  const source='<style>.x{color:#abc}</style><script>state.open = true;</script>';
  const inventory=extract(write('index.html',source));
  assert.equal(inventory.rules[0].column,source.indexOf('.x')+1);
  assert.equal(inventory.scripts[0].candidates[0].column,source.indexOf('state')+1);
}));
