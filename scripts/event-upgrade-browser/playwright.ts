// A runtime-supplied maintained Playwright installation avoids adding a product
// dependency. This is the public API subset consumed by this acceptance runner.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { record } from './policy.ts';

export interface Locator {
  locator(selector: string): Locator;
  getByRole(role: string, options?: { name?: string; exact?: boolean }): Locator;
  filter(options: { hasText: string }): Locator;
  first(): Locator;
  nth(index: number): Locator;
  count(): Promise<number>;
  innerText(): Promise<string>;
  evaluate<T>(callback: (element: HTMLElement) => T): Promise<T>;
  getAttribute(name: string): Promise<string | null>;
  click(): Promise<void>;
  press(key: string): Promise<void>;
  focus(): Promise<void>;
  fill(value: string): Promise<void>;
  selectOption(value: string): Promise<unknown>;
  isEnabled(): Promise<boolean>;
  waitFor(options?: { state?: 'visible' | 'hidden' | 'attached' }): Promise<void>;
}
export interface Request {
  url(): string;
  method(): string;
  postDataJSON(): unknown;
}
export interface Page {
  locator(selector: string): Locator;
  getByRole(role: string, options?: { name?: string; exact?: boolean }): Locator;
  goto(url: string): Promise<unknown>;
  reload(): Promise<unknown>;
  goBack(): Promise<unknown>;
  url(): string;
  evaluate<T>(expression: string): Promise<T>;
  waitForFunction(predicate: () => unknown): Promise<unknown>;
  waitForFunction<A>(predicate: (argument: A) => unknown, argument: A): Promise<unknown>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  on(event: 'request', callback: (request: Request) => void): void;
  on(event: 'pageerror', callback: (error: Error) => void): void;
  on(event: 'console', callback: (message: { type(): string; text(): string; location(): { url: string } }) => void): void;
  on(event: 'response', callback: (response: { url(): string; status(): number }) => void): void;
  keyboard: { press(key: string): Promise<void> };
  setDefaultTimeout(ms: number): void;
  setDefaultNavigationTimeout(ms: number): void;
}
export interface Context {
  newPage(): Promise<Page>;
  close(): Promise<void>;
  grantPermissions(permissions: string[], options: { origin: string }): Promise<void>;
}
export interface Browser {
  newContext(options?: { viewport?: { width: number; height: number } }): Promise<Context>;
  close(): Promise<void>;
}
export interface BrowserServer {
  wsEndpoint(): string;
  process(): ChildProcess;
  close(): Promise<void>;
}
interface Playwright {
  chromium: {
    launchServer(options: { headless: boolean; executablePath?: string; timeout: number }): Promise<BrowserServer>;
    connect(endpoint: string, options: { timeout: number }): Promise<Browser>;
  };
}
export function playwrightExport(value: unknown): Playwright {
  // The maintained package supports both its CJS entry (default export under
  // dynamic import) and ESM entry (named chromium export).
  const imported = record(value) && !('chromium' in value) && record(value.default) ? value.default : value;
  if (!imported || typeof imported !== 'object' || !('chromium' in imported)
    || !imported.chromium || typeof imported.chromium !== 'object'
    || !('launchServer' in imported.chromium) || typeof imported.chromium.launchServer !== 'function'
    || !('connect' in imported.chromium) || typeof imported.chromium.connect !== 'function')
    throw new Error('The supplied module must export Playwright chromium.launchServer/connect');
  // Playwright's documented public API supplies the remaining typed methods;
  // incompatible implementations fail the actual method calls, never skip cases.
  return imported as Playwright;
}
export async function playwright(modulePath: string): Promise<Playwright> {
  return playwrightExport(await import(pathToFileURL(path.resolve(modulePath)).href));
}
