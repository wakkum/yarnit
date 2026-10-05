import type { HighlightColor } from '../engine/types';

/** Display names for the highlight colours; the CSS colour is var(--hl-<id>) in index.css. */
export const HIGHLIGHT_NAMES: Record<HighlightColor, string> = {
  red: 'Red',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
};
