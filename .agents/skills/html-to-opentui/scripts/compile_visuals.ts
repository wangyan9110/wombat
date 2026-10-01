/** Compile reviewed, resolved CSS component styles to native Box recipes. No cascade guessing. */
import { readFileSync, writeFileSync } from 'node:fs';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import { parseFragment } from 'parse5';
import { resolve, dirname } from 'node:path';
import { args, main } from './io.ts';

export interface VisualInput {
  cell: { width: number; height: number };
  tokens: Record<string, string>;
  styles: Record<string, { css: string; borderBackdrop?: string }>;
  assets?: Record<string, { svg: string }>;
}

export function compileVisuals(input: VisualInput, readAsset: (path: string) => string = path => readFileSync(path, 'utf8')): string {
  if (Object.keys(input).some(key => !['cell','tokens','styles','assets'].includes(key))) throw Error('Unsupported input section; HTML trees and JS behavior require separate translation');
  if (![input.cell.width, input.cell.height].every(v => Number.isFinite(v) && v > 0)) throw Error('Positive finite cell dimensions required');
  const palette = new Set<string>();
  function color(value: string): string {
    const nodes = valueParser(value).nodes.filter(n => n.type !== 'space' && n.type !== 'comment');
    if (nodes.length === 1 && nodes[0].type === 'function' && nodes[0].value === 'var') {
      const key = valueParser.stringify(nodes[0].nodes).trim(), token = input.tokens[key];
      if (!token) throw Error('Unresolved color token: ' + value);
      palette.add(token); return `palette[${JSON.stringify(token)}]`;
    }
    if (/^#[\da-f]{3,8}$/i.test(value) && [4,5,7,9].includes(value.length) || value === 'transparent') return JSON.stringify(value);
    throw Error('Unsupported color: ' + value);
  }
  function px(value: string, cell: number): number {
    if (!/^(?:0|\d+(?:\.\d+)?px)$/.test(value)) throw Error('Unresolved length: ' + value);
    return Math.round(parseFloat(value) / cell);
  }
  const recipes: string[] = [];
  for (const [id, recipe] of Object.entries(input.styles)) {
    const box: Record<string, string> = {}, content: Record<string, string> = {};
    let border = false;
    const declared = new Set<string>();
    const root = postcss.parse(`component { ${recipe.css} }`);
    if (root.nodes.length !== 1 || root.nodes[0].type !== 'rule') throw Error('Expected resolved declarations: ' + id);
    for (const node of root.nodes[0].nodes) {
      if (node.type === 'comment') continue;
      if (node.type !== 'decl') throw Error('Nested CSS requires resolution: ' + id);
      const property = node.prop === 'background' ? 'background-color' : node.prop;
      if (declared.has(property)) throw Error('Duplicate declaration requires cascade resolution: ' + property);
      declared.add(property);
      const value = node.value.trim();
      switch (node.prop) {
        case 'background': case 'background-color': content.backgroundColor = color(value); break;
        case 'border-color': box.borderColor = color(value); break;
        case 'border': {
          const parts = valueParser(value).nodes.filter(n => n.type !== 'space' && n.type !== 'comment');
          if (parts.length !== 3 || parts[0].value !== '1px' || parts[1].value !== 'solid') throw Error('Unsupported border: ' + value);
          border = true; box.border = 'true'; box.borderStyle ??= '"single"'; box.borderColor = color(valueParser.stringify(parts[2])); break;
        }
        case 'border-radius':
          if (!/^\d+(?:\.\d+)?px$/.test(value)) throw Error('Unsupported radius: ' + value);
          box.borderStyle = JSON.stringify(parseFloat(value) > 0 ? 'rounded' : 'single'); break;
        case 'padding': {
          const values = value.split(/\s+/);
          if (values.length < 1 || values.length > 4) throw Error('Unsupported padding: ' + value);
          const [top, right = top, bottom = top, left = right] = values;
          for (const [key, v, cell] of [['paddingTop',top,input.cell.height],['paddingRight',right,input.cell.width],['paddingBottom',bottom,input.cell.height],['paddingLeft',left,input.cell.width]] as const) content[key] = String(px(v, cell));
          break;
        }
        case 'display': if (value !== 'flex') throw Error('Unsupported display: ' + value); box.flexDirection ??= '"row"'; break;
        case 'flex-direction': if (!['row','column','row-reverse','column-reverse'].includes(value)) throw Error('Unsupported direction'); box.flexDirection = JSON.stringify(value); break;
        case 'align-items': case 'justify-content': {
          const allowed = node.prop === 'align-items' ? ['center','flex-start','flex-end','stretch'] : ['center','flex-start','flex-end','space-between','space-around','space-evenly'];
          if (!allowed.includes(value)) throw Error('Unsupported alignment: ' + value);
          box[node.prop === 'align-items' ? 'alignItems' : 'justifyContent'] = JSON.stringify(value); break;
        }
        case 'gap': {
          const parts = value.split(/\s+/);
          if (parts.length > 2) throw Error('Unsupported gap: ' + value);
          box.rowGap = String(px(parts[0], input.cell.height));
          box.columnGap = String(px(parts[1] ?? parts[0], input.cell.width)); break;
        }
        default: throw Error(`Unconverted property in ${id}: ${node.prop}`);
      }
    }
    if (border || recipe.borderBackdrop) {
      if (!recipe.borderBackdrop) throw Error('Border-cell backdrop policy required: ' + id);
      box.backgroundColor = color(recipe.borderBackdrop);
    }
    const object = (values: Record<string, string>) => '{ ' + Object.entries(values).map(([key, value]) => `${key}: ${value}`).join(', ') + ' }';
    recipes.push(`  ${JSON.stringify(id)}: (palette: Palette) => ({ box: ${object(box)}, content: ${object(content)} } as const),`);
  }
  if (!recipes.length) throw Error('No styles to compile');
  const assets: Record<string, string[]> = {};
  const monochrome: Record<string, string> = {};
  for (const [id, asset] of Object.entries(input.assets ?? {})) {
    const document = parseFragment(readAsset(asset.svg));
    const svg = document.childNodes.find(n => 'tagName' in n && n.tagName === 'svg');
    if (!svg || !('attrs' in svg)) throw Error('SVG root required: ' + id);
    const attrs = Object.fromEntries(svg.attrs.map(a => [a.name, a.value]));
    const [x, y, width, height] = (attrs.viewBox ?? '').split(/[ ,]+/).map(Number);
    if (x !== 0 || y !== 0 || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 65536) throw Error('SVG requires a bounded integer viewBox starting at zero');
    if (Object.keys(attrs).some(key => !['xmlns','viewBox','fill'].includes(key)) || attrs.fill && attrs.fill !== 'currentColor') throw Error('Unconverted SVG root styling: ' + id);
    const rows = Array.from({ length: height }, () => Array<string>(width).fill('.'));
    for (const node of svg.childNodes) {
      if (!('tagName' in node)) continue;
      if (node.tagName === 'title' || node.tagName === 'desc') continue;
      if (node.tagName !== 'rect') throw Error('Unconverted SVG element: ' + node.tagName);
      const rect = Object.fromEntries(node.attrs.map(a => [a.name, a.value]));
      if (Object.keys(rect).some(key => !['x','y','width','height'].includes(key))) throw Error('Unconverted SVG rect styling');
      const left = Number(rect.x ?? 0), top = Number(rect.y ?? 0), w = Number(rect.width), h = Number(rect.height);
      if (![left,top,w,h].every(Number.isInteger) || left < 0 || top < 0 || w < 0 || h < 0 || left + w > width || top + h > height) throw Error('Unconverted SVG rectangle dimensions');
      for (let row = top; row < top + h; row++) for (let col = left; col < left + w; col++) rows[row][col] = '#';
    }
    assets[id] = rows.map(row => row.join(''));
    const lines: string[] = [], bits = [[1,8],[2,16],[4,32],[64,128]];
    for (let y = 0; y < height; y += 4) {
      let line = '';
      for (let x = 0; x < width; x += 2) {
        let dots = 0;
        for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) if (rows[y + dy]?.[x + dx] === '#') dots |= bits[dy][dx];
        line += String.fromCodePoint(0x2800 + dots);
      }
      lines.push(line);
    }
    monochrome[id] = lines.join('\n');
  }
  return '// Generated by html-to-opentui compile_visuals.ts. Edit the visual input, then regenerate.\n' +
    '// CSS cascade and state selection are reviewed inputs. Native borders occupy character cells.\n' +
    `type Palette = { ${[...palette].sort().map(key => JSON.stringify(key) + ': string').join('; ')} };\n` +
    'export const visualStyles = {\n' + recipes.join('\n') + '\n};\n' +
    `export const visualAssets = ${JSON.stringify(assets, null, 2)} as const;\n` +
    `export const visualMonochromeAssets = ${JSON.stringify(monochrome, null, 2)} as const;\n`;
}

main(import.meta.url, () => {
  const a = args(['input', 'out']);
  const result = compileVisuals(JSON.parse(readFileSync(a.input as string, 'utf8')), path => readFileSync(resolve(dirname(a.input as string), path), 'utf8'));
  writeFileSync(a.out as string, result);
  console.log(JSON.stringify({ generated: a.out, scope: 'Resolved CSS styles and integer-rectangle SVG masks; no HTML tree or JS behavior compilation' }));
});
