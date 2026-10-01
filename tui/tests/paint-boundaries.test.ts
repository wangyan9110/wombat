import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BoxRenderable, ImageRenderable, TextRenderable, RGBA } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { TerminalUI } from '../src/components/terminal-ui.js';
import { terminalThemes } from '../src/themes/index.js';

for (const width of [40, 80, 120]) test(`brand uses its compact image and shares the name/version center at ${width}`, async () => {
  const setup = await createTestRenderer({ width, height: 24 });
  const ui = new TerminalUI(setup.renderer, terminalThemes.forest, true);
  try {
    void ui.choose({ title: '日报', intro: [], nav: '1 用量 2 对话', activeTab: '用量', footer: 'Q', choices: [] });
    await setup.flush(); await setup.waitForVisualIdle();
    const root = setup.renderer.root, mark = root.findDescendantById('header-mark');
    assert(mark instanceof ImageRenderable);
    await mark.loadPromise;
    assert.equal(mark.loadError, null);
    const image = mark.image!.raw();
    assert.equal(image.width, 10); assert.equal(image.height, 8);
    // Independent fingerprint of the compact brand asset's alpha mask.
    const alpha = image.data.filter((_, i) => i % 4 === 3);
    assert.equal(createHash('sha256').update(alpha).digest('hex'), '058cc7fbcb8366b0b3b73d32a3e6f1e801496759d34188280c9cb7b268984430');
    const name = root.findDescendantById('brand')!, version = root.findDescendantById('version')!;
    assert.equal(name.y, version.y);
    assert.equal(name.y, root.findDescendantById('usage-tab')!.y, 'navigation and brand share a text baseline');
    assert(Math.abs(mark.y + mark.height / 2 - name.y - name.height / 2) <= .5);
    assert.equal(name.x - mark.x - mark.width, 1);
    assert.equal(version.x - name.x - name.width, 1);
    assert.equal(mark.effectiveProtocol, 'blocks', 'headless terminal exercises the native fallback');
    assert.doesNotMatch(setup.captureCharFrame(), /▟▙/);
  } finally { ui.destroy(); }
});

for (const theme of Object.values(terminalThemes)) test(`hovered row has no false selection rail (${theme.id})`, async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 });
  const ui = new TerminalUI(setup.renderer, theme, true);
  try {
    void ui.choose({ title: '日报', intro: [], footer: 'Q', choices: [0, 1].map(i => ({
      id: `record-${i}`, kind: 'subtotal', lines: [], separatorAfter: true,
      distribution: { label: `9月${30-i}日`, value: '1K', share: '50%', ratio: .5, peak: false },
    })) });
    await setup.flush(); await setup.waitForVisualIdle();
    const root = setup.renderer.root;
    const selected = root.findDescendantById('row-0') as BoxRenderable;
    const hovered = root.findDescendantById('row-1') as BoxRenderable;
    const separator = root.findDescendantById('row-1-separator') as BoxRenderable;
    await setup.mockMouse.moveTo(hovered.x + 3, hovered.y + 1);
    await setup.flush(); await setup.waitForVisualIdle();
    assert(selected.borderColor.equals(RGBA.fromHex(theme.selectedBorder)));
    assert(hovered.backgroundColor.equals(RGBA.fromHex(theme.hoverBackground)));
    assert(hovered.borderColor.equals(hovered.backgroundColor), 'transparent source rail must blend into hover surface');
    assert(separator.backgroundColor.equals(hovered.backgroundColor));
    assert((separator.getChildren()[0] as BoxRenderable).borderColor.equals(hovered.backgroundColor));
    await setup.mockMouse.moveTo(0, 0); await setup.flush();
    assert(hovered.backgroundColor.equals(RGBA.fromHex(theme.background)));
    assert(hovered.borderColor.equals(hovered.backgroundColor));
    setup.mockInput.pressArrow('down'); await setup.flush();
    assert(selected.borderColor.equals(selected.backgroundColor), 'previous selection rail clears');
    assert(hovered.borderColor.equals(RGBA.fromHex(theme.selectedBorder)));
  } finally { ui.destroy(); }
});

test('monochrome brand uses the generated mask without forcing an RGB foreground', async () => {
  const setup = await createTestRenderer({ width: 40, height: 14 });
  const ui = new TerminalUI(setup.renderer, terminalThemes.forest, false);
  try {
    void ui.choose({ title: '日报', intro: [], footer: 'Q', choices: [] });
    await setup.flush(); await setup.waitForVisualIdle();
    const mark = setup.renderer.root.findDescendantById('header-mark');
    assert(mark instanceof TextRenderable);
    assert.equal(mark.fg.intent, 'default');
    assert.equal(mark.height, 2); assert.equal(mark.width, 5);
  } finally { ui.destroy(); }
});
