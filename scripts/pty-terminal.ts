import assert from 'node:assert/strict';
import pty from 'node-pty';
import headless from '@xterm/headless';
import type { Terminal as HeadlessTerminal } from '@xterm/headless';
import { setTimeout as delay } from 'node:timers/promises';

export class Terminal {
  private readonly process: pty.IPty;
  private readonly screen: HeadlessTerminal;
  private raw = '';
  private exit: { exitCode: number; signal?: number } | undefined;

  constructor(node: string, entry: string, env: NodeJS.ProcessEnv, columns: number, rows: number, args: string[] = []) {
    this.screen = new headless.Terminal({ cols: columns, rows, allowProposedApi: true, scrollback: 0 });
    // The shell checks termios after Wombat exits, while the PTY remains open.
    const command = 'before=$(stty -g); "$@"; result=$?; after=$(stty -g); if [ "$before" != "$after" ]; then exit 91; fi; exit "$result"';
    this.process = pty.spawn('/bin/sh', ['-c', command, 'sh', node, entry, ...args], {
      name: 'xterm-256color', cols: columns, rows, env: env as Record<string, string>, cwd: process.cwd(),
    });
    this.screen.onData(data => this.process.write(data));
    this.process.onData(data => { this.raw += data; this.screen.write(data); });
    this.process.onExit(value => { this.exit = value; });
  }

  text(): string {
    const lines: string[] = [];
    for (let row = 0; row < this.screen.rows; row++) lines.push(this.screen.buffer.active.getLine(row)?.translateToString(true) ?? '');
    return lines.join('\n');
  }

  colors(): Set<string> {
    const values = new Set<string>();
    for (let row = 0; row < this.screen.rows; row++) {
      const line = this.screen.buffer.active.getLine(row);
      if (!line) continue;
      for (let column = 0; column < this.screen.cols; column++) {
        const cell = line.getCell(column);
        if (cell && cell.getBgColorMode() !== 0) values.add(`${cell.getBgColorMode()}:${cell.getBgColor()}`);
      }
    }
    return values;
  }

  async expect(fragment: string, timeout = 12_000): Promise<void> {
    const deadline = Date.now() + timeout;
    while (!this.text().includes(fragment)) {
      if (this.exit || Date.now() > deadline) throw new Error(`Expected ${JSON.stringify(fragment)}; got ${this.text().slice(-3000)}`);
      await delay(25);
    }
  }

  async key(value: string, expected?: string): Promise<void> {
    this.process.write(value);
    await delay(160);
    if (expected) await this.expect(expected);
  }

  async resize(columns: number, rows: number, expected: string): Promise<void> {
    this.screen.resize(columns, rows);
    this.process.resize(columns, rows);
    await this.expect(expected);
  }

  async finish(code = 0): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!this.exit && Date.now() < deadline) await delay(25);
    assert.equal(this.exit?.exitCode, code, `Exit ${this.exit?.exitCode}; ${this.text().slice(-2000)}`);
    assert(this.raw.includes('\x1b[?1049h'), 'Alternate screen was not entered');
    assert(this.raw.lastIndexOf('\x1b[?1049l') > this.raw.lastIndexOf('\x1b[?1049h'), 'Alternate screen was not restored');
    assert(this.raw.lastIndexOf('\x1b[?25h') > this.raw.lastIndexOf('\x1b[?25l'), 'Cursor was not restored');
  }

  close(): void {
    if (!this.exit) this.process.kill('SIGTERM');
    this.screen.dispose();
  }
}
