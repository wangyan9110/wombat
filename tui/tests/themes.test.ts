import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTerminalTheme, terminalTheme, terminalThemes } from '../src/themes/index.js';

test('theme selection falls back safely and cycles through independent palettes', () => {
  assert.equal(terminalTheme('unknown').id, 'forest');
  assert.equal(terminalTheme('paper'), terminalThemes.paper);
  assert.equal(nextTerminalTheme(terminalThemes.forest).id, 'paper');
  assert.equal(nextTerminalTheme(terminalThemes.paper).id, 'graphite');
  assert.equal(nextTerminalTheme(terminalThemes.graphite).id, 'forest');
  for (const theme of Object.values(terminalThemes)) {
    assert.notEqual(theme.foreground, theme.background);
    assert.notEqual(theme.selectedBorder, theme.background);
    assert.notEqual(theme.selectedBackground, theme.background);
  }
});
