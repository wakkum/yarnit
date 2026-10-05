import { describe, expect, it } from 'vitest';
import { displayWords, fullSegments, removeSpan } from './edl';
import { applyHighlight, highlightWords, passages, wordColors, wordRuns } from './highlights';
import type { Highlight, Word } from './types';

// "a b c d e": each word 1s long with a 0.2s gap. a=[0,1] b=[1.2,2.2] c=[2.4,3.4] d=[3.6,4.6] e=[4.8,5.8]
const words: Word[] = ['a', 'b', 'c', 'd', 'e'].map((text, i) => ({
  id: text,
  text,
  start: i * 1.2,
  end: i * 1.2 + 1,
  trackId: 't1',
}));
const spans = (hs: Highlight[]) => hs.map((h) => `${h.color}:${h.start}-${h.end}`);
const colorsOf = (hs: Highlight[]) => Object.fromEntries(wordColors(words, hs));

describe('applyHighlight', () => {
  it('adds a span and replaces whatever it overlaps', () => {
    let hs = applyHighlight([], 0, 4.6, 'red');
    hs = applyHighlight(hs, 1.2, 2.2, 'blue');
    expect(spans(hs)).toEqual(['red:0-1.2', 'blue:1.2-2.2', 'red:2.2-4.6']);
  });

  it('clears with null', () => {
    const hs = applyHighlight(applyHighlight([], 0, 5.8, 'green'), 2.4, 3.4, null);
    expect(spans(hs)).toEqual(['green:0-2.4', 'green:3.4-5.8']);
  });
});

describe('word highlights', () => {
  it('groups words into source-consecutive runs', () => {
    expect(wordRuns(words, ['a', 'b', 'd']).map((r) => r.map((t) => +t.toFixed(3)))).toEqual([
      [0, 2.2],
      [3.6, 4.6],
    ]);
  });

  it('colours words by their midpoint', () => {
    const hs = highlightWords([], words, ['b', 'c'], 'red');
    expect(colorsOf(hs)).toEqual({ b: 'red', c: 'red' });
    expect(colorsOf(highlightWords(hs, words, ['c'], 'pink'))).toEqual({ b: 'red', c: 'pink' });
  });
});

describe('passages', () => {
  const hs = highlightWords(highlightWords([], words, ['a', 'b'], 'red'), words, ['d', 'e'], 'red');

  it('lists runs of same-colour kept words in playback order', () => {
    const segs = fullSegments(6);
    const p = passages(displayWords(words, segs), segs, wordColors(words, hs));
    expect(p.map((x) => [x.color, x.text])).toEqual([
      ['red', 'a b'],
      ['red', 'd e'],
    ]);
    expect(p[0].start).toBeCloseTo(0);
    expect(p[0].duration).toBeCloseTo(2.2);
  });

  it('skips cut words and uses edited times', () => {
    const segs = removeSpan(fullSegments(6), 0, 1.1); // cut "a"
    const p = passages(displayWords(words, segs), segs, wordColors(words, hs));
    expect(p.map((x) => x.text)).toEqual(['b', 'd e']);
    expect(p[0].start).toBeCloseTo(0.1);
    expect(p[1].start).toBeCloseTo(3.6 - 1.1);
  });
});
