import type { Inventory, Capture, ColorRule } from './types.ts';
import { args, main, readJson, writeJson, unique } from './io.ts';
export function compareStyles(inventory: Pick<Inventory, 'rules'>, captures: Capture[], mapping: ColorRule[]) {
  const checks = mapping.map(entry => {
    if (entry.cascadeConfirmed !== true) throw new Error('Resolve cascade before mapping: ' + entry.selector);
    if (!['fg', 'bg'].includes(entry.channel) || !entry.text) throw new Error('Expected fg/bg channel and nonempty text');
    const candidates = inventory.rules.filter(r => r.selector === entry.selector && JSON.stringify(r.conditions) === JSON.stringify(entry.conditions ?? [])).flatMap(r => r.declarations.filter(d => d.property === entry.property));
    const important = candidates.filter(d => d.important);
    let expected = (important.length ? important : candidates).at(-1)?.value.toLowerCase();
    if (!expected || !/^#(?:[\da-f]{3}|[\da-f]{6})$/.test(expected)) throw new Error('Missing declaration or unsupported opaque color: ' + expected);
    if (expected.length === 4) expected = '#' + [...expected.slice(1)].map(c => c + c).join('');
    const screen = unique(captures, s => s.name === entry.screen, 'screen ' + entry.screen);
    const actual = (screen.spans?.lines ?? []).flatMap(line => line.spans.filter(span => span.text.includes(entry.text)).map(span => {
      const buffer = span[entry.channel].buffer;
      const channels = [0, 1, 2].map(i => buffer[String(i)]);
      if (channels.some(c => !Number.isInteger(c) || c < 0 || c > 255)) throw new Error('Expected byte RGB channels');
      return '#' + channels.map(c => c.toString(16).padStart(2, '0')).join('');
    }));
    return { ...entry, expected, actual, passed: actual.length > 0 && actual.every(color => color === expected) };
  });
  return { scope: 'Explicitly resolved opaque CSS colors against native spans; not automatic cascade or full fidelity.', passed: checks.length > 0 && checks.every(c => c.passed), checks };
}
main(import.meta.url, () => { const a = args(['inventory', 'capture', 'mapping', 'out']); const report = compareStyles(readJson(a.inventory as string), readJson(a.capture as string), readJson(a.mapping as string)); writeJson(a.out as string, report); console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, output: a.out })); if (!report.passed) process.exitCode = 1; });
