import { routeSearch, type Route } from './state.js';

export interface ViewPosition {
  x: number;
  y: number;
  focus?: string;
  details: { selector: string; open: boolean }[];
  scrollers: { selector: string; x: number; y: number }[];
}

/** Reading revisions change independently of the user's location. */
export function positionKey(route: Route): string {
  return routeSearch({ ...route, returnTo: undefined, snapshot: undefined, configView: undefined, optimizeView: undefined, decisionRevision: undefined });
}

export class ViewPositions {
  private readonly positions = new Map<string, ViewPosition>();
  save(route: Route, position: ViewPosition) {
    const key = positionKey(route);
    this.positions.delete(key);
    this.positions.set(key, position);
    if (this.positions.size > 24) this.positions.delete(this.positions.keys().next().value!);
  }
  read(route: Route) { return this.positions.get(positionKey(route)); }
}

function selectorFor(element: Element): string | undefined {
  const parts: string[] = [];
  for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
    const key = node.getAttribute('data-view-key');
    if (key) { parts.unshift(`[data-view-key="${CSS.escape(key)}"]`); break; }
    const siblings = node.parentElement ? [...node.parentElement.children].filter(other => other.tagName === node!.tagName) : [];
    parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`);
    if (parts.length > 12) return;
  }
  const selector = parts.join(' > ');
  return selector && selector.length <= 768 ? selector : undefined;
}

export function capturePosition(includeOverlays = false): ViewPosition {
  const details = [...document.querySelectorAll<HTMLDetailsElement>(`main details:not([data-turn])${includeOverlays ? ', dialog details' : ''}`)].slice(0, 64)
    .flatMap(node => { const selector = selectorFor(node); return selector ? [{ selector, open: node.open }] : []; });
  const scrollers = [...document.querySelectorAll<HTMLElement>('[data-view-scroll], .dialog-body, .report-table-wrap')].filter(node => includeOverlays || !node.closest('dialog')).slice(0, 16)
    .flatMap(node => { const selector = selectorFor(node); return selector ? [{ selector, x: node.scrollLeft, y: node.scrollTop }] : []; });
  return { x: window.scrollX, y: window.scrollY, details, scrollers,
    focus: document.activeElement && document.activeElement !== document.body && (includeOverlays || !document.activeElement.closest('dialog')) ? selectorFor(document.activeElement) : undefined };
}

/** History may outlive the mounted app; accept only bounded position metadata. */
export function readPosition(value: unknown): ViewPosition | undefined {
  if (!value || typeof value !== 'object') return;
  const p = value as ViewPosition;
  const coordinate = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 10_000_000;
  const selector = (s: unknown) => typeof s === 'string' && s.length > 0 && s.length <= 768;
  if (!coordinate(p.x) || !coordinate(p.y) || p.focus != null && !selector(p.focus)) return;
  if (!Array.isArray(p.details) || p.details.length > 64 || !p.details.every(d => d && selector(d.selector) && typeof d.open === 'boolean')) return;
  if (!Array.isArray(p.scrollers) || p.scrollers.length > 16 || !p.scrollers.every(s => s && selector(s.selector) && coordinate(s.x) && coordinate(s.y))) return;
  return p;
}

/** Restore after asynchronous content arrives; user input always takes precedence. */
export function restorePosition(position: ViewPosition): () => void {
  let frame = 0, stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true; cancelAnimationFrame(frame); clearTimeout(timeout); mutations.disconnect(); sizes.disconnect();
    for (const event of ['pointerdown', 'wheel', 'keydown']) window.removeEventListener(event, stop, true);
  };
  const apply = () => {
    frame = 0;
    if (stopped || document.querySelector('main[aria-busy="true"], main [aria-busy="true"], main [inert], dialog [aria-busy="true"]')) return;
    let complete = true;
    for (const saved of position.details) {
      const node = find<HTMLDetailsElement>(saved.selector);
      if (!node) { complete = false; continue; }
      if (node.open !== saved.open) { node.open = saved.open; complete = false; }
    }
    for (const saved of position.scrollers) {
      const node = find<HTMLElement>(saved.selector);
      if (!node) { complete = false; continue; }
      node.scrollTo(saved.x, saved.y);
      complete &&= Math.abs(node.scrollTop - saved.y) < 2 && Math.abs(node.scrollLeft - saved.x) < 2;
    }
    const focus = position.focus ? find<HTMLElement>(position.focus) : undefined;
    if (position.focus && !focus) complete = false;
    focus?.focus({ preventScroll: true });
    window.scrollTo(position.x, position.y);
    complete &&= Math.abs(window.scrollY - position.y) < 2 && Math.abs(window.scrollX - position.x) < 2;
    if (complete) stop();
  };
  const schedule = () => { if (!stopped && !frame) frame = requestAnimationFrame(apply); };
  const mutations = new MutationObserver(schedule), sizes = new ResizeObserver(schedule);
  mutations.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'aria-busy', 'inert'] });
  sizes.observe(document.body);
  const timeout = setTimeout(stop, 10_000);
  for (const event of ['pointerdown', 'wheel', 'keydown']) window.addEventListener(event, stop, { capture: true, passive: true });
  schedule();
  return stop;
}

function find<T extends HTMLElement>(selector: string): T | null {
  try { return document.querySelector<T>(selector); } catch { return null; }
}
