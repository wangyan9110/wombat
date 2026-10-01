import type { Capture, GeometryRule, Rect } from './types.ts';
import { args, main, readJson, writeJson, unique } from './io.ts';
function finite(value: unknown): number { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected a finite number'); return value; }
export function checkGeometry(captures: Capture[], mapping: GeometryRule[]) {
  const checks = mapping.map(rule => {
    const result: { rule: GeometryRule; passed: boolean; actual?: unknown; error?: string } = { rule, passed: false };
    try {
      const screen = unique(captures, s => s.name === rule.screen, 'screen ' + rule.screen);
      const tolerance = finite(rule.tolerance ?? 0); if (tolerance < 0) throw new Error('Tolerance cannot be negative');
      function validateRect(node: Rect, label: string): Rect {
        const r = { x: finite(node.x), y: finite(node.y), width: finite(node.width), height: finite(node.height) };
        if (r.width <= 0 || r.height <= 0) throw new Error('Empty or negative rectangle: ' + label); return r;
      }
      function rect(id: string | undefined): Rect {
        const node = id === '@viewport' ? { x: 0, y: 0, width: screen.width, height: screen.height } : unique(screen.geometry, n => n.id === id, 'node ' + id);
        return validateRect(node, String(id));
      }
      function contains(node: Rect, container: Rect, axes: Array<'x' | 'y'>, slack: number): boolean {
        return axes.every(axis => { const size = axis === 'x' ? 'width' : 'height'; return node[axis] >= container[axis] - slack && node[axis] + node[size] <= container[axis] + container[size] + slack; });
      }
      if (rule.kind === 'text') {
        if (typeof rule.value !== 'string' || !rule.value) throw new Error('Expected nonempty required text');
        result.passed = screen.plain.includes(rule.value);
      } else if (rule.kind === 'aligned') {
        const nodes = (rule.nodes ?? []).map(rect), props = rule.properties ?? [];
        if (nodes.length < 2 || !props.length || props.some(p => !['x', 'y', 'width', 'height'].includes(p))) throw new Error('Alignment requires two nodes and rectangle properties');
        result.actual = nodes; result.passed = props.every(p => Math.max(...nodes.map(n => n[p])) - Math.min(...nodes.map(n => n[p])) <= tolerance);
      } else if (rule.kind === 'inside') {
        const node = rect(rule.node), container = rect(rule.container ?? '@viewport'); result.actual = { node, container };
        result.passed = contains(node, container, ['x', 'y'], tolerance);
      } else if (rule.kind === 'inside-content') {
        if (!rule.container || rule.container === '@viewport') throw new Error('Content containment requires a captured container');
        if (rule.axis !== undefined && rule.axis !== 'x' && rule.axis !== 'y') throw new Error('Axis must be x or y');
        const node = rect(rule.node), outer = rect(rule.container);
        const captured = unique(screen.geometry, n => n.id === rule.container, 'node ' + rule.container);
        if (!captured.contentRect) throw new Error('Missing captured contentRect: ' + rule.container);
        const content = validateRect(captured.contentRect, rule.container + '.contentRect');
        if (!contains(content, outer, ['x', 'y'], 0)) throw new Error('Captured contentRect extends outside its outer rectangle');
        result.actual = { node, outer, content };
        result.passed = contains(node, content, rule.axis ? [rule.axis] : ['x', 'y'], tolerance);
      } else if (rule.kind === 'centered' || rule.kind === 'ordered') {
        const axis = rule.axis ?? (rule.kind === 'centered' ? 'x' : 'y'); if (axis !== 'x' && axis !== 'y') throw new Error('Axis must be x or y');
        const size = axis === 'x' ? 'width' : 'height';
        if (rule.kind === 'centered') {
          const node = rect(rule.node), container = rect(rule.container ?? '@viewport');
          const delta = Math.abs(node[axis] + node[size] / 2 - container[axis] - container[size] / 2); result.actual = delta; result.passed = delta <= tolerance;
        } else {
          const nodes = (rule.nodes ?? []).map(rect), gap = finite(rule.gap ?? 0);
          if (nodes.length < 2 || gap < 0) throw new Error('Ordering requires two nodes and a nonnegative gap');
          result.actual = nodes; result.passed = nodes.slice(1).every((n, i) => nodes[i][axis] + nodes[i][size] + gap <= n[axis] + tolerance);
        }
      } else throw new Error('Unknown geometry check');
    } catch (error) { result.error = String(error); }
    return result;
  });
  return { scope: 'Native rectangle relations and exact visible substrings; not CSS layout, clipping, glyphs or full fidelity.', passed: checks.length > 0 && checks.every(c => c.passed), checks };
}
main(import.meta.url, () => { const a = args(['capture', 'mapping', 'out']); const report = checkGeometry(readJson(a.capture as string), readJson(a.mapping as string)); writeJson(a.out as string, report); console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, output: a.out })); if (!report.passed) process.exitCode = 1; });
