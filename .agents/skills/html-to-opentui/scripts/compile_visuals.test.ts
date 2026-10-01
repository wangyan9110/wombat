import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { compileVisuals, type VisualInput } from './compile_visuals.ts';

const input = (): VisualInput => ({ cell: { width: 8, height: 20 }, tokens: { '--page': 'page', '--active': 'active', '--border': 'border' }, styles: {
  selected: { css: 'border-radius:3px; border:1px solid var(--border); padding:4px 10px; background:var(--active)', borderBackdrop: 'var(--page)' },
} });
async function execute(source: string) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
test('generated native recipe separates fill from rounded border cells and respects independent cell scales', async () => {
  const module = await execute(compileVisuals(input()));
  const style = module.visualStyles.selected({ page: '#000', active: '#123', border: '#456' });
  assert.equal(style.box.backgroundColor, '#000'); assert.equal(style.content.backgroundColor, '#123');
  assert.equal(style.box.borderColor, '#456'); assert.equal(style.box.borderStyle, 'rounded');
  assert.equal(style.content.paddingTop, 0); assert.equal(style.content.paddingLeft, 1);
});
test('SVG asset changes propagate into generated masks without hand-editing output', async () => {
  const contract = input(); contract.assets = { icon: { svg: 'icon.svg' } };
  const asset = (x: number) => `<svg viewBox="0 0 3 2" fill="currentColor"><rect x="${x}" y="0" width="1" height="2"/></svg>`;
  const first = await execute(compileVisuals(contract, () => asset(0)));
  const next = await execute(compileVisuals(contract, () => asset(2)));
  assert.deepEqual(first.visualAssets.icon, ['#..','#..']); assert.deepEqual(next.visualAssets.icon, ['..#','..#']);
  assert.equal(first.visualMonochromeAssets.icon, '⠃⠀'); assert.equal(next.visualMonochromeAssets.icon, '⠀⠃');
});
test('a flex gap uses different horizontal and vertical cell scales', async () => {
  const contract = input(); contract.styles = { stack: { css: 'display:flex; flex-direction:column; gap:20px 16px; align-items:center' } };
  const module = await execute(compileVisuals(contract));
  assert.deepEqual(module.visualStyles.stack({}).box, { flexDirection: 'column', rowGap: 1, columnGap: 2, alignItems: 'center' });
});
test('unresolved CSS, missing tokens, unsupported SVG and unconverted behavior cannot silently compile', () => {
  for (const css of ['transform:scale(2)', 'padding:calc(1px + 2px)', 'background:var(--missing)', 'background:#000;background:#fff', 'align-items:space-between']) {
    const contract = input(); contract.styles.selected.css = css;
    assert.throws(() => compileVisuals(contract));
  }
  const contract = input(); delete contract.styles.selected.borderBackdrop;
  assert.throws(() => compileVisuals(contract), /backdrop/);
  contract.assets = { icon: { svg: 'icon.svg' } }; contract.styles = input().styles;
  assert.throws(() => compileVisuals(contract, () => '<svg viewBox="0 0 2 2"><path d="M0 0"/></svg>'), /Unconverted SVG/);
  assert.throws(() => compileVisuals({ ...input(), scripts: ['onclick'] } as VisualInput), /Unsupported input section/);
});
