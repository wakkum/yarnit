import { describe, expect, it } from 'vitest';
import {
  deleteWords,
  displayWords,
  fullSegments,
  isFillerText,
  moveWords,
  outputDuration,
  outputToSource,
  removeSpan,
  sourceToOutput,
} from './edl';
import type { Word } from './types';

// "a b c d e": each word 1s long with a 0.2s gap. a=[0,1] b=[1.2,2.2] c=[2.4,3.4] d=[3.6,4.6] e=[4.8,5.8]
const words: Word[] = ['a', 'b', 'c', 'd', 'e'].map((text, i) => ({
  id: text,
  text,
  start: i * 1.2,
  end: i * 1.2 + 1,
  trackId: 't1',
}));
const base = () => fullSegments(6);
const order = (segs = base()) =>
  displayWords(words, segs)
    .map((d) => (d.deleted ? `-${d.word.text}` : d.word.text))
    .join(' ');
const close = (segs: { start: number; end: number }[]) =>
  segs.map((s) => [+s.start.toFixed(3), +s.end.toFixed(3)]);

describe('removeSpan', () => {
  it('splits a segment around the removed span', () => {
    expect(close(removeSpan(base(), 2, 3))).toEqual([
      [0, 2],
      [3, 6],
    ]);
  });
  it('ignores spans outside the segments', () => {
    expect(close(removeSpan(base(), 7, 8))).toEqual([[0, 6]]);
  });
});

describe('deleteWords', () => {
  it('cuts a word plus half of each neighbouring gap', () => {
    const segs = deleteWords(base(), words, ['c']);
    expect(close(segs)).toEqual([
      [0, 2.3],
      [3.5, 6],
    ]);
    expect(order(segs)).toBe('a b -c d e');
  });
  it('merges a contiguous selection into one cut', () => {
    const segs = deleteWords(base(), words, ['b', 'c']);
    expect(segs).toHaveLength(2);
    expect(order(segs)).toBe('a -b -c d e');
  });
  it('handles two separate runs', () => {
    const segs = deleteWords(base(), words, ['a', 'd']);
    expect(order(segs)).toBe('-a b c -d e');
    expect(outputDuration(segs)).toBeCloseTo(6 - 1.1 - 1.2, 3);
  });
  it('re-joins segments when a cut is undone by deleting nothing', () => {
    expect(deleteWords(base(), words, [])).toHaveLength(1);
  });
});

describe('moveWords', () => {
  it('moves a word before an earlier word', () => {
    const segs = moveWords(base(), words, ['d'], 'b', 'before');
    expect(order(segs)).toBe('a d b c e');
  });
  it('moves a run after a later word', () => {
    const segs = moveWords(base(), words, ['a', 'b'], 'd', 'after');
    expect(order(segs)).toBe('c d a b e');
  });
  it('keeps total duration when moving', () => {
    const segs = moveWords(base(), words, ['b'], 'e', 'after');
    expect(outputDuration(segs)).toBeCloseTo(6, 6);
  });
  it('does nothing when the target is in the selection', () => {
    const segs = base();
    expect(moveWords(segs, words, ['b', 'c'], 'c', 'before')).toBe(segs);
  });
  it('moving before the first word leaves no scrap of leading audio in front', () => {
    const segs = moveWords(base(), words, ['c'], 'a', 'before');
    expect(order(segs)).toBe('c a b d e');
    expect(segs[0].start).toBeCloseTo(2.3, 3); // starts with the moved piece, not [0, x]
  });
  it('moves a word after the last word', () => {
    expect(order(moveWords(base(), words, ['a'], 'e', 'after'))).toBe('b c d e a');
  });
  it('deleting the last word also removes trailing audio', () => {
    expect(outputDuration(deleteWords(base(), words, ['e']))).toBeCloseTo(4.7, 3);
  });
  it('works after a delete', () => {
    const cut = deleteWords(base(), words, ['c']);
    expect(order(moveWords(cut, words, ['e'], 'a', 'before'))).toBe('e a b -c d');
  });
});

describe('time mapping', () => {
  it('maps source to output across a cut', () => {
    const segs = deleteWords(base(), words, ['c']); // [0,2.3] [3.5,6]
    expect(sourceToOutput(segs, 1)).toBeCloseTo(1);
    expect(sourceToOutput(segs, 3)).toBeNull();
    expect(sourceToOutput(segs, 4)).toBeCloseTo(2.8);
  });
  it('maps output back to source', () => {
    const segs = deleteWords(base(), words, ['c']);
    expect(outputToSource(segs, 2.8)).toEqual({ index: 1, source: expect.closeTo(4, 6) });
    expect(outputToSource(segs, 100)).toBeNull();
  });
});

describe('isFillerText', () => {
  it('matches fillers regardless of case and punctuation', () => {
    expect(isFillerText(' Um,')).toBe(true);
    expect(isFillerText('umbrella')).toBe(false);
  });
});
