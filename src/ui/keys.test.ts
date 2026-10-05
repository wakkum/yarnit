import { describe, expect, it } from 'vitest';
import { comboWith, keyLabels } from './keys';

describe('shortcut labels', () => {
  it('uses symbols on Mac', () => {
    expect(comboWith(keyLabels(true), 'shift', 'mod', 'V')).toBe('⇧⌘V');
    expect(comboWith(keyLabels(true), 'del')).toBe('⌫');
    expect(comboWith(keyLabels(true), 'alt', 'shift', '↑')).toBe('⌥⇧↑');
  });
  it('spells keys out on Windows and Linux', () => {
    expect(comboWith(keyLabels(false), 'shift', 'mod', 'V')).toBe('Shift+Ctrl+V');
    expect(comboWith(keyLabels(false), 'mod', 'X')).toBe('Ctrl+X');
    expect(comboWith(keyLabels(false), 'del')).toBe('Del');
    expect(comboWith(keyLabels(false), 'alt', 'shift', '↑')).toBe('Alt+Shift+↑');
  });
});
