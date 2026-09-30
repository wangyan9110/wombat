import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRenderer } from '@opentui/core/testing';
import { TerminalUI } from '../src/components/terminal-ui.js';

test('incremental loading stays compact for quick reads and expands without a fabricated count', async () => {
  for (const width of [40, 80, 120]) {
    const setup = await createTestRenderer({ width, height: width === 40 ? 14 : 24, exitOnCtrlC: false });
    const ui = new TerminalUI(setup.renderer);
    let finish: ((value: number) => void) | undefined;
    const task = ui.task({ kind: 'open', activeTab: 'threads' }, () => new Promise<number>(resolve => { finish = resolve; }));
    try {
      const compact = await setup.waitForFrame(frame => frame.includes('正在读取最新对话'));
      assert.doesNotMatch(compact, /上次用量|530|保存用量|核对本机记录/);
      await new Promise(resolve => setTimeout(resolve, 700));
      const expanded = await setup.waitForFrame(frame => frame.includes('核对本机记录'));
      assert.match(expanded, /完成后进入对话/);
      assert.doesNotMatch(expanded, /530|\d+%|保存用量/);
    } finally {
      finish?.(1);
      await task;
      ui.destroy();
    }
  }
});
