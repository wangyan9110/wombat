/** Three-way evidence: accepted prototype, updated prototype, current implementation/capture. Never edits code. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Inventory, Bindings, Capture, Rule } from './types.ts';
import { args, main, readJson, writeJson } from './io.ts';
import { compareStyles } from './compare_styles.ts';
import { checkGeometry } from './check_geometry.ts';
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function rulesByKey(inventory: Inventory) {
  const occurrences = new Map<string, number>();
  return new Map(inventory.rules.map(rule => {
    const key = JSON.stringify([rule.source, rule.selector, rule.conditions]);
    const count = occurrences.get(key) ?? 0; occurrences.set(key, count + 1);
    return [key + ':' + count, rule] as const;
  }));
}
function declarations(rule?: Rule) { return rule?.declarations.map(({ property, value, important }) => ({ property, value, important })) ?? []; }
export function planChanges(before: Inventory, after: Inventory, bindings: Bindings, captures?: Capture[]) {
  if (before.schemaVersion !== 3 || after.schemaVersion !== 3 || bindings.schemaVersion !== 1) throw new Error('Expected inventory v3 and bindings v1');
  const baseline = new Map(bindings.baselineSources.map(s => [s.path, s.sha256]));
  if (baseline.size !== before.sources.length || before.sources.some(s => baseline.get(s.path) !== s.sha256)) throw new Error('Bindings do not belong to the accepted source baseline');
  if (new Set(bindings.components.map(c=>c.id)).size !== bindings.components.length) throw new Error('Duplicate component binding');
  const oldHashes = new Map(before.sources.map(s => [s.path, s.sha256])), newHashes = new Map(after.sources.map(s => [s.path, s.sha256]));
  const sourceChanges = [...new Set([...oldHashes.keys(), ...newHashes.keys()])].filter(path => oldHashes.get(path) !== newHashes.get(path)).map(path => ({ path, kind: !oldHashes.has(path) ? 'added' : !newHashes.has(path) ? 'removed' : 'modified', before: oldHashes.get(path), after: newHashes.get(path) }));
  const oldRules = rulesByKey(before), newRules = rulesByKey(after);
  const cssChanges = [...new Set([...oldRules.keys(), ...newRules.keys()])].flatMap(key => {
    const a = oldRules.get(key), b = newRules.get(key), old = declarations(a), current = declarations(b);
    if (equal(old, current)) return [];
    const r = b ?? a!;
    const properties = [...new Set([...old, ...current].map(d => d.property))].filter(property => !equal(old.filter(d=>d.property===property),current.filter(d=>d.property===property))).map(property => ({ property, before: old.filter(d=>d.property===property), after: current.filter(d=>d.property===property) }));
    return [{ source: r.source, selector: r.selector, conditions: r.conditions, beforeLine: a?.line, afterLine: b?.line, kind: !a ? 'added' : !b ? 'removed' : 'modified', properties }];
  });
  const commonKeys = new Set([...oldRules.keys()].filter(k => newRules.has(k)));
  const orderChanged = !equal([...oldRules.keys()].filter(k=>commonKeys.has(k)), [...newRules.keys()].filter(k=>commonKeys.has(k)));
  const jsChanges = sourceChanges.filter(s => before.scripts.some(j=>j.source===s.path) || after.scripts.some(j=>j.source===s.path)).map(s => {
    const old = before.scripts.filter(j=>j.source===s.path), current = after.scripts.filter(j=>j.source===s.path);
    const key = (c: {kind:string;expression:string}) => JSON.stringify([c.kind,c.expression]);
    const oldCandidates = new Set(old.flatMap(j=>j.candidates.map(key))), newCandidates = new Set(current.flatMap(j=>j.candidates.map(key)));
    return { source: s.path, addedCandidates: current.flatMap(j=>j.candidates.filter(c=>!oldCandidates.has(key(c)))), removedCandidates: old.flatMap(j=>j.candidates.filter(c=>!newCandidates.has(key(c)))), beforeDependencies: old.flatMap(j=>j.dependencies), afterDependencies: current.flatMap(j=>j.dependencies), precision: 'syntactic candidates only; whole source module needs semantic review' };
  });
  const oldElements = before.elements.map(({line,column,...e})=>e), newElements = after.elements.map(({line,column,...e})=>e);
  const structureChanged = !equal(oldElements, newElements);
  const components = bindings.components.map(component => {
    const css = cssChanges.filter(change => component.sources.some(s => s.path === change.source && (!s.selectors || s.selectors.includes(change.selector))));
    const changedFiles = sourceChanges.filter(change=>component.sources.some(s=>s.path===change.path));
    // Unknown script/data changes stay conservative, even when no recognized candidate changed.
    const prototypeChanged = css.length > 0 || orderChanged && changedFiles.length > 0 || changedFiles.some(file=>!file.path.endsWith('.css'));
    const implementation = component.implementation.map(file => {
      try { const sha256 = createHash('sha256').update(readFileSync(file.path)).digest('hex'); return { path: file.path, changed: sha256 !== file.sha256, sha256 }; }
      catch(error) { return { path: file.path, changed: true, error: String(error) }; }
    });
    let observed: { colors?: ReturnType<typeof compareStyles>; geometry?: ReturnType<typeof checkGeometry>; error?: string } = {};
    if(captures) {
      try {
        if(component.colors?.length) observed.colors = compareStyles(after, captures, component.colors);
        if(component.geometry?.length) observed.geometry = checkGeometry(captures, component.geometry);
      } catch(error) { observed.error=String(error); }
    }
    const failed = !!observed.error || observed.colors?.passed === false || observed.geometry?.passed === false;
    const changedImplementation = implementation.some(file=>file.changed);
    const guidance: string[] = [];
    if (css.length) guidance.push('Update mapped native style/layout values from the listed properties; resolve cascade and cell policy first.');
    if (prototypeChanged && jsChanges.some(j=>component.sources.some(s=>s.path===j.source))) guidance.push('Review state transitions, data bindings and browser-only effects; rerun the named interaction scenarios.');
    if (orderChanged) guidance.push('CSS rule order changed; re-resolve the cascade before trusting existing selector mappings.');
    if (changedImplementation) guidance.push('Implementation changed since acceptance; preserve current edits and reconcile manually before generating replacements.');
    if (failed) guidance.push('Use observed expected/actual checks to fix the mapped component, then recapture all affected states and sizes.');
    if (!captures && prototypeChanged) guidance.push('Capture the current implementation; source impact alone does not prove a visual mismatch.');
    return { id: component.id, status: failed ? 'observed-mismatch' : prototypeChanged && changedImplementation ? 'both-changed-review' : prototypeChanged ? 'prototype-changed-review' : changedImplementation ? 'implementation-changed-review' : 'no-mapped-change', css, changedFiles, implementation, observed, interactionsToVerify: component.interactions ?? [], guidance };
  });
  const unmappedSources = sourceChanges.filter(change => !bindings.components.some(c => c.sources.some(s=>s.path===change.path)));
  const unmappedCss = cssChanges.filter(change => !bindings.components.some(c=>c.sources.some(s=>s.path===change.source && (!s.selectors || s.selectors.includes(change.selector)))));
  return { schemaVersion: 1, scope: 'Source deltas, file-level implementation drift and optional observed color/geometry checks. JS semantics and interaction parity require review.', sourceChanges, cssChanges, orderChanged, structureChanged, jsChanges, components, unmappedSources, unmappedCss, unresolved: after.issues, requiresReview: sourceChanges.length > 0 || components.some(c=>c.status!=='no-mapped-change') || after.issues.length > 0 };
}
main(import.meta.url, () => {
  const a=args(['before','after','bindings','out'], ['capture']);
  const report=planChanges(readJson(a.before as string),readJson(a.after as string),readJson(a.bindings as string),a.capture ? readJson((a.capture as string[])[0]) : undefined);
  writeJson(a.out as string,report); console.log(JSON.stringify({requiresReview:report.requiresReview,components:report.components.length,output:a.out}));
  if(report.requiresReview)process.exitCode=2;
});
