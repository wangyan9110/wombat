export interface Location { source: string; line: number; column?: number }
export interface Issue extends Partial<Location> { reason: string; reference?: string }
export interface Declaration { property: string; value: string; important: boolean; line: number }
export interface Rule extends Location { order: number; selector: string; conditions: string[]; declarations: Declaration[] }
export interface Inventory {
  schemaVersion: 3; hashEncoding: 'raw-bytes'; computed: false; executed: false;
  sources: Array<{ path: string; sha256: string }>;
  assets?: Array<Location & { reference: string; path?: string; usage: string }>;
  rules: Rule[]; issues: Issue[];
  scripts: Array<Location & { inline: boolean; dependencies: string[]; candidates: Array<Location & { kind: string; expression: string }> }>;
  elements: Array<Location & { tag: string; attributes: Record<string, string>; text: string }>;
}
export interface Rect { x: number; y: number; width: number; height: number }
export interface Capture {
  name: string; width: number; height: number; plain: string;
  geometry: Array<Rect & { id: string; contentRect?: Rect }>;
  spans?: { lines: Array<{ spans: Array<{ text: string; fg: { buffer: Record<string, number> }; bg: { buffer: Record<string, number> } }> }> };
}
export interface GeometryRule {
  screen: string; kind: 'text' | 'aligned' | 'inside' | 'inside-content' | 'centered' | 'ordered';
  tolerance?: number; value?: string; node?: string; container?: string;
  nodes?: string[]; properties?: Array<keyof Rect>; axis?: 'x' | 'y'; gap?: number;
}
export interface ColorRule { screen: string; text: string; selector: string; property: string; channel: 'fg' | 'bg'; conditions?: string[]; cascadeConfirmed: boolean }
/** Source-semantic coverage authored by the agent, not inferred from extractor success. */
export interface SemanticCoverage {
  id: string; sources: Location[]; language: 'html' | 'css' | 'javascript' | 'cross-language';
  construct: string; semantics: string; conditions: string[]; dependencies: string[];
  disposition: 'native' | 'adapted' | 'unresolved' | 'out-of-scope';
  reason?: string; adaptation?: { preserved: string[]; changed: string[] };
  targets: Array<{ path: string; symbol: string }>;
  verification: Array<{ scenario: string; expected: string; status: 'verified' | 'failed' | 'unverified'; evidence?: string }>;
}
/** Proposed mapping contract, authored after source/runtime review; not an automatic compiler result. */
export interface InterfacePlan {
  schemaVersion: 1;
  sources: Inventory['sources'];
  coverage?: SemanticCoverage[];
  environment?: { source: Record<string, unknown>; target: Record<string, unknown> };
  state: Record<string, unknown>;
  stateOwnership?: Array<{ id: string; owner: string; lifetime: string; derivedFrom: string[]; resetOn: string[] }>;
  components: Array<{
    id: string; source: Location; selector: string; parentId?: string; children: string[];
    /** Component/API verified in the installed target version; not a closed widget allowlist. */
    native: string;
    structure?: { role?: string; key?: string; condition?: string; repeat?: string; contentOrder?: string[] };
    states: Record<string, { style: Record<string, string | number | boolean>; evidence: Location[] }>;
    layout: { flow: 'row' | 'column' | 'table' | 'overlay' | 'none'; sharedTracks?: string; constraints: Record<string, string | number>; variants?: string[] };
    bindings: Record<string, string>;
    cellPolicy: { spacing: string; overflow: string; approximation?: string };
  }>;
  transitions: Array<{
    id: string; source: Location; from: string; action: string; to: string; guard?: string;
    inputs: Array<'mouse' | 'keyboard' | 'text' | 'paste' | 'resize' | 'timer' | 'effect' | 'lifecycle' | 'system'>; effects: string[];
    event?: { target: string; payload?: string; propagation?: string; defaultAction?: string };
    reads?: string[]; writes?: string[];
    preserve: string[]; focus: string; evidence: 'source' | 'observed' | 'both';
  }>;
  effects?: Array<{
    id: string; source: Location; owner: string; trigger: string; adapter: string;
    outcomes: Record<string, string>; concurrency: string; cleanup: string;
  }>;
  scenarios: Array<{
    id: string; fixture: string; state: string; actions: string[]; checks: GeometryRule[];
    outcomes?: Array<{ kind: 'structure' | 'style' | 'state' | 'event' | 'focus' | 'scroll' | 'effect' | 'lifecycle'; expected: string; evidence?: string }>;
  }>;
  unresolved: Array<{ source: Location; feature: string; reason: string }>;
}
export interface Bindings {
  schemaVersion: 1;
  baselineSources: Inventory['sources'];
  components: Array<{
    id: string;
    sources: Array<{ path: string; selectors?: string[] }>;
    implementation: Array<{ path: string; sha256: string }>;
    colors?: ColorRule[];
    geometry?: GeometryRule[];
    interactions?: string[];
  }>;
}
